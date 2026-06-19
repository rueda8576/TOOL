import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";
import { OidcService } from "../../src/auth/oidc.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("AuthController HTTP", () => {
  let app: INestApplication;
  let authService: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      invite: jest.fn(),
      acceptInvite: jest.fn(),
      requestPasswordReset: jest.fn(),
      confirmPasswordReset: jest.fn(),
      getCurrentUserProfile: jest.fn(),
      updateUsername: jest.fn(),
      changePassword: jest.fn(),
      getGitlabConnectionStatus: jest.fn(),
      beginGitlabConnect: jest.fn(),
      disconnectGitlabConnection: jest.fn(),
      syncGitlabHttpsPassword: jest.fn(),
      listGitlabSshKeys: jest.fn(),
      createGitlabSshKey: jest.fn(),
      deleteGitlabSshKey: jest.fn(),
      completeGitlabConnectCallback: jest.fn()
    };

    const oidcService = {
      getDiscoveryDocument: jest.fn(),
      getJwks: jest.fn(),
      authorize: jest.fn(),
      exchangeToken: jest.fn(),
      getUserInfo: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: OidcService, useValue: oidcService }
      ]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when invite is called without authentication", async () => {
    await request(app.getHttpServer()).post("/auth/invite").send({ email: "invitee@example.com" }).expect(401);
  });

  it("returns 403 when a non-admin user attempts to invite", async () => {
    await request(app.getHttpServer())
      .post("/auth/invite")
      .set(authHeaders("reader"))
      .send({ email: "invitee@example.com" })
      .expect(403);
  });

  it("returns 400 for malformed login payloads", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "not-an-email", password: "short" })
      .expect(400);
  });

  it("logs in successfully and sets the session cookie header", async () => {
    authService.login.mockResolvedValue({
      token: "jwt-token",
      expiresAt: new Date("2026-04-13T10:00:00.000Z"),
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User",
        globalRole: "editor"
      }
    });

    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "user@example.com", password: "password-123" })
      .expect(201);

    expect(authService.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password-123"
    });
    expect(response.headers["set-cookie"][0]).toContain("atlasium_session=jwt-token");
    expect(response.body).toEqual({
      token: "jwt-token",
      expiresAt: "2026-04-13T10:00:00.000Z",
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User",
        globalRole: "editor"
      }
    });
  });

  it("accepts invites and forwards the DTO untouched", async () => {
    authService.acceptInvite.mockResolvedValue({
      token: "invite-token",
      userId: "user-2",
      projectId: "project-1",
      projectIds: ["project-1"]
    });

    const response = await request(app.getHttpServer())
      .post("/auth/accept-invite")
      .send({
        token: "invite-token",
        name: "New User",
        password: "password-123"
      })
      .expect(201);

    expect(authService.acceptInvite).toHaveBeenCalledWith({
      token: "invite-token",
      name: "New User",
      password: "password-123"
    });
    expect(response.body.userId).toBe("user-2");
  });

  it("accepts password reset requests", async () => {
    authService.requestPasswordReset.mockResolvedValue({ accepted: true });

    await request(app.getHttpServer())
      .post("/auth/password/reset")
      .send({ email: "user@example.com" })
      .expect(201);

    expect(authService.requestPasswordReset).toHaveBeenCalledWith({
      email: "user@example.com"
    });
  });

  it("confirms password reset requests", async () => {
    authService.confirmPasswordReset.mockResolvedValue({ reset: true });

    await request(app.getHttpServer())
      .post("/auth/password/reset/confirm")
      .send({
        token: "reset-token",
        newPassword: "new-password-123",
        confirmPassword: "new-password-123"
      })
      .expect(201);

    expect(authService.confirmPasswordReset).toHaveBeenCalledWith({
      token: "reset-token",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    });
  });

  it("returns 400 for malformed password reset confirmations", async () => {
    await request(app.getHttpServer())
      .post("/auth/password/reset/confirm")
      .send({
        token: "reset-token",
        newPassword: "short",
        confirmPassword: "short"
      })
      .expect(400);
  });

  it("returns 401 for authenticated profile without a bearer token", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("returns the authenticated user's profile", async () => {
    authService.getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      name: "Account User",
      email: "user@example.com",
      username: "account",
      globalRole: "editor",
      timezone: "Europe/Madrid"
    });

    const response = await request(app.getHttpServer())
      .get("/auth/me")
      .set(authHeaders("editor", { userId: "user-1", email: "user@example.com" }))
      .expect(200);

    expect(authService.getCurrentUserProfile).toHaveBeenCalledWith({
      userId: "user-1",
      email: "user@example.com",
      globalRole: "editor"
    });
    expect(response.body).toEqual({
      id: "user-1",
      name: "Account User",
      email: "user@example.com",
      username: "account",
      globalRole: "editor",
      timezone: "Europe/Madrid"
    });
  });

  it("updates the authenticated user's username", async () => {
    authService.updateUsername.mockResolvedValue({
      id: "user-1",
      name: "Account User",
      email: "user@example.com",
      username: "new-user",
      globalRole: "editor",
      timezone: "Europe/Madrid"
    });

    const response = await request(app.getHttpServer())
      .patch("/auth/me/username")
      .set(authHeaders("editor", { userId: "user-1", email: "user@example.com" }))
      .send({ username: "new-user" })
      .expect(200);

    expect(authService.updateUsername).toHaveBeenCalledWith(
      {
        userId: "user-1",
        email: "user@example.com",
        globalRole: "editor"
      },
      {
        username: "new-user"
      }
    );
    expect(response.body).toEqual({
      id: "user-1",
      name: "Account User",
      email: "user@example.com",
      username: "new-user",
      globalRole: "editor",
      timezone: "Europe/Madrid"
    });
  });

  it("returns 401 for password change without a bearer token", async () => {
    await request(app.getHttpServer())
      .post("/auth/password/change")
      .send({
        currentPassword: "password-123",
        newPassword: "new-password-456",
        confirmPassword: "new-password-456"
      })
      .expect(401);
  });

  it("returns 400 for malformed password-change payloads", async () => {
    await request(app.getHttpServer())
      .post("/auth/password/change")
      .set(authHeaders("editor"))
      .send({
        currentPassword: "short",
        newPassword: "tiny",
        confirmPassword: "tiny"
      })
      .expect(400);
  });

  it("changes the password for the authenticated user", async () => {
    authService.changePassword.mockResolvedValue({ changed: true });

    const response = await request(app.getHttpServer())
      .post("/auth/password/change")
      .set(authHeaders("editor", { userId: "editor-2", email: "editor-2@example.com" }))
      .send({
        currentPassword: "password-123",
        newPassword: "new-password-456",
        confirmPassword: "new-password-456"
      })
      .expect(201);

    expect(authService.changePassword).toHaveBeenCalledWith(
      {
        userId: "editor-2",
        email: "editor-2@example.com",
        globalRole: "editor"
      },
      "editor:editor-2:editor-2@example.com",
      {
        currentPassword: "password-123",
        newPassword: "new-password-456",
        confirmPassword: "new-password-456"
      }
    );
    expect(response.body).toEqual({ changed: true });
  });

  it("returns 401 when GitLab HTTPS password sync is called without authentication", async () => {
    await request(app.getHttpServer())
      .post("/auth/gitlab/https-password")
      .send({ currentPassword: "password-123" })
      .expect(401);
  });

  it("returns 400 for malformed GitLab HTTPS password sync payloads", async () => {
    await request(app.getHttpServer())
      .post("/auth/gitlab/https-password")
      .set(authHeaders("editor"))
      .send({ currentPassword: "short" })
      .expect(400);
  });

  it("syncs the current user's GitLab HTTPS password", async () => {
    authService.syncGitlabHttpsPassword.mockResolvedValue({
      enabled: true,
      username: "luisjrc"
    });

    const response = await request(app.getHttpServer())
      .post("/auth/gitlab/https-password")
      .set(authHeaders("editor", { userId: "user-1", email: "luis@example.com" }))
      .send({ currentPassword: "password-123" })
      .expect(201);

    expect(authService.syncGitlabHttpsPassword).toHaveBeenCalledWith(
      {
        userId: "user-1",
        email: "luis@example.com",
        globalRole: "editor"
      },
      {
        currentPassword: "password-123"
      }
    );
    expect(response.body).toEqual({
      enabled: true,
      username: "luisjrc"
    });
  });

  it("returns GitLab connection status with HTTPS clone state", async () => {
    authService.getGitlabConnectionStatus.mockResolvedValue({
      connected: true,
      reconnectRequired: false,
      username: "luisjrc",
      name: "Luis",
      email: "luis@example.com",
      avatarUrl: null,
      webUrl: "https://git.atlasium.info/luisjrc",
      httpsClone: {
        enabled: true,
        syncedAt: "2026-06-07T10:00:00.000Z",
        username: "luisjrc"
      }
    });

    const response = await request(app.getHttpServer())
      .get("/auth/gitlab/connection")
      .set(authHeaders("editor", { userId: "user-1", email: "luis@example.com" }))
      .expect(200);

    expect(authService.getGitlabConnectionStatus).toHaveBeenCalledWith({
      userId: "user-1",
      email: "luis@example.com",
      globalRole: "editor"
    });
    expect(response.body).toEqual({
      connected: true,
      reconnectRequired: false,
      username: "luisjrc",
      name: "Luis",
      email: "luis@example.com",
      avatarUrl: null,
      webUrl: "https://git.atlasium.info/luisjrc",
      httpsClone: {
        enabled: true,
        syncedAt: "2026-06-07T10:00:00.000Z",
        username: "luisjrc"
      }
    });
  });

  it("serves OIDC discovery metadata and redirects authorize requests", async () => {
    const oidcService = app.get(OidcService) as unknown as Record<string, jest.Mock>;
    oidcService.getDiscoveryDocument.mockReturnValue({ issuer: "https://atlasium.info/api/auth/oidc" });
    oidcService.authorize.mockResolvedValue("https://git.atlasium.info/users/auth/openid_connect/callback?code=123");

    const discovery = await request(app.getHttpServer())
      .get("/auth/oidc/.well-known/openid-configuration")
      .expect(200);

    const authorize = await request(app.getHttpServer())
      .get("/auth/oidc/authorize")
      .query({
        client_id: "atlasium-oidc",
        redirect_uri: "https://git.atlasium.info/users/auth/openid_connect/callback",
        response_type: "code",
        scope: "openid"
      })
      .expect(302);

    expect(discovery.body).toEqual({ issuer: "https://atlasium.info/api/auth/oidc" });
    expect(oidcService.authorize).toHaveBeenCalled();
    expect(authorize.headers.location).toContain("code=123");
  });

  it("binds SSH key create and delete operations for the current user", async () => {
    authService.createGitlabSshKey.mockResolvedValue({
      id: 7,
      title: "Laptop",
      key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAexample",
      createdAt: "2026-04-06T10:00:00.000Z",
      expiresAt: null,
      usageType: "auth"
    });
    authService.deleteGitlabSshKey.mockResolvedValue({ deleted: true });

    const createResponse = await request(app.getHttpServer())
      .post("/auth/gitlab/ssh-keys")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .send({
        title: "Laptop",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAexample"
      })
      .expect(201);

    const deleteResponse = await request(app.getHttpServer())
      .delete("/auth/gitlab/ssh-keys/7")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(authService.createGitlabSshKey).toHaveBeenCalledWith(
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      {
        title: "Laptop",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAexample"
      }
    );
    expect(authService.deleteGitlabSshKey).toHaveBeenCalledWith(
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "7"
    );
    expect(createResponse.body.id).toBe(7);
    expect(deleteResponse.body).toEqual({ deleted: true });
  });
});
