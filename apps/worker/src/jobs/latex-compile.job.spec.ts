import { EventEmitter } from "events";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { CompileStatus, NotificationEventType, NotificationStatus } from "@prisma/client";

describe("processLatexCompileJob", () => {
  const loadJob = async (params: { storageRoot: string; spawnImpl: jest.Mock }) => {
    jest.resetModules();
    process.env.STORAGE_ROOT = params.storageRoot;
    process.env.LATEX_TIMEOUT_MS = "1000";

    jest.doMock("../config/env", () => ({
      getEnv: () => ({
        STORAGE_ROOT: params.storageRoot,
        LATEX_TIMEOUT_MS: 1000,
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/doctoral_platform_test?schema=public",
        REDIS_URL: "redis://localhost:6379",
        SMTP_HOST: "localhost",
        SMTP_PORT: 1025,
        SMTP_FROM: "no-reply@example.com",
        BACKUP_RETENTION_DAYS: 30
      })
    }));
    jest.doMock("child_process", () => ({
      ...jest.requireActual("child_process"),
      spawn: params.spawnImpl
    }));

    return import("./latex-compile.job");
  };

  const makeChild = (onClose: (child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) => void) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => onClose(child));
    return child;
  };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("fails early when the document version has no latex source", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-missing-"));
    const { processLatexCompileJob } = await loadJob({ storageRoot, spawnImpl: jest.fn() });
    const prisma = {
      documentCompileJob: {
        update: jest.fn().mockResolvedValue(undefined)
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          latexBundleFile: null,
          latexWorkspacePath: null,
          latexEntryFile: "main.tex",
          createdById: "user-1"
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processLatexCompileJob(prisma, { data: { documentVersionId: "version-1", compileJobId: "job-1" } } as any);

    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: {
        compileStatus: CompileStatus.FAILED,
        compileLog: "Version has no latex source"
      }
    });
    expect(prisma.documentCompileJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: {
        status: CompileStatus.FAILED,
        finishedAt: expect.any(Date),
        errorMessage: "Version has no latex source"
      }
    });
  });

  it("marks the compile job as failed when the version disappears during compilation", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-stale-"));
    const workspacePath = "latex-workspaces/version-2";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");

    let pdflatexRuns = 0;
    const spawnImpl = jest.fn((command: string, _args: string[], options: { cwd: string }) =>
      makeChild(async (child) => {
        if (command === "pdflatex") {
          pdflatexRuns += 1;
          if (pdflatexRuns === 3) {
            await writeFile(join(options.cwd, "main.pdf"), "pdf", "utf8");
          }
        }
        child.emit("close", 0);
      })
    );
    const { processLatexCompileJob } = await loadJob({ storageRoot, spawnImpl });
    const prisma = {
      documentCompileJob: {
        update: jest.fn().mockResolvedValue(undefined)
      },
      documentVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "version-2",
            latexBundleFile: null,
            latexWorkspacePath: workspacePath,
            latexEntryFile: "main.tex",
            createdById: "user-1"
          })
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue(undefined)
      },
      fileObject: {
        create: jest.fn().mockResolvedValue({ id: "compiled-pdf" })
      },
      notificationEvent: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processLatexCompileJob(prisma, { data: { documentVersionId: "version-2", compileJobId: "job-2" } } as any);

    expect(prisma.documentCompileJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-2" },
      data: {
        status: CompileStatus.FAILED,
        finishedAt: expect.any(Date),
        errorMessage: "Document was deleted during compilation"
      }
    });
    expect(prisma.documentVersion.update).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("stores the compiled PDF, updates statuses, and creates a notification on success", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-success-"));
    const workspacePath = "latex-workspaces/version-3";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");

    let pdflatexRuns = 0;
    const spawnImpl = jest.fn((command: string, _args: string[], options: { cwd: string }) =>
      makeChild(async (child) => {
        if (command === "pdflatex") {
          pdflatexRuns += 1;
          if (pdflatexRuns === 3) {
            await writeFile(join(options.cwd, "main.pdf"), "pdf-bytes", "utf8");
          }
        }
        child.emit("close", 0);
      })
    );
    const { processLatexCompileJob } = await loadJob({ storageRoot, spawnImpl });
    const prisma = {
      documentCompileJob: {
        update: jest.fn().mockResolvedValue(undefined)
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-3",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-1"
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      fileObject: {
        create: jest.fn().mockResolvedValue({ id: "compiled-pdf-1" })
      },
      notificationEvent: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processLatexCompileJob(prisma, { data: { documentVersionId: "version-3", compileJobId: "job-3" } } as any);

    expect(prisma.fileObject.create).toHaveBeenCalledWith({
      data: {
        storagePath: expect.stringContaining("compiled/"),
        originalName: "version-3.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(Buffer.byteLength("pdf-bytes")),
        uploadedById: "user-1"
      },
      select: { id: true }
    });
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-3" },
      data: {
        compileStatus: CompileStatus.SUCCEEDED,
        compileLog: expect.stringContaining("[pdflatex pass 3]"),
        compiledPdfFileId: "compiled-pdf-1"
      }
    });
    expect(prisma.documentCompileJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-3" },
      data: {
        status: CompileStatus.SUCCEEDED,
        finishedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: NotificationEventType.DOC_COMPILED,
        status: NotificationStatus.PENDING,
        payload: {
          documentVersionId: "version-3",
          compileStatus: CompileStatus.SUCCEEDED
        }
      }
    });
  });

  it("marks compilation as timeout when the latex command exits with timeout output", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-timeout-"));
    const workspacePath = "latex-workspaces/version-4";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");

    const spawnImpl = jest.fn(() =>
      makeChild((child) => {
        child.stderr.emit("data", Buffer.from("ETIMEDOUT"));
        child.emit("close", 1);
      })
    );
    const { processLatexCompileJob } = await loadJob({ storageRoot, spawnImpl });
    const prisma = {
      documentCompileJob: {
        update: jest.fn().mockResolvedValue(undefined)
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-4",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-1"
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      fileObject: {
        create: jest.fn()
      },
      notificationEvent: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processLatexCompileJob(prisma, { data: { documentVersionId: "version-4", compileJobId: "job-4" } } as any);

    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-4" },
      data: {
        compileStatus: CompileStatus.TIMEOUT,
        compileLog: expect.stringContaining("ETIMEDOUT"),
        compiledPdfFileId: undefined
      }
    });
    expect(prisma.documentCompileJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-4" },
      data: {
        status: CompileStatus.TIMEOUT,
        finishedAt: expect.any(Date),
        errorMessage: "LaTeX compilation failed"
      }
    });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: NotificationEventType.DOC_COMPILED,
        status: NotificationStatus.PENDING,
        payload: {
          documentVersionId: "version-4",
          compileStatus: CompileStatus.TIMEOUT
        }
      }
    });
  });
});
