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
    jest.fn((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const outputPath = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length) ?? "";

      process.nextTick(async () => {
        if (args.includes("--version")) {
          child.stdout.emit("data", Buffer.from(`${command} version 16.0\n`));
        }
        if (outputPath) {
          await writeFile(outputPath, "dump");
        }
        child.emit("close", 0);
      });

      return child;
    });

  const makeSpawnWithLongErrorAndUnknownVersions = (): jest.Mock =>
    jest.fn((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const outputPath = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length) ?? "";

      process.nextTick(async () => {
        if (args.includes("--version")) {
          child.emit("close", 0);
          return;
        }

        if (command === "pg_dump") {
          child.stderr.emit("data", Buffer.from("x".repeat(5_000)));
          child.emit("close", 1);
          return;
        }

        if (outputPath) {
          await writeFile(outputPath, "dump");
        }
        child.emit("close", 0);
      });

      return child;
    });

  const makeSpawnFailure = (): jest.Mock =>
    jest.fn((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      process.nextTick(async () => {
        if (command === "pg_dump" && !args.includes("--version")) {
          child.stderr.emit("data", Buffer.from(`pg_dump exploded for ${process.env.DATABASE_URL}`));
          child.emit("close", 1);
          return;
        }

        if (args.includes("--version")) {
          child.stdout.emit("data", Buffer.from(`${command} version 16.0\n`));
        }
        const outputPath = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length) ?? "";
        if (outputPath) {
          await writeFile(outputPath, "dump");
        }
        child.emit("close", 0);
      });

      return child;
    });

  const makeSpawnError = (): jest.Mock =>
    jest.fn((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      process.nextTick(async () => {
        if (command === "pg_dump" && !args.includes("--version")) {
          child.emit("error", new Error("pg_dump crashed"));
          return;
        }

        if (args.includes("--version")) {
          child.stdout.emit("data", Buffer.from(`${command} version 16.0\n`));
        }
        const outputPath = args.find((arg) => arg.startsWith("--file="))?.slice("--file=".length) ?? "";
        if (outputPath) {
          await writeFile(outputPath, "dump");
        }
        child.emit("close", 0);
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
      expect.arrayContaining([
        expect.stringContaining("--dbname="),
        "--format=custom",
        "--no-owner",
        "--no-acl",
        expect.stringContaining("--file=")
      ]),
      expect.any(Object)
    );
    expect(spawnImpl).toHaveBeenCalledWith(
      "pg_restore",
      expect.arrayContaining(["--list", expect.stringContaining("db-")]),
      expect.any(Object)
    );
    expect(spawnImpl).toHaveBeenCalledWith(
      "tar",
      expect.arrayContaining(["-tzf", expect.stringContaining("storage-")]),
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
          format: "pg_dump_custom",
          dbDumpPath: expect.stringMatching(/db-.*\.dump$/),
          storageArchivePath: expect.stringContaining("storage-"),
          dbDump: {
            path: expect.stringMatching(/db-.*\.dump$/),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            bytes: expect.any(Number)
          },
          storageArchive: {
            path: expect.stringContaining("storage-"),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            bytes: expect.any(Number)
          },
          durationMs: expect.any(Number),
          versions: expect.objectContaining({
            pgDump: expect.stringContaining("pg_dump"),
            pgRestore: expect.stringContaining("pg_restore"),
            psql: expect.stringContaining("psql"),
            pdflatex: expect.stringContaining("pdflatex"),
            biber: expect.stringContaining("biber"),
            bibtex: expect.stringContaining("bibtex")
          })
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
          error: expect.stringContaining("pg_dump failed with code 1"),
          durationMs: expect.any(Number),
          versions: expect.any(Object)
        }
      }
    });
    const failureDetails = prisma.backupRun.update.mock.calls[0][0].data.details;
    expect(failureDetails.error).not.toContain(process.env.DATABASE_URL);
  });

  it("cleans up stale backup files after a successful run", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-backup-retention-"));
    const backupsDir = join(storageRoot, "backups");
    await mkdir(backupsDir, { recursive: true });
    await writeFile(join(storageRoot, "sample.txt"), "content");

    const staleDump = join(backupsDir, "db-stale.sql");
    const freshDump = join(backupsDir, "db-fresh.sql");
    await writeFile(staleDump, "old");
    await writeFile(freshDump, "new");
    const oldTimestamp = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await import("fs/promises").then(({ utimes }) => utimes(staleDump, oldTimestamp / 1000, oldTimestamp / 1000));

    const { processBackupJob } = await loadJob({
      storageRoot,
      backupsDir,
      spawnImpl: makeSpawnSuccess()
    });
    const prisma = {
      backupRun: {
        create: jest.fn().mockResolvedValue({ id: "backup-3" }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processBackupJob(prisma, { data: {} } as any);

    await expect(import("fs/promises").then(({ access }) => access(freshDump))).resolves.toBeUndefined();
    await expect(import("fs/promises").then(({ access }) => access(staleDump))).rejects.toThrow();
  });

  it("marks the backup run as failed when pg_dump emits an error event", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-backup-error-"));
    const backupsDir = join(storageRoot, "backups");
    await mkdir(backupsDir, { recursive: true });

    const { processBackupJob } = await loadJob({
      storageRoot,
      backupsDir,
      spawnImpl: makeSpawnError()
    });
    const prisma = {
      backupRun: {
        create: jest.fn().mockResolvedValue({ id: "backup-4" }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await expect(processBackupJob(prisma, { data: {} } as any)).rejects.toThrow("pg_dump crashed");

    expect(prisma.backupRun.update).toHaveBeenCalledWith({
      where: {
        id: "backup-4"
      },
      data: {
        status: BackupStatus.FAILED,
        completedAt: expect.any(Date),
        details: {
          error: "pg_dump failed to start: pg_dump crashed",
          durationMs: expect.any(Number),
          versions: expect.any(Object)
        }
      }
    });
  });

  it("truncates long command output and records unknown versions when version output is empty", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-backup-long-error-"));
    const backupsDir = join(storageRoot, "backups");
    await mkdir(backupsDir, { recursive: true });

    const { processBackupJob } = await loadJob({
      storageRoot,
      backupsDir,
      spawnImpl: makeSpawnWithLongErrorAndUnknownVersions()
    });
    const prisma = {
      backupRun: {
        create: jest.fn().mockResolvedValue({ id: "backup-5" }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await expect(processBackupJob(prisma, { data: {} } as any)).rejects.toThrow("pg_dump failed with code 1");

    const failureDetails = prisma.backupRun.update.mock.calls[0][0].data.details;
    expect(failureDetails.error.length).toBeLessThanOrEqual(4_000);
    expect(failureDetails.error).toContain("pg_dump failed with code 1:");
    expect(failureDetails.versions).toEqual(expect.objectContaining({
      pgDump: "unknown",
      pgRestore: "unknown",
      psql: "unknown"
    }));
  });
});
