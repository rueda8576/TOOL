import { EventEmitter } from "events";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { BackupStatus } from "@prisma/client";

describe("processBackupJob", () => {
  const loadJob = async (params: {
    storageRoot: string;
    backupsDir: string;
    spawnImpl: jest.Mock;
    tarImpl?: jest.Mock;
  }) => {
    jest.resetModules();
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/doctoral_platform_test?schema=public";
    process.env.BACKUP_RETENTION_DAYS = "30";

    jest.doMock("../config/env", () => ({
      getEnv: () => ({
        DATABASE_URL: process.env.DATABASE_URL,
        BACKUP_RETENTION_DAYS: 30,
        STORAGE_ROOT: params.storageRoot,
        REDIS_URL: "redis://localhost:6379",
        LATEX_TIMEOUT_MS: 120000,
        SMTP_HOST: "localhost",
        SMTP_PORT: 1025,
        SMTP_FROM: "no-reply@example.com"
      })
    }));
    jest.doMock("../utils/paths", () => ({
      ensureStorageSubdir: jest.fn().mockResolvedValue(params.backupsDir),
      getStoragePath: jest.fn(() => params.storageRoot)
    }));
    jest.doMock("child_process", () => ({
      ...jest.requireActual("child_process"),
      spawn: params.spawnImpl
    }));
    jest.doMock("tar", () => ({
      __esModule: true,
      default: {
        c:
          params.tarImpl ??
          jest.fn(async (options: { file: string }) => {
            await writeFile(options.file, "archive");
          })
      }
    }));

    return import("./backup.job");
  };

  const makeSpawnSuccess = (): jest.Mock =>
    jest.fn((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const outputPath = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length) ?? "";

      process.nextTick(async () => {
        await writeFile(outputPath, "dump");
        child.emit("close", 0);
      });

      return child;
    });

  const makeSpawnFailure = (): jest.Mock =>
    jest.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      process.nextTick(() => {
        child.stderr.emit("data", Buffer.from("pg_dump exploded"));
        child.emit("close", 1);
      });

      return child;
    });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("creates a backup run, dumps the database, archives storage, and marks the run as succeeded", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-backup-"));
    const backupsDir = join(storageRoot, "backups");
    await mkdir(backupsDir, { recursive: true });
    await writeFile(join(storageRoot, "sample.txt"), "content");

    const spawnImpl = makeSpawnSuccess();
    const tarImpl = jest.fn(async (options: { file: string }) => {
      await writeFile(options.file, "archive");
    });
    const { processBackupJob } = await loadJob({ storageRoot, backupsDir, spawnImpl, tarImpl });
    const prisma = {
      backupRun: {
        create: jest.fn().mockResolvedValue({ id: "backup-1" }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processBackupJob(prisma, { data: { requestedBy: "admin-1" } } as any);

    expect(prisma.backupRun.create).toHaveBeenCalledWith({
      data: {
        status: BackupStatus.RUNNING,
        startedAt: expect.any(Date)
      },
      select: { id: true }
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      "pg_dump",
      expect.arrayContaining([expect.stringContaining("--dbname="), expect.stringContaining("--file=")]),
      expect.any(Object)
    );
    expect(tarImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        gzip: true,
        cwd: storageRoot
      }),
      ["sample.txt"]
    );
    expect(prisma.backupRun.update).toHaveBeenCalledWith({
      where: {
        id: "backup-1"
      },
      data: {
        status: BackupStatus.SUCCEEDED,
        completedAt: expect.any(Date),
        retentionUntil: expect.any(Date),
        details: {
          dbDumpPath: expect.stringContaining("db-"),
          storageArchivePath: expect.stringContaining("storage-")
        }
      }
    });
  });

  it("marks the backup run as failed when pg_dump errors", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-backup-fail-"));
    const backupsDir = join(storageRoot, "backups");
    await mkdir(backupsDir, { recursive: true });

    const { processBackupJob } = await loadJob({
      storageRoot,
      backupsDir,
      spawnImpl: makeSpawnFailure()
    });
    const prisma = {
      backupRun: {
        create: jest.fn().mockResolvedValue({ id: "backup-2" }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await expect(processBackupJob(prisma, { data: { requestedBy: "admin-1" } } as any)).rejects.toThrow(
      "pg_dump failed with code 1"
    );

    expect(prisma.backupRun.update).toHaveBeenCalledWith({
      where: {
        id: "backup-2"
      },
      data: {
        status: BackupStatus.FAILED,
        completedAt: expect.any(Date),
        details: {
          error: expect.stringContaining("pg_dump failed with code 1")
        }
      }
    });
  });
});
