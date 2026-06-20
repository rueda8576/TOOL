import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CompileStatus, DocumentType } from "@prisma/client";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { DocumentsService } from "./documents.service";

describe("DocumentsService", () => {
  const createService = (): {
    service: DocumentsService;
    prisma: any;
    accessService: any;
    storageService: any;
    queueService: any;
    auditService: any;
  } => {
    const prisma: any = {
      $transaction: jest.fn(),
      document: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1" }),
        update: jest.fn()
      },
      documentBranch: {
        create: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: "b1" }),
        updateMany: jest.fn()
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({ versionNumber: 1 }),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn()
      },
      documentCompileJob: {
        create: jest.fn(),
        update: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));

    const accessService: any = {
      ensureProjectWritable: jest.fn().mockResolvedValue(undefined),
      ensureProjectReadable: jest.fn().mockResolvedValue(undefined)
    };

    const storageService: any = {
      saveUpload: jest.fn(),
      readObject: jest.fn()
    };

    const queueService: any = {
      enqueueCompile: jest.fn()
    };

    const auditService: any = {
      log: jest.fn().mockResolvedValue(undefined)
    };

    return {
      service: new DocumentsService(prisma, accessService, storageService, queueService, auditService),
      prisma,
      accessService,
      storageService,
      queueService,
      auditService
    };
  };

  it("lists documents with latest main version summary", async () => {
    const { service, prisma, accessService } = createService();
    const updatedAt = new Date("2026-02-22T10:00:00.000Z");
    const publishedAt = new Date("2026-01-10T00:00:00.000Z");
    const versionCreatedAt = new Date("2026-02-22T09:00:00.000Z");

    prisma.document.findMany.mockResolvedValue([
      {
        id: "d1",
        projectId: "p1",
        title: "Paper",
        type: DocumentType.PAPER,
        authors: ["Alice"],
        tags: ["nlp"],
        publishedAt,
        updatedAt,
        versions: [
          {
            id: "v2",
            versionNumber: 2,
            compileStatus: CompileStatus.SUCCEEDED,
            compiledPdfFileId: "f-compiled",
            pdfFileId: null,
            latexBundleFileId: "f-latex",
            latexWorkspacePath: "latex-workspaces/v2",
            latexEntryFile: "main.tex",
            createdAt: versionCreatedAt
          }
        ]
      }
    ]);

    const result = await service.listDocuments("p1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(result).toEqual([
      {
        id: "d1",
        projectId: "p1",
        title: "Paper",
        type: "paper",
        authors: ["Alice"],
        tags: ["nlp"],
        publishedAt: publishedAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        latestMainVersion: {
          id: "v2",
          versionNumber: 2,
          compileStatus: "succeeded",
          hasPdf: true,
          hasLatex: true,
          latexEntryFile: "main.tex",
          createdAt: versionCreatedAt.toISOString()
        }
      }
    ]);
  });

  it("throws not found when document detail is missing", async () => {
    const { service, prisma, accessService } = createService();
    prisma.document.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.getDocumentDetail(
        "p1",
        "missing",
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "reader"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("u1", "reader", "p1");
  });

  it("creates a document with the main branch inside a transaction and writes audit log", async () => {
    const { service, prisma, accessService, auditService } = createService();
    prisma.document.create.mockResolvedValue({
      id: "d-created",
      projectId: "p1",
      title: "Thesis paper",
      type: DocumentType.PAPER
    });
    prisma.documentBranch.create.mockResolvedValue({ id: "branch-main" });

    const result = await service.createDocument(
      "p1",
      {
        title: "Thesis paper",
        type: "paper",
        authors: ["Alice", "Bob"],
        tags: ["vision"],
        publishedAt: "2026-04-06T10:00:00.000Z"
      },
      {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(prisma.document.create).toHaveBeenCalledWith({
      data: {
        projectId: "p1",
        title: "Thesis paper",
        type: DocumentType.PAPER,
        authors: ["Alice", "Bob"],
        tags: ["vision"],
        publishedAt: new Date("2026-04-06T10:00:00.000Z"),
        createdById: "u1"
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        type: true
      }
    });
    expect(prisma.documentBranch.create).toHaveBeenCalledWith({
      data: {
        documentId: "d-created",
        name: "main",
        createdById: "u1"
      },
      select: { id: true }
    });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "u1",
      projectId: "p1",
      entityType: "document",
      entityId: "d-created",
      action: "document.create"
    });
    expect(result).toEqual({
      id: "d-created",
      projectId: "p1",
      title: "Thesis paper",
      type: DocumentType.PAPER,
      mainBranchId: "branch-main"
    });
  });

  it("defaults document type to OTHER and maps timeout summaries from version metadata", async () => {
    const { service, prisma } = createService();
    prisma.document.create.mockResolvedValue({
      id: "d-created",
      projectId: "p1",
      title: "Untyped document",
      type: DocumentType.OTHER
    });
    prisma.documentBranch.create.mockResolvedValue({ id: "branch-main" });

    await service.createDocument(
      "p1",
      {
        title: "Untyped document"
      },
      {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      }
    );

    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: DocumentType.OTHER
        })
      })
    );
    expect(
      (service as any).mapVersionSummary({
        id: "v-timeout",
        versionNumber: 4,
        compileStatus: CompileStatus.TIMEOUT,
        compiledPdfFileId: null,
        pdfFileId: null,
        latexBundleFileId: null,
        latexWorkspacePath: null,
        latexEntryFile: null,
        createdAt: new Date("2026-04-06T12:00:00.000Z")
      })
    ).toEqual({
      id: "v-timeout",
      versionNumber: 4,
      compileStatus: "timeout",
      hasPdf: false,
      hasLatex: false,
      latexEntryFile: null,
      createdAt: "2026-04-06T12:00:00.000Z"
    });
  });

  it("creates a document branch from a valid base version", async () => {
    const { service, prisma, accessService, auditService } = createService();
    prisma.document.findFirst.mockResolvedValue({
      id: "d1",
      projectId: "p1"
    });
    prisma.documentVersion.findFirst.mockResolvedValue({ id: "v1" });
    prisma.documentBranch.create.mockResolvedValue({
      id: "branch-review",
      documentId: "d1",
      name: "review",
      baseVersionId: "v1"
    });

    const result = await service.createBranch(
      "d1",
      {
        name: "review",
        baseVersionId: "v1"
      },
      {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(prisma.documentBranch.create).toHaveBeenCalledWith({
      data: {
        documentId: "d1",
        name: "review",
        baseVersionId: "v1",
        createdById: "u1"
      },
      select: {
        id: true,
        documentId: true,
        name: true,
        baseVersionId: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.branch.create",
        metadata: { documentId: "d1", branchName: "review" }
      })
    );
    expect(result).toEqual({
      id: "branch-review",
      documentId: "d1",
      name: "review",
      baseVersionId: "v1"
    });
  });

  it("rejects branch creation when the base version does not belong to the document", async () => {
    const { service, prisma } = createService();
    prisma.document.findFirst.mockResolvedValue({
      id: "d1",
      projectId: "p1"
    });
    prisma.documentVersion.findFirst.mockResolvedValue(null);

    await expect(
      service.createBranch(
        "d1",
        {
          name: "review",
          baseVersionId: "missing-version"
        },
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates version from latex folder upload", async () => {
    const { service, prisma } = createService();
    prisma.documentVersion.create.mockResolvedValue({
      id: "v2",
      documentId: "d1",
      branchId: "b1",
      versionNumber: 2,
      compileStatus: CompileStatus.PENDING
    });
    prisma.documentVersion.update.mockResolvedValue({
      id: "v2",
      documentId: "d1",
      branchId: "b1",
      versionNumber: 2,
      compileStatus: CompileStatus.PENDING
    });

    const workspaceSpy = jest
      .spyOn(service as any, "materializeLatexWorkspaceFromFolder")
      .mockResolvedValue("latex-workspaces/v2");

    const result = await service.createVersion(
      "d1",
      {
        latexPaths: JSON.stringify(["main.tex"])
      },
      {
        latexFiles: [{ path: "/tmp/upload-main.tex" } as Express.Multer.File]
      },
      {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      }
    );

    expect(workspaceSpy).toHaveBeenCalledWith({
      documentVersionId: "v2",
      latexFiles: [{ path: "/tmp/upload-main.tex" }],
      latexPaths: ["main.tex"]
    });
    expect(prisma.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          compileStatus: CompileStatus.PENDING
        })
      })
    );
    expect(result).toEqual({
      id: "v2",
      documentId: "d1",
      branchId: "b1",
      versionNumber: 2,
      compileStatus: CompileStatus.PENDING
    });
  });

  it("rejects folder upload when latexPaths length does not match files", async () => {
    const { service } = createService();

    await expect(
      service.createVersion(
        "d1",
        {
          latexPaths: JSON.stringify([])
        },
        {
          latexFiles: [{ path: "/tmp/upload-main.tex" } as Express.Multer.File]
        },
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects invalid LaTeX helper inputs and workspace escapes", async () => {
    const { service } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-helpers-"));
    (service as any).storageRoot = storageRoot;

    expect((service as any).normalizeLatexPath("\\chapters\\intro.tex")).toBe("chapters/intro.tex");
    expect(() => (service as any).normalizeLatexPath("")).toThrow(BadRequestException);
    expect(() => (service as any).normalizeLatexPath("../outside.tex")).toThrow(BadRequestException);
    expect(() => (service as any).normalizeLatexPath("-output-directory/main.tex")).toThrow(BadRequestException);
    expect((service as any).normalizeLatexEntryFile("chapters/intro.tex")).toBe("chapters/intro.tex");
    expect(() => (service as any).normalizeLatexEntryFile("main.pdf")).toThrow(BadRequestException);
    expect(() => (service as any).workspaceAbsolutePath("../outside")).toThrow(BadRequestException);
    expect((service as any).parseLatexPaths(undefined)).toBeNull();
    expect(() => (service as any).parseLatexPaths("{")).toThrow(BadRequestException);
    expect(() => (service as any).parseLatexPaths(JSON.stringify({ path: "main.tex" }))).toThrow(BadRequestException);
    expect(() => (service as any).parseLatexPaths(JSON.stringify(["main.tex", 3]))).toThrow(BadRequestException);
    expect(() => (service as any).validateLatexFolderPaths(["main.tex", "main.tex"])).toThrow(BadRequestException);
    expect(() => (service as any).validateLatexFolderPaths(["../escape.tex"])).toThrow(BadRequestException);
  });

  it("rejects ZIP bundles that try to escape the LaTeX workspace", async () => {
    const { service, storageService } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-zip-"));
    (service as any).storageRoot = storageRoot;

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addFile("C:/escape.tex", Buffer.from("escape"));
    storageService.readObject.mockResolvedValue(zip.toBuffer());

    await expect(
      (service as any).materializeLatexWorkspace({
        documentVersionId: "version-1",
        latexBundleStoragePath: "uploads/bundle.zip"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rolls back version creation when an uploaded ZIP bundle cannot be materialized", async () => {
    const { service, prisma, storageService, auditService } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-version-zip-"));
    (service as any).storageRoot = storageRoot;

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addFile("C:/escape.tex", Buffer.from("escape"));
    storageService.saveUpload.mockResolvedValue({
      id: "bundle-file",
      storagePath: "uploads/bundle.zip"
    });
    storageService.readObject.mockResolvedValue(zip.toBuffer());

    const txDocumentVersion = {
      ...prisma.documentVersion,
      create: jest.fn().mockResolvedValue({
        id: "v-bad-zip",
        documentId: "d1",
        branchId: "b1",
        versionNumber: 2,
        compileStatus: CompileStatus.PENDING
      }),
      update: jest.fn()
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        ...prisma,
        documentVersion: txDocumentVersion
      })
    );

    await expect(
      service.createVersion(
        "d1",
        {},
        {
          latexBundle: [{ path: "/tmp/archive.zip" } as Express.Multer.File]
        },
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(txDocumentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          latexBundleFileId: "bundle-file",
          compileStatus: CompileStatus.PENDING
        })
      })
    );
    expect(txDocumentVersion.update).not.toHaveBeenCalled();
    expect(prisma.documentVersion.create).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it("rejects invalid createVersion source combinations before any upload persistence", async () => {
    const { service, storageService } = createService();
    const user = {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor" as const
    };

    await expect(service.createVersion("d1", { latexPaths: JSON.stringify([]) }, {}, user)).rejects.toBeInstanceOf(
      BadRequestException
    );

    await expect(
      service.createVersion(
        "d1",
        {},
        {
          latexFiles: [{ path: "/tmp/upload-main.tex" } as Express.Multer.File]
        },
        user
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.createVersion(
        "d1",
        { latexPaths: JSON.stringify(["main.tex"]) },
        {
          latexFiles: [{ path: "/tmp/upload-main.tex" } as Express.Multer.File],
          latexBundle: [{ path: "/tmp/archive.zip" } as Express.Multer.File]
        },
        user
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageService.saveUpload).not.toHaveBeenCalled();
  });

  it("throws not found when creating a version for a missing document", async () => {
    const { service, prisma } = createService();
    prisma.document.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.createVersion(
        "missing-document",
        {},
        {},
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates blank latex workspace when no source files are provided", async () => {
    const { service, prisma } = createService();
    prisma.documentVersion.create.mockResolvedValue({
      id: "v2",
      documentId: "d1",
      branchId: "b1",
      versionNumber: 2,
      compileStatus: CompileStatus.PENDING
    });
    prisma.documentVersion.update.mockResolvedValue({
      id: "v2",
      documentId: "d1",
      branchId: "b1",
      versionNumber: 2,
      compileStatus: CompileStatus.PENDING
    });

    const workspaceSpy = jest
      .spyOn(service as any, "materializeDefaultLatexWorkspace")
      .mockResolvedValue("latex-workspaces/v2");

    const result = await service.createVersion(
      "d1",
      {},
      {},
      {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      }
    );

    expect(workspaceSpy).toHaveBeenCalledWith({
      documentVersionId: "v2"
    });
    expect(prisma.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          compileStatus: CompileStatus.PENDING
        })
      })
    );
    expect(result).toEqual({
      id: "v2",
      documentId: "d1",
      branchId: "b1",
      versionNumber: 2,
      compileStatus: CompileStatus.PENDING
    });
  });

  it("materializes ultra-minimal default latex workspace files", async () => {
    const { service } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-"));
    (service as any).storageRoot = storageRoot;

    const relativePath = await (service as any).materializeDefaultLatexWorkspace({
      documentVersionId: "version-blank"
    });

    const workspaceAbsolute = resolve(storageRoot, relativePath);
    const mainTex = await readFile(join(workspaceAbsolute, "main.tex"), "utf8");
    const referencesBib = await readFile(join(workspaceAbsolute, "references.bib"), "utf8");
    const entries = await readdir(workspaceAbsolute);

    expect(relativePath).toBe("latex-workspaces/version-blank");
    expect(mainTex).toContain("\\documentclass{article}");
    expect(mainTex).toContain("\\graphicspath{{Figures/}}");
    expect(referencesBib).toContain("% Add bibliography entries here.");
    expect(entries).toContain("Figures");
  });

  it("queues compilation for a version with editable latex source", async () => {
    const { service, prisma, accessService, queueService, auditService } = createService();
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v1",
      latexBundleFileId: null,
      latexWorkspacePath: "latex-workspaces/v1",
      document: {
        projectId: "p1"
      }
    });
    prisma.documentCompileJob.create.mockResolvedValue({ id: "compile-1" });
    queueService.enqueueCompile.mockResolvedValue("queue-job-1");
    prisma.documentCompileJob.update.mockResolvedValue({});
    prisma.documentVersion.update.mockResolvedValue({});

    const result = await service.enqueueCompile("v1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(prisma.documentCompileJob.create).toHaveBeenCalledWith({
      data: {
        documentVersionId: "v1",
        status: CompileStatus.PENDING
      },
      select: {
        id: true
      }
    });
    expect(queueService.enqueueCompile).toHaveBeenCalledWith({
      documentVersionId: "v1",
      compileJobId: "compile-1"
    });
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: {
        compileStatus: CompileStatus.PENDING,
        compileLog: null
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.version.compile_queued",
        metadata: {
          compileJobId: "compile-1",
          queueJobId: "queue-job-1"
        }
      })
    );
    expect(result).toEqual({
      compileJobId: "compile-1",
      documentVersionId: "v1",
      status: CompileStatus.PENDING
    });
  });

  it("rejects compilation for versions without editable latex source", async () => {
    const { service, prisma } = createService();
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v1",
      latexBundleFileId: null,
      latexWorkspacePath: null,
      document: {
        projectId: "p1"
      }
    });

    await expect(
      service.enqueueCompile("v1", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns the compiled PDF when available", async () => {
    const { service, prisma, accessService, storageService } = createService();
    storageService.readObject.mockResolvedValue(Buffer.from("compiled-pdf"));
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v1",
      document: {
        projectId: "p1"
      },
      compiledPdfFile: {
        storagePath: "compiled/output.pdf",
        originalName: "compiled-output.pdf"
      },
      pdfFile: {
        storagePath: "uploads/original.pdf",
        originalName: "original.pdf"
      }
    });

    await expect(
      service.getPdfBytes("v1", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual({
      buffer: Buffer.from("compiled-pdf"),
      fileName: "compiled-output.pdf"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("u1", "reader", "p1");
    expect(storageService.readObject).toHaveBeenCalledWith("compiled/output.pdf");
  });

  it("falls back to the originally uploaded PDF when no compiled artifact exists", async () => {
    const { service, prisma, storageService } = createService();
    storageService.readObject.mockResolvedValue(Buffer.from("original-pdf"));
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v1",
      document: {
        projectId: "p1"
      },
      compiledPdfFile: null,
      pdfFile: {
        storagePath: "uploads/original.pdf",
        originalName: "original.pdf"
      }
    });

    await expect(
      service.getPdfBytes("v1", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual({
      buffer: Buffer.from("original-pdf"),
      fileName: "original.pdf"
    });
  });

  it("rejects PDF download when the version has no PDF artifact", async () => {
    const { service, prisma } = createService();
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v1",
      document: {
        projectId: "p1"
      },
      compiledPdfFile: null,
      pdfFile: null
    });

    await expect(
      service.getPdfBytes("v1", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lists a LaTeX workspace tree recursively", async () => {
    const { service, prisma } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-tree-"));
    const workspacePath = "latex-workspaces/version-tree";
    const workspaceAbsolute = resolve(storageRoot, workspacePath);
    await mkdir(join(workspaceAbsolute, "chapters"), { recursive: true });
    await writeFile(join(workspaceAbsolute, "main.tex"), "\\section{Intro}", "utf8");
    await writeFile(join(workspaceAbsolute, "chapters", "chapter1.tex"), "\\section{One}", "utf8");
    (service as any).storageRoot = storageRoot;
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v-tree",
      latexWorkspacePath: workspacePath,
      document: {
        projectId: "p1"
      }
    });

    const result = await service.getLatexTree("v-tree", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "reader"
    });

    expect(result).toEqual({
      documentVersionId: "v-tree",
      files: [
        { path: "chapters", isDirectory: true },
        { path: "chapters/chapter1.tex", isDirectory: false },
        { path: "main.tex", isDirectory: false }
      ]
    });
  });

  it("reads a file from the LaTeX workspace", async () => {
    const { service, prisma } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-file-"));
    const workspacePath = "latex-workspaces/version-file";
    const workspaceAbsolute = resolve(storageRoot, workspacePath);
    await mkdir(join(workspaceAbsolute, "sections"), { recursive: true });
    await writeFile(join(workspaceAbsolute, "sections", "intro.tex"), "Intro text", "utf8");
    (service as any).storageRoot = storageRoot;
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v-file",
      latexWorkspacePath: workspacePath,
      document: {
        projectId: "p1"
      }
    });

    await expect(
      service.getLatexFile(
        "v-file",
        "sections/intro.tex",
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "reader"
        }
      )
    ).resolves.toEqual({
      documentVersionId: "v-file",
      path: "sections/intro.tex",
      content: "Intro text"
    });
  });

  it("updates a LaTeX file, resets compile status, and returns the written size", async () => {
    const { service, prisma, accessService, auditService } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-update-"));
    const workspacePath = "latex-workspaces/version-update";
    (service as any).storageRoot = storageRoot;
    prisma.documentVersion.findFirst.mockResolvedValue({
      id: "v-update",
      latexWorkspacePath: workspacePath,
      document: {
        projectId: "p1"
      }
    });
    prisma.documentVersion.update.mockResolvedValue({});

    const result = await service.updateLatexFile(
      "v-update",
      "chapters/results.tex",
      "Updated results",
      {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(prisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "v-update" },
      data: {
        compileStatus: CompileStatus.PENDING,
        compileLog: null
      }
    });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "u1",
      projectId: "p1",
      entityType: "document_latex_file",
      entityId: "v-update:chapters/results.tex",
      action: "document.version.latex_file.update"
    });
    expect(result).toEqual({
      documentVersionId: "v-update",
      path: "chapters/results.tex",
      sizeBytes: Buffer.byteLength("Updated results", "utf8")
    });
    await expect(readFile(resolve(storageRoot, workspacePath, "chapters", "results.tex"), "utf8")).resolves.toBe(
      "Updated results"
    );
  });

  it("rejects folder materialization when an uploaded file is missing its latex path", async () => {
    const { service } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-folder-"));
    const uploadPath = join(storageRoot, "upload-main.tex");
    await writeFile(uploadPath, "\\section{Intro}", "utf8");
    (service as any).storageRoot = storageRoot;

    await expect(
      (service as any).materializeLatexWorkspaceFromFolder({
        documentVersionId: "v-folder",
        latexFiles: [{ path: uploadPath } as Express.Multer.File],
        latexPaths: [undefined] as unknown as string[]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects LaTeX tree and file access when the version is missing, has no workspace, or uses an invalid path", async () => {
    const { service, prisma } = createService();
    const storageRoot = await mkdtemp(join(tmpdir(), "atlasium-docs-invalid-file-"));
    const workspacePath = "latex-workspaces/version-invalid";
    const workspaceAbsolute = resolve(storageRoot, workspacePath);
    await mkdir(workspaceAbsolute, { recursive: true });
    (service as any).storageRoot = storageRoot;

    prisma.documentVersion.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "v-no-workspace",
        latexWorkspacePath: null,
        document: {
          projectId: "p1"
        }
      })
      .mockResolvedValueOnce({
        id: "v-read",
        latexWorkspacePath: workspacePath,
        document: {
          projectId: "p1"
        }
      })
      .mockResolvedValueOnce({
        id: "v-write",
        latexWorkspacePath: workspacePath,
        document: {
          projectId: "p1"
        }
      });

    await expect(
      service.getLatexTree("missing-version", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.getLatexTree("v-no-workspace", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.getLatexFile(
        "v-read",
        "../escape.tex",
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "reader"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.updateLatexFile(
        "v-write",
        "../escape.tex",
        "content",
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("soft-deletes document, branches, and versions and logs audit", async () => {
    const { service, prisma, accessService, auditService } = createService();
    const deletedAt = new Date("2026-03-28T10:15:00.000Z");
    prisma.document.findFirst.mockResolvedValueOnce({
      id: "d1",
      projectId: "p1"
    });
    prisma.document.update.mockResolvedValueOnce({
      id: "d1",
      deletedAt
    });

    const result = await service.deleteDocument("d1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });
    const versionDeletedAt = prisma.documentVersion.updateMany.mock.calls[0][0].data.deletedAt;
    const branchDeletedAt = prisma.documentBranch.updateMany.mock.calls[0][0].data.deletedAt;
    const documentDeletedAt = prisma.document.update.mock.calls[0][0].data.deletedAt;

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(prisma.documentVersion.updateMany).toHaveBeenCalledWith({
      where: {
        documentId: "d1",
        deletedAt: null
      },
      data: {
        deletedAt: expect.any(Date)
      }
    });
    expect(prisma.documentBranch.updateMany).toHaveBeenCalledWith({
      where: {
        documentId: "d1",
        deletedAt: null
      },
      data: {
        deletedAt: expect.any(Date)
      }
    });
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: {
        id: "d1"
      },
      data: {
        deletedAt: expect.any(Date)
      },
      select: {
        id: true,
        deletedAt: true
      }
    });
    expect(versionDeletedAt).toBeInstanceOf(Date);
    expect(branchDeletedAt).toBe(versionDeletedAt);
    expect(documentDeletedAt).toBe(versionDeletedAt);
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "u1",
      projectId: "p1",
      entityType: "document",
      entityId: "d1",
      action: "document.delete"
    });
    expect(result).toEqual({
      id: "d1",
      deletedAt: deletedAt.toISOString()
    });
  });

  it("throws not found when deleting a missing document", async () => {
    const { service, prisma } = createService();
    prisma.document.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.deleteDocument("missing", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("queries compile log only for active versions under active branches and documents", async () => {
    const { service, prisma } = createService();
    prisma.documentVersion.findFirst.mockResolvedValueOnce({
      id: "v1",
      compileStatus: CompileStatus.PENDING,
      compileLog: null,
      compiledPdfFileId: null,
      document: {
        projectId: "p1"
      }
    });

    await service.getCompileLog("v1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });

    expect(prisma.documentVersion.findFirst).toHaveBeenCalledWith({
      where: {
        id: "v1",
        deletedAt: null,
        branch: {
          deletedAt: null
        },
        document: {
          deletedAt: null
        }
      },
      select: {
        id: true,
        compileStatus: true,
        compileLog: true,
        compiledPdfFileId: true,
        document: {
          select: {
            projectId: true
          }
        }
      }
    });
  });
});
