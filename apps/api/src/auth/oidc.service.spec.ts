import { JwtService } from "@nestjs/jwt";
import { createHash, generateKeyPairSync } from "crypto";

describe("OidcService", () => {
  const originalEnv = { ...process.env };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const redirectUri = "https://git.atlasium.info/users/auth/openid_connect/callback";
  const decodeJwtHeader = (token: string): Record<string, unknown> => {
    return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  const loadService = async () => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      APP_BASE_URL: "https://atlasium.info",
      ATLASIUM_SESSION_COOKIE_NAME: "atlasium_session",
      ATLASIUM_OIDC_CLIENT_ID: "atlasium-oidc",
      ATLASIUM_OIDC_CLIENT_SECRET: "atlasium-secret",
      ATLASIUM_OIDC_PRIVATE_KEY_BASE64: Buffer.from(privateKey).toString("base64"),
      GITLAB_EXTERNAL_URL: "https://git.atlasium.info"
    };

    const prisma: any = {
      oidcAuthorizationCode: {
        create: jest.fn().mockResolvedValue(undefined),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined)
      },
      user: {
        findFirst: jest.fn()
      }
    };
    const sessionAuthService: any = {
      authenticateToken: jest.fn()
    };

    const { OidcService } = await import("./oidc.service");

    return {
      service: new OidcService(prisma, sessionAuthService, new JwtService({ secret: "integration-secret-123" })),
      prisma,
      sessionAuthService
    };
  };

  it("exposes discovery metadata and JWKS for GitLab", async () => {
    const { service } = await loadService();

    expect(service.getDiscoveryDocument()).toEqual(
      expect.objectContaining({
        issuer: "https://atlasium.info/api/auth/oidc",
        authorization_endpoint: "https://atlasium.info/api/auth/oidc/authorize",
        token_endpoint: "https://atlasium.info/api/auth/oidc/token",
        userinfo_endpoint: "https://atlasium.info/api/auth/oidc/userinfo",
        jwks_uri: "https://atlasium.info/api/auth/oidc/jwks"
      })
    );

    expect(service.getJwks().keys[0]).toEqual(
      expect.objectContaining({
        use: "sig",
        alg: "RS256",
        kid: expect.any(String)
      })
    );
  });

  it("redirects to Atlasium login when the user has no valid session cookie", async () => {
    const { service } = await loadService();

    await expect(
      service.authorize(
        {
          client_id: "atlasium-oidc",
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "openid email profile",
          state: "state-1"
        },
        {
          headers: {},
          originalUrl: "/api/auth/oidc/authorize?client_id=atlasium-oidc",
          url: "/api/auth/oidc/authorize?client_id=atlasium-oidc"
        } as any
      )
    ).resolves.toBe(
      "https://atlasium.info/login?returnTo=https%3A%2F%2Fatlasium.info%2Fapi%2Fauth%2Foidc%2Fauthorize%3Fclient_id%3Datlasium-oidc"
    );
  });

  it("creates an authorization code for authenticated users and preserves state", async () => {
    const { service, prisma, sessionAuthService } = await loadService();
    sessionAuthService.authenticateToken.mockResolvedValue({ userId: "user-1" });

    const redirect = await service.authorize(
      {
        client_id: "atlasium-oidc",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: "state-2",
        nonce: "nonce-1",
        code_challenge: "challenge-1",
        code_challenge_method: "plain"
      },
      {
        headers: { cookie: "atlasium_session=session-token" },
        originalUrl: "/api/auth/oidc/authorize",
        url: "/api/auth/oidc/authorize"
      } as any
    );

    expect(sessionAuthService.authenticateToken).toHaveBeenCalledWith("session-token", {
      invalidToken: "Invalid session",
      expiredSession: "Session expired"
    });
    expect(prisma.oidcAuthorizationCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: "atlasium-oidc",
        userId: "user-1",
        redirectUri,
        scope: "openid email profile",
        nonce: "nonce-1",
        codeChallenge: "challenge-1",
        codeChallengeMethod: "plain",
        expiresAt: expect.any(Date)
      })
    });
    expect(redirect).toContain(`${redirectUri}?code=`);
    expect(redirect).toContain("state=state-2");
  });

  it("exchanges authorization codes for tokens and returns userinfo from the signed access token", async () => {
    const { service, prisma } = await loadService();
    const verifier = "verifier-123";
    prisma.oidcAuthorizationCode.findFirst.mockResolvedValue({
      id: "oidc-code-1",
      scope: "openid email profile",
      nonce: "nonce-1",
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      codeChallengeMethod: "S256",
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User One",
        deletedAt: null,
        isActive: true
      }
    });
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One"
    });

    const tokenResponse = await service.exchangeToken(
      {
        headers: {},
        body: {}
      } as any,
      {
        grant_type: "authorization_code",
        code: "authorization-code",
        redirect_uri: redirectUri,
        client_id: "atlasium-oidc",
        client_secret: "atlasium-secret",
        code_verifier: verifier
      }
    );

    expect(prisma.oidcAuthorizationCode.update).toHaveBeenCalledWith({
      where: { id: "oidc-code-1" },
      data: { consumedAt: expect.any(Date) }
    });
    expect(tokenResponse).toEqual(
      expect.objectContaining({
        token_type: "Bearer",
        expires_in: 600,
        scope: "openid email profile",
        access_token: expect.any(String),
        id_token: expect.any(String)
      })
    );

    const jwk = service.getJwks().keys[0];
    const accessToken = tokenResponse.access_token as string;
    const idToken = tokenResponse.id_token as string;
    const verifierService = new JwtService();
    expect(decodeJwtHeader(accessToken)).toEqual(expect.objectContaining({ alg: "RS256", kid: jwk.kid }));
    expect(decodeJwtHeader(idToken)).toEqual(expect.objectContaining({ alg: "RS256", kid: jwk.kid }));
    expect(
      verifierService.verify(accessToken, {
        algorithms: ["RS256"],
        secret: publicKey,
        issuer: "https://atlasium.info/api/auth/oidc",
        audience: "atlasium-oidc"
      })
    ).toEqual(expect.objectContaining({ sub: "user-1", token_use: "userinfo" }));
    expect(
      verifierService.verify(idToken, {
        algorithms: ["RS256"],
        secret: publicKey,
        issuer: "https://atlasium.info/api/auth/oidc",
        audience: "atlasium-oidc"
      })
    ).toEqual(expect.objectContaining({ sub: "user-1", nonce: "nonce-1" }));

    await expect(
      service.getUserInfo({
        headers: {
          authorization: `Bearer ${tokenResponse.access_token as string}`
        }
      } as any)
    ).resolves.toEqual({
      sub: "user-1",
      email: "user@example.com",
      email_verified: true,
      name: "User One",
      preferred_username: "user"
    });
  });

  it("rejects invalid PKCE verifiers", async () => {
    const { service, prisma } = await loadService();
    prisma.oidcAuthorizationCode.findFirst.mockResolvedValue({
      id: "oidc-code-2",
      scope: "openid",
      nonce: null,
      codeChallenge: createHash("sha256").update("expected-verifier").digest("base64url"),
      codeChallengeMethod: "S256",
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User One",
        deletedAt: null,
        isActive: true
      }
    });

    await expect(
      service.exchangeToken(
        { headers: {} } as any,
        {
          grant_type: "authorization_code",
          code: "authorization-code",
          redirect_uri: redirectUri,
          client_id: "atlasium-oidc",
          client_secret: "atlasium-secret",
          code_verifier: "wrong-verifier"
        }
      )
    ).rejects.toMatchObject({
      name: "UnauthorizedException",
      message: "Invalid code_verifier"
    });
  });

  it("rejects malformed authorize requests and missing bearer tokens", async () => {
    const { service } = await loadService();

    await expect(
      service.authorize(
        {
          client_id: "atlasium-oidc",
          redirect_uri: redirectUri,
          response_type: "token",
          scope: "openid"
        },
        { headers: {}, originalUrl: "/api/auth/oidc/authorize", url: "/api/auth/oidc/authorize" } as any
      )
    ).rejects.toMatchObject({
      name: "BadRequestException",
      message: "Unsupported response_type"
    });

    await expect(service.getUserInfo({ headers: {} } as any)).rejects.toMatchObject({
      name: "UnauthorizedException",
      message: "Missing bearer token"
    });
  });
});
