describe("worker path helpers", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("builds storage-relative paths and creates subdirectories", async () => {
    const mkdir = jest.fn().mockResolvedValue(undefined);

    jest.doMock("fs/promises", () => ({ mkdir }));
    jest.doMock("../config/env", () => ({
      getEnv: () => ({ STORAGE_ROOT: "/var/lib/atlasium/storage" })
    }));

    const { ensureStorageSubdir, getStoragePath } = await import("./paths");

    expect(getStoragePath("compiled", "2026-04-06", "report.pdf")).toBe(
      "/var/lib/atlasium/storage/compiled/2026-04-06/report.pdf"
    );
    await expect(ensureStorageSubdir("compiled")).resolves.toBe("/var/lib/atlasium/storage/compiled");
    expect(mkdir).toHaveBeenCalledWith("/var/lib/atlasium/storage/compiled", { recursive: true });
  });
});
