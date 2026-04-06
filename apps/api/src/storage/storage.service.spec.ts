describe("StorageService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-06T10:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
    jest.clearAllMocks();
  });

  const loadService = async () => {
    jest.resetModules();
    const fsMocks = {
      mkdir: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn(),
      rm: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined)
    };

    jest.doMock("fs/promises", () => fsMocks);
    jest.doMock("../config/env", () => ({
      getEnv: () => ({
        STORAGE_ROOT: "/tmp/atlasium-storage",
        PDF_UPLOAD_LIMIT_BYTES: 1024
      })
    }));

    const { StorageService } = await import("./storage.service");
    const prisma: any = {
      fileObject: {
        create: jest.fn().mockImplementation(async ({ data }: { data: { storagePath: string } }) => ({
          id: "file-1",
          storagePath: data.storagePath
        }))
      }
    };

    return { service: new StorageService(prisma), prisma, fsMocks };
  };

  it("rejects missing uploads", async () => {
    const { service } = await loadService();

    await expect(service.saveUpload(undefined as never)).rejects.toMatchObject({
      name: "BadRequestException",
      message: "Missing file upload"
    });
  });

  it("rejects uploads that exceed the configured size limit", async () => {
    const { service } = await loadService();

    await expect(
      service.saveUpload({ size: 4096, originalname: "paper.pdf", mimetype: "application/pdf", buffer: Buffer.from("x") } as any)
    ).rejects.toThrow("File size exceeds 1024 bytes");
  });

  it("saves buffered uploads and removes the temp file when present", async () => {
    const { service, prisma, fsMocks } = await loadService();

    const result = await service.saveUpload({
      size: 4,
      originalname: "paper draft.pdf",
      mimetype: "application/pdf",
      buffer: Buffer.from("pdf!"),
      path: "/tmp/upload-1"
    } as any);

    expect(fsMocks.mkdir).toHaveBeenCalledWith("/tmp/atlasium-storage/2026-04-06", { recursive: true });
    expect(fsMocks.writeFile).toHaveBeenCalledWith(expect.stringContaining("paper_draft.pdf"), Buffer.from("pdf!"));
    expect(fsMocks.rm).toHaveBeenCalledWith("/tmp/upload-1", { force: true });
    expect(prisma.fileObject.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalName: "paper draft.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(4)
      }),
      select: {
        id: true,
        storagePath: true
      }
    });
    expect(result.storagePath).toContain("paper_draft.pdf");
  });

  it("falls back to reading the temporary file when multer did not populate buffer", async () => {
    const { service, fsMocks } = await loadService();
    fsMocks.readFile.mockResolvedValue(Buffer.from("from-disk"));

    const result = await service.saveUpload({
      size: 9,
      originalname: "archive.zip",
      mimetype: "application/zip",
      buffer: Buffer.alloc(0),
      path: "/tmp/upload-2"
    } as any);

    expect(fsMocks.readFile).toHaveBeenCalledWith("/tmp/upload-2");
    expect(result.storagePath).toContain("archive.zip");
  });

  it("saves raw buffers and maps missing objects to an internal error", async () => {
    const { service, fsMocks } = await loadService();
    fsMocks.readFile.mockRejectedValueOnce(new Error("missing"));

    await expect(
      service.saveBuffer({
        buffer: Buffer.from("pdf"),
        fileName: "report.pdf",
        mimeType: "application/pdf",
        uploadedById: "user-1"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: "file-1",
        storagePath: expect.stringContaining("report.pdf")
      })
    );

    await expect(service.readObject("missing/file.pdf")).rejects.toMatchObject({
      name: "InternalServerErrorException",
      message: "Stored file is unavailable"
    });
  });
});
