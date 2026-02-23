import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CompileStatus, DocumentType } from "@prisma/client";

import { DocumentsService } from "./documents.service";

describe("DocumentsService", () => {
  const createService = (): {
    service: DocumentsService;
    prisma: any;
    accessService: any;
    storageService: any;
  } => {
    const prisma: any = {
      document: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1" })
      },
      documentBranch: {
        upsert: jest.fn().mockResolvedValue({ id: "b1" })
      },
      documentVersion: {
        findFirst: jest.fn().mockResolvedValue({ versionNumber: 1 }),
        create: jest.fn(),
        update: jest.fn()
      }
    };

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
      storageService
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

  it("requires at least one source file for version creation", async () => {
    const { service } = createService();

    await expect(
      service.createVersion(
        "d1",
        {},
        {},
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
