describe("Worker env", () => {
  const originalEnv = process.env;

  afterEach(() => {
    jest.resetModules();
    process.env = originalEnv;
  });

  it("keeps meeting automation disabled unless explicitly enabled", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test"
    };
    delete process.env.AI_MEETING_AUTOMATION_ENABLED;
    delete process.env.JWT_SECRET;

    const { getEnv } = await import("./env");
    expect(getEnv()).toEqual(expect.objectContaining({
      AI_MEETING_AUTOMATION_ENABLED: false,
      JWT_SECRET: "change-me-in-production"
    }));

    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      AI_MEETING_AUTOMATION_ENABLED: "true"
    };

    const enabledEnv = await import("./env");
    expect(enabledEnv.getEnv().AI_MEETING_AUTOMATION_ENABLED).toBe(true);
  });

  it("normalizes empty optional values and returns the cached env instance", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      AI_MEETING_AUTOMATION_ENABLED: "",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      OPENAI_BASE_URL: ""
    };

    const { getEnv } = await import("./env");
    const firstEnv = getEnv();

    expect(firstEnv.AI_MEETING_AUTOMATION_ENABLED).toBe(false);
    expect(firstEnv.OPENAI_API_KEY).toBeUndefined();
    expect(firstEnv.OPENAI_MODEL).toBeUndefined();
    expect(firstEnv.OPENAI_BASE_URL).toBeUndefined();
    expect(getEnv()).toBe(firstEnv);
  });

  it("sets the worker health port and allows disabling the endpoint with zero", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test"
    };
    delete process.env.WORKER_HEALTH_PORT;

    const { getEnv } = await import("./env");
    expect(getEnv().WORKER_HEALTH_PORT).toBe(4100);

    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      WORKER_HEALTH_PORT: "0"
    };

    const disabledEnv = await import("./env");
    expect(disabledEnv.getEnv().WORKER_HEALTH_PORT).toBe(0);
  });

  it("allows production meeting automation when required OpenAI settings are present", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      AI_MEETING_AUTOMATION_ENABLED: "true",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-test",
      OPENAI_BASE_URL: "https://api.example.test/v1"
    };

    const { getEnv } = await import("./env");

    expect(getEnv()).toEqual(expect.objectContaining({
      AI_MEETING_AUTOMATION_ENABLED: true,
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-test",
      OPENAI_BASE_URL: "https://api.example.test/v1"
    }));
  });

  it("requires OpenAI credentials when meeting automation is enabled in production", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      AI_MEETING_AUTOMATION_ENABLED: "true"
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

    const { getEnv } = await import("./env");
    expect(() => getEnv()).toThrow("OPENAI_API_KEY is required when meeting automation is enabled in production");
  });
});
