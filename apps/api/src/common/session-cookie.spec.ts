describe("session-cookie helpers", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const loadModule = async (nodeEnv: "development" | "production", cookieName = "atlasium_session") => {
    jest.resetModules();
    jest.doMock("../config/env", () => ({
      getEnv: () => ({
        NODE_ENV: nodeEnv,
        ATLASIUM_SESSION_COOKIE_NAME: cookieName
      })
    }));

    return import("./session-cookie");
  };

  it("builds a development cookie without Secure", async () => {
    const { buildSessionCookie } = await loadModule("development", "atlasium_session");
    const expiresAt = new Date("2026-04-13T12:00:00.000Z");

    const cookie = buildSessionCookie("token=123", expiresAt);

    expect(cookie).toContain("atlasium_session=token%3D123");
    expect(cookie).toContain(`Expires=${expiresAt.toUTCString()}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("; Secure");
  });

  it("builds a production cookie with Secure", async () => {
    const { buildSessionCookie, clearSessionCookie } = await loadModule("production", "atlasium_prod");

    expect(buildSessionCookie("secret-token")).toContain("; Secure");
    expect(clearSessionCookie()).toContain("atlasium_prod=");
    expect(clearSessionCookie()).toContain("; Secure");
  });

  it("reads encoded cookie values and returns null when missing", async () => {
    const { readCookieValue } = await loadModule("development");

    expect(readCookieValue("other=1; atlasium_session=abc%20123", "atlasium_session")).toBe("abc 123");
    expect(readCookieValue(undefined, "atlasium_session")).toBeNull();
    expect(readCookieValue("other=1", "atlasium_session")).toBeNull();
  });
});
