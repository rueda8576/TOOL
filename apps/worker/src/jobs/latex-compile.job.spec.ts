import { EventEmitter } from "events";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { CompileStatus, NotificationEventType, NotificationStatus } from "@prisma/client";

describe("processLatexCompileJob", () => {
  const loadJob = async (params: {
    storageRoot: string;
    spawnImpl: jest.Mock;
    readFileOverride?: (actualReadFile: typeof import("fs/promises").readFile) => typeof import("fs/promises").readFile;
  }) => {
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
    if (params.readFileOverride) {
      jest.doMock("fs/promises", () => {
        const actual = jest.requireActual("fs/promises");
        return {
          ...actual,
          readFile: params.readFileOverride!(actual.readFile)
        };
      });
    }

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

  it("marks the compile job as failed when the document version is deleted before compilation starts", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-deleted-"));
    const { processLatexCompileJob } = await loadJob({ storageRoot, spawnImpl: jest.fn() });
    const prisma = {
      documentCompileJob: {
        update: jest.fn().mockResolvedValue(undefined)
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    } as any;

    await processLatexCompileJob(prisma, { data: { documentVersionId: "version-x", compileJobId: "job-x" } } as any);

    expect(prisma.documentCompileJob.update).toHaveBeenNthCalledWith(2, {
      where: { id: "job-x" },
      data: {
        status: CompileStatus.FAILED,
        finishedAt: expect.any(Date),
        errorMessage: "Document was deleted before compilation started"
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

  it("fails when pdflatex finishes without producing a PDF artifact", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-missing-pdf-"));
    const workspacePath = "latex-workspaces/version-5";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");

    const spawnImpl = jest.fn((_command: string, _args: string[], _options: { cwd: string }) =>
      makeChild((child) => {
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
          id: "version-5",
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

    await processLatexCompileJob(prisma, { data: { documentVersionId: "version-5", compileJobId: "job-5" } } as any);

    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-5" },
      data: {
        compileStatus: CompileStatus.FAILED,
        compileLog: expect.stringContaining("No PDF output found"),
        compiledPdfFileId: undefined
      }
    });
    expect(prisma.fileObject.create).not.toHaveBeenCalled();
  });

  it("extracts a bundled workspace and falls back to main.tex when no entry file is stored", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-zip-"));
    const bundlePath = join(storageRoot, "uploads", "bundle.zip");
    await mkdir(join(storageRoot, "uploads"), { recursive: true });

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addFile("main.tex", Buffer.from("\\documentclass{article}", "utf8"));
    await writeFile(bundlePath, zip.toBuffer());

    let pdflatexRuns = 0;
    const spawnImpl = jest.fn((command: string, args: string[], options: { cwd: string }) =>
      makeChild(async (child) => {
        if (command === "pdflatex") {
          pdflatexRuns += 1;
          expect(args.at(-1)).toBe("main.tex");
          if (pdflatexRuns === 3) {
            await writeFile(join(options.cwd, "main.pdf"), "zip-pdf", "utf8");
          }
        }
        child.stdout.emit("data", Buffer.from("latex ok"));
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
          id: "version-zip",
          latexBundleFile: { storagePath: "uploads/bundle.zip" },
          latexWorkspacePath: null,
          latexEntryFile: null,
          createdById: "user-zip"
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      fileObject: {
        create: jest.fn().mockResolvedValue({ id: "compiled-zip" })
      },
      notificationEvent: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processLatexCompileJob(
      prisma,
      { data: { documentVersionId: "version-zip", compileJobId: "job-zip" } } as any
    );

    expect(spawnImpl).toHaveBeenCalledTimes(3);
    expect(prisma.fileObject.create).toHaveBeenCalled();
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-zip" },
      data: {
        compileStatus: CompileStatus.SUCCEEDED,
        compileLog: expect.stringContaining("latex ok"),
        compiledPdfFileId: "compiled-zip"
      }
    });
  });

  it("fails with the biber result when bibliography processing via .bcf does not succeed", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-biber-"));
    const workspacePath = "latex-workspaces/version-biber";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");
    await writeFile(join(workspaceAbsolute, "main.bcf"), "bcf", "utf8");

    const spawnImpl = jest.fn((command: string) =>
      makeChild((child) => {
        if (command === "biber") {
          child.stderr.emit("data", Buffer.from("biber failed"));
          child.emit("close", 1);
          return;
        }
        child.stdout.emit("data", Buffer.from(`${command} ok`));
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
          id: "version-biber",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-biber"
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

    await processLatexCompileJob(
      prisma,
      { data: { documentVersionId: "version-biber", compileJobId: "job-biber" } } as any
    );

    expect(spawnImpl).toHaveBeenCalledWith(
      "biber",
      ["main"],
      expect.objectContaining({ cwd: workspaceAbsolute })
    );
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-biber" },
      data: {
        compileStatus: CompileStatus.FAILED,
        compileLog: expect.stringContaining("biber failed"),
        compiledPdfFileId: undefined
      }
    });
  });

  it("fails with the bibtex result when an aux file requests bibliography generation", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-bibtex-"));
    const workspacePath = "latex-workspaces/version-bibtex";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");
    await writeFile(join(workspaceAbsolute, "main.aux"), "\\bibdata{refs}", "utf8");

    const spawnImpl = jest.fn((command: string) =>
      makeChild((child) => {
        if (command === "bibtex") {
          child.stderr.emit("data", Buffer.from("bibtex failed"));
          child.emit("close", 1);
          return;
        }
        child.stdout.emit("data", Buffer.from(`${command} ok`));
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
          id: "version-bibtex",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-bibtex"
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

    await processLatexCompileJob(
      prisma,
      { data: { documentVersionId: "version-bibtex", compileJobId: "job-bibtex" } } as any
    );

    expect(spawnImpl).toHaveBeenCalledWith(
      "bibtex",
      ["main"],
      expect.objectContaining({ cwd: workspaceAbsolute })
    );
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-bibtex" },
      data: {
        compileStatus: CompileStatus.FAILED,
        compileLog: expect.stringContaining("bibtex failed"),
        compiledPdfFileId: undefined
      }
    });
  });

  it("treats a missing aux read as empty content and still completes compilation", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-aux-missing-"));
    const workspacePath = "latex-workspaces/version-aux-missing";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");
    await writeFile(join(workspaceAbsolute, "main.aux"), "\\bibdata{refs}", "utf8");

    let pdflatexRuns = 0;
    const spawnImpl = jest.fn((command: string, _args: string[], options: { cwd: string }) =>
      makeChild(async (child) => {
        if (command === "pdflatex") {
          pdflatexRuns += 1;
          if (pdflatexRuns === 1) {
            await rm(join(options.cwd, "main.aux"));
          }
          if (pdflatexRuns === 3) {
            await writeFile(join(options.cwd, "main.pdf"), "aux-fallback-pdf", "utf8");
          }
        }
        child.stdout.emit("data", Buffer.from(`${command} ok`));
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
          id: "version-aux-missing",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-aux"
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      fileObject: {
        create: jest.fn().mockResolvedValue({ id: "compiled-aux" })
      },
      notificationEvent: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processLatexCompileJob(
      prisma,
      { data: { documentVersionId: "version-aux-missing", compileJobId: "job-aux-missing" } } as any
    );

    expect(spawnImpl).not.toHaveBeenCalledWith(
      "bibtex",
      expect.anything(),
      expect.anything()
    );
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-aux-missing" },
      data: {
        compileStatus: CompileStatus.SUCCEEDED,
        compileLog: expect.stringContaining("pdflatex pass 3"),
        compiledPdfFileId: "compiled-aux"
      }
    });
  });

  it("treats aux read errors as empty content before continuing without bibtex", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-aux-read-error-"));
    const workspacePath = "latex-workspaces/version-aux-read-error";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");
    await writeFile(join(workspaceAbsolute, "main.aux"), "\\bibdata{refs}", "utf8");

    let pdflatexRuns = 0;
    const spawnImpl = jest.fn((command: string, _args: string[], options: { cwd: string }) =>
      makeChild(async (child) => {
        if (command === "pdflatex") {
          pdflatexRuns += 1;
          if (pdflatexRuns === 3) {
            await writeFile(join(options.cwd, "main.pdf"), "aux-read-error-pdf", "utf8");
          }
        }
        child.stdout.emit("data", Buffer.from(`${command} ok`));
        child.emit("close", 0);
      })
    );
    const { processLatexCompileJob } = await loadJob({
      storageRoot,
      spawnImpl,
      readFileOverride: (actualReadFile) => ((targetPath: any, encoding?: any) => {
        if (typeof targetPath === "string" && targetPath.endsWith("main.aux") && encoding === "utf8") {
          return Promise.reject(new Error("aux vanished"));
        }
        return actualReadFile(targetPath, encoding);
      }) as typeof import("fs/promises").readFile
    });
    const prisma = {
      documentCompileJob: {
        update: jest.fn().mockResolvedValue(undefined)
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-aux-read-error",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-aux-read-error"
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      fileObject: {
        create: jest.fn().mockResolvedValue({ id: "compiled-aux-read-error" })
      },
      notificationEvent: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processLatexCompileJob(
      prisma,
      { data: { documentVersionId: "version-aux-read-error", compileJobId: "job-aux-read-error" } } as any
    );

    expect(spawnImpl).not.toHaveBeenCalledWith(
      "bibtex",
      expect.anything(),
      expect.anything()
    );
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-aux-read-error" },
      data: {
        compileStatus: CompileStatus.SUCCEEDED,
        compileLog: expect.stringContaining("pdflatex pass 3"),
        compiledPdfFileId: "compiled-aux-read-error"
      }
    });
  });

  it("fails immediately on a second LaTeX pass error and handles undefined exit codes", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-second-pass-"));
    const workspacePath = "latex-workspaces/version-second-pass";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");

    let pdflatexRuns = 0;
    const spawnImpl = jest.fn(() =>
      makeChild((child) => {
        pdflatexRuns += 1;
        child.stdout.emit("data", Buffer.from("latex output"));
        if (pdflatexRuns === 2) {
          child.emit("close", undefined);
          return;
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
          id: "version-second-pass",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-second"
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

    await processLatexCompileJob(
      prisma,
      { data: { documentVersionId: "version-second-pass", compileJobId: "job-second-pass" } } as any
    );

    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-second-pass" },
      data: {
        compileStatus: CompileStatus.FAILED,
        compileLog: expect.stringContaining("latex output"),
        compiledPdfFileId: undefined
      }
    });
  });

  it("fails on a third LaTeX pass spawn error after bibliography processing", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-latex-third-pass-"));
    const workspacePath = "latex-workspaces/version-third-pass";
    const workspaceAbsolute = join(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\documentclass{article}", "utf8");
    await writeFile(join(workspaceAbsolute, "main.bcf"), "bcf", "utf8");

    let pdflatexRuns = 0;
    const spawnImpl = jest.fn((command: string) =>
      makeChild((child) => {
        if (command === "biber") {
          child.stdout.emit("data", Buffer.from("biber ok"));
          child.emit("close", 0);
          return;
        }

        pdflatexRuns += 1;
        if (pdflatexRuns === 3) {
          child.emit("error", new Error("spawn broke"));
          return;
        }

        child.stdout.emit("data", Buffer.from(`pdflatex pass ${pdflatexRuns}`));
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
          id: "version-third-pass",
          latexBundleFile: null,
          latexWorkspacePath: workspacePath,
          latexEntryFile: "main.tex",
          createdById: "user-third"
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

    await processLatexCompileJob(
      prisma,
      { data: { documentVersionId: "version-third-pass", compileJobId: "job-third-pass" } } as any
    );

    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "version-third-pass" },
      data: {
        compileStatus: CompileStatus.FAILED,
        compileLog: expect.stringContaining("[spawn-error] spawn broke"),
        compiledPdfFileId: undefined
      }
    });
    expect(prisma.fileObject.create).not.toHaveBeenCalled();
  });
});
