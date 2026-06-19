describe("API env", () => {
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

    const { getEnv } = await import("./env");
    expect(getEnv().AI_MEETING_AUTOMATION_ENABLED).toBe(false);

    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      AI_MEETING_AUTOMATION_ENABLED: "true"
    };

    const enabledEnv = await import("./env");
    expect(enabledEnv.getEnv().AI_MEETING_AUTOMATION_ENABLED).toBe(true);
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
