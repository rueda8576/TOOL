import { BadRequestException, NotFoundException } from "@nestjs/common";

import { WikiAssetsService } from "./wiki-assets.service";

describe("WikiAssetsService", () => {
  const user = {
    userId: "editor-1",
    email: "editor@example.com",
    globalRole: "editor"
  } as const;

  const makeService = () => {
    const prisma: any = {
      fileObject: {
        findUnique: jest.fn()
      },
      wikiAsset: {
        create: jest.fn(),
        findFirst: jest.fn()
      }
    };
    const accessService: any = {
      ensureProjectWritable: jest.fn().mockResolvedValue(undefined),
      ensureProjectReadable: jest.fn().mockResolvedValue(undefined)
    };
    const auditService: any = {
      log: jest.fn().mockResolvedValue(undefined)
    };
    const storageService: any = {
      saveUpload: jest.fn(),
      readObject: jest.fn()
    };

    return {
      service: new WikiAssetsService(prisma, accessService, auditService, storageService),
      prisma,
      accessService,
      auditService,
      storageService
    };
  };

  it("rejects missing, unsupported, SVG, and oversized uploads before storage writes", async () => {
    const { service, storageService } = makeService();

    await expect(service.uploadWikiAsset("project-1", undefined, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadWikiAsset("project-1", { mimetype: "text/plain", size: 128 } as Express.Multer.File, user)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadWikiAsset("project-1", { mimetype: ["image/svg", "xml"].join("+"), size: 128 } as Express.Multer.File, user)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadWikiAsset("project-1", { mimetype: "image/png", size: 10 * 1024 * 1024 + 1 } as Express.Multer.File, user)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageService.saveUpload).not.toHaveBeenCalled();
  });

  it("stores valid wiki images and returns asset metadata", async () => {
    const { service, prisma, storageService, auditService, accessService } = makeService();
    storageService.saveUpload.mockResolvedValue({ id: "file-1" });
    prisma.fileObject.findUnique.mockResolvedValue({
      id: "file-1",
      mimeType: "image/png",
      sizeBytes: BigInt(12),
      originalName: "diagram.png"
    });
    prisma.wikiAsset.create.mockResolvedValue({ id: "asset-1" });

    await expect(
      service.uploadWikiAsset(
        "project-1",
        {
          originalname: "diagram.png",
          mimetype: "image/png",
          size: 12
        } as Express.Multer.File,
        user
      )
    ).resolves.toEqual({
      assetId: "asset-1",
      url: "/wiki-assets/asset-1/content",
      mimeType: "image/png",
      sizeBytes: 12,
      originalName: "diagram.png"
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "wiki.asset.upload" }));
  });

  it("fails when uploaded file metadata cannot be reloaded", async () => {
    const { service, prisma, storageService } = makeService();
    storageService.saveUpload.mockResolvedValue({ id: "file-1" });
    prisma.fileObject.findUnique.mockResolvedValue(null);

    await expect(
      service.uploadWikiAsset("project-1", { originalname: "diagram.png", mimetype: "image/png", size: 12 } as Express.Multer.File, user)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("loads wiki asset content after checking project read access", async () => {
    const { service, prisma, storageService, accessService } = makeService();
    prisma.wikiAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      projectId: "project-1",
      fileObject: {
        storagePath: "wiki/asset-1.png",
        mimeType: "image/png",
        originalName: "asset.png"
      }
    });
    storageService.readObject.mockResolvedValue(Buffer.from("png-bytes"));

    await expect(service.getWikiAssetContent("asset-1", user)).resolves.toEqual({
      buffer: Buffer.from("png-bytes"),
      mimeType: "image/png",
      fileName: "asset.png"
    });
    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
  });

  it("returns not found for missing assets", async () => {
    const { service, prisma } = makeService();
    prisma.wikiAsset.findFirst.mockResolvedValue(null);

    await expect(service.getWikiAssetContent("missing-asset", user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
