describe("worker env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  it("returns defaults when optional variables are missing", async () => {
    delete process.env.REDIS_URL;
    delete process.env.STORAGE_ROOT;
    delete process.env.SMTP_HOST;
    delete process.env.BACKUP_RETENTION_DAYS;

    const { getEnv } = await import("./env");
    expect(getEnv()).toEqual(
      expect.objectContaining({
        REDIS_URL: "redis://localhost:6379",
        STORAGE_ROOT: "./storage",
        SMTP_HOST: "localhost",
        BACKUP_RETENTION_DAYS: 30
      })
    );
  });

  it("parses and caches explicit numeric values", async () => {
    process.env.LATEX_TIMEOUT_MS = "45000";
    process.env.SMTP_PORT = "2525";

    const { getEnv } = await import("./env");
    const first = getEnv();
    const second = getEnv();

    expect(first.LATEX_TIMEOUT_MS).toBe(45000);
    expect(first.SMTP_PORT).toBe(2525);
    expect(second).toBe(first);
  });
});
