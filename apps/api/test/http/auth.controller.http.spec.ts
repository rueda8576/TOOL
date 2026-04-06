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
      getGitlabConnectionStatus: jest.fn(),
      beginGitlabConnect: jest.fn(),
      disconnectGitlabConnection: jest.fn(),
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
        name: "User",
        globalRole: "editor"
      }
    });
  });
});
