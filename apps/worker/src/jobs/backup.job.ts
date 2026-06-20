import { createReadStream } from "fs";
import { createHash } from "crypto";
import { mkdtemp, readdir, rename, rm, stat } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";

import { BackupStatus, PrismaClient } from "@prisma/client";
import tar from "tar";
import type { Job } from "bullmq";

import { getEnv } from "../config/env";
import { ensureStorageSubdir, getStoragePath } from "../utils/paths";

const env = getEnv();

type CommandResult = {
  stdout: string;
  stderr: string;
};

type FileIntegrity = {
  path: string;
  sha256: string;
  bytes: number;
};

const MAX_COMMAND_OUTPUT_CHARS = 4_000;

const appendCommandOutput = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString();
  return next.length > MAX_COMMAND_OUTPUT_CHARS ? next.slice(-MAX_COMMAND_OUTPUT_CHARS) : next;
};

const sanitizeCommandOutput = (value: string): string =>
  value
    .replaceAll(env.DATABASE_URL, "[DATABASE_URL]")
    .slice(0, MAX_COMMAND_OUTPUT_CHARS);

const runCommand = (command: string, args: string[]): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = appendCommandOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendCommandOutput(stderr, chunk);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          stdout: sanitizeCommandOutput(stdout),
          stderr: sanitizeCommandOutput(stderr)
        });
        return;
      }
      const output = sanitizeCommandOutput(`${stdout}\n${stderr}`.trim());
      reject(new Error(`${command} failed with code ${code}: ${output}`));
    });

    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${sanitizeCommandOutput(error.message)}`));
    });
  });

const firstVersionLine = (result: CommandResult): string => {
  const value = result.stdout || result.stderr;
  return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "unknown";
};

const collectToolVersions = async (): Promise<Record<string, string>> => ({
  pgDump: firstVersionLine(await runCommand("pg_dump", ["--version"])),
  pgRestore: firstVersionLine(await runCommand("pg_restore", ["--version"])),
  psql: firstVersionLine(await runCommand("psql", ["--version"])),
  tar: firstVersionLine(await runCommand("tar", ["--version"])),
  pdflatex: firstVersionLine(await runCommand("pdflatex", ["--version"])),
  biber: firstVersionLine(await runCommand("biber", ["--version"])),
  bibtex: firstVersionLine(await runCommand("bibtex", ["--version"]))
});

const runPgDump = async (outputPath: string): Promise<void> => {
  await runCommand("pg_dump", [
    `--dbname=${env.DATABASE_URL}`,
    "--format=custom",
    "--no-owner",
    "--no-acl",
    `--file=${outputPath}`
  ]);
};

const validatePgDump = async (dumpPath: string): Promise<void> => {
  await runCommand("pg_restore", ["--list", dumpPath]);
};

const validateTarArchive = async (archivePath: string): Promise<void> => {
  await runCommand("tar", ["-tzf", archivePath]);
};

const calculateSha256 = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });

const getFileIntegrity = async (filePath: string): Promise<FileIntegrity> => {
  const fileStat = await stat(filePath);
  return {
    path: filePath,
    sha256: await calculateSha256(filePath),
    bytes: fileStat.size
  };
};

export const processBackupJob = async (
  prisma: PrismaClient,
  _job: Job<{ requestedBy?: string }>
): Promise<void> => {
  const startedAtMs = Date.now();
  const backupRun = await prisma.backupRun.create({
    data: {
      status: BackupStatus.RUNNING,
      startedAt: new Date()
    },
    select: { id: true }
  });

  let tempDir: string | null = null;
  let versions: Record<string, string> | undefined;

  try {
    versions = await collectToolVersions();
    const backupsDir = await ensureStorageSubdir("backups");
    tempDir = await mkdtemp(join(backupsDir, ".tmp-"));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dbDumpPath = join(backupsDir, `db-${stamp}.dump`);
    const storageArchivePath = join(backupsDir, `storage-${stamp}.tar.gz`);
    const tempDbDumpPath = join(tempDir, `db-${stamp}.dump`);
    const tempStorageArchivePath = join(tempDir, `storage-${stamp}.tar.gz`);

    await runPgDump(tempDbDumpPath);
    await validatePgDump(tempDbDumpPath);

    const storageRoot = getStoragePath();
    const rootEntries = await readdir(storageRoot, { withFileTypes: true });
    const archiveEntries = rootEntries
      .map((entry) => entry.name)
      .filter((entryName) => entryName !== "backups");

    await tar.c(
      {
        gzip: true,
        file: tempStorageArchivePath,
        cwd: storageRoot
      },
      archiveEntries
    );
    await validateTarArchive(tempStorageArchivePath);

    await rename(tempDbDumpPath, dbDumpPath);
    await rename(tempStorageArchivePath, storageArchivePath);

    const [dbDump, storageArchive] = await Promise.all([
      getFileIntegrity(dbDumpPath),
      getFileIntegrity(storageArchivePath)
    ]);

    const retentionUntil = new Date(Date.now() + env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const durationMs = Date.now() - startedAtMs;

    await prisma.backupRun.update({
      where: {
        id: backupRun.id
      },
      data: {
        status: BackupStatus.SUCCEEDED,
        completedAt: new Date(),
        retentionUntil,
        details: {
          format: "pg_dump_custom",
          dbDumpPath,
          storageArchivePath,
          dbDump,
          storageArchive,
          durationMs,
          versions
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
    const durationMs = Date.now() - startedAtMs;
    await prisma.backupRun.update({
      where: {
        id: backupRun.id
      },
      data: {
        status: BackupStatus.FAILED,
        completedAt: new Date(),
        details: {
          error: sanitizeCommandOutput((error as Error).message),
          durationMs,
          versions
        }
      }
    });

    throw error;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
};
