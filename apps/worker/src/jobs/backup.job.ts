import { readdir, rm, stat } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";

import { BackupStatus, PrismaClient } from "@prisma/client";
import tar from "tar";
import type { Job } from "bullmq";

import { getEnv } from "../config/env";
import { ensureStorageSubdir, getStoragePath } from "../utils/paths";

const env = getEnv();

const runPgDump = (outputPath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("pg_dump", [`--dbname=${env.DATABASE_URL}`, `--file=${outputPath}`], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pg_dump failed with code ${code}: ${output}`));
    });

    child.on("error", reject);
  });

export const processBackupJob = async (
  prisma: PrismaClient,
  _job: Job<{ requestedBy?: string }>
): Promise<void> => {
  const backupRun = await prisma.backupRun.create({
    data: {
      status: BackupStatus.RUNNING,
      startedAt: new Date()
    },
    select: { id: true }
  });

  const backupsDir = await ensureStorageSubdir("backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dbDumpPath = join(backupsDir, `db-${stamp}.sql`);
  const storageArchivePath = join(backupsDir, `storage-${stamp}.tar.gz`);

  try {
    await runPgDump(dbDumpPath);

    const storageRoot = getStoragePath();
    const rootEntries = await readdir(storageRoot, { withFileTypes: true });
    const archiveEntries = rootEntries
      .map((entry) => entry.name)
      .filter((entryName) => entryName !== "backups");

    await tar.c(
      {
        gzip: true,
        file: storageArchivePath,
        cwd: storageRoot
      },
      archiveEntries
    );

    const retentionUntil = new Date(Date.now() + env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    await prisma.backupRun.update({
      where: {
        id: backupRun.id
      },
      data: {
        status: BackupStatus.SUCCEEDED,
        completedAt: new Date(),
        retentionUntil,
        details: {
          dbDumpPath,
          storageArchivePath
        }
      }
    });

    const files = await readdir(backupsDir, { withFileTypes: true });
    const deleteBefore = Date.now() - env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    await Promise.all(
      files
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const fullPath = join(backupsDir, entry.name);
          const fileStat = await stat(fullPath);
          if (fileStat.mtimeMs >= deleteBefore) {
            return;
          }

          await rm(fullPath, { force: true });
        })
    );
  } catch (error) {
    await prisma.backupRun.update({
      where: {
        id: backupRun.id
      },
      data: {
        status: BackupStatus.FAILED,
        completedAt: new Date(),
        details: {
          error: (error as Error).message
        }
      }
    });

    throw error;
  }
};
