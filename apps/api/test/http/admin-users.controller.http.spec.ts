import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AdminUsersController } from "../../src/admin/admin-users.controller";
import { AdminUsersService } from "../../src/admin/admin-users.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("AdminUsersController HTTP", () => {
  let app: INestApplication;
  let adminUsersService: Record<string, jest.Mock>;

  beforeEach(async () => {
    adminUsersService = {
      listUsers: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [AdminUsersController],
      providers: [{ provide: AdminUsersService, useValue: adminUsersService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when admin users are requested without auth", async () => {
    await request(app.getHttpServer()).get("/admin/users").expect(401);
  });

  it("returns 403 when a non-admin user requests admin users", async () => {
    await request(app.getHttpServer()).get("/admin/users").set(authHeaders("reader")).expect(403);
  });

  it("returns 400 for malformed admin user updates", async () => {
    await request(app.getHttpServer())
      .patch("/admin/users/user-2")
      .set(authHeaders("admin"))
      .send({ globalRole: "owner" })
      .expect(400);
  });

  it("updates an admin user and forwards params/body/current user", async () => {
    adminUsersService.updateUser.mockResolvedValue({
      id: "user-2",
      email: "user-2@example.com",
      name: "User Two",
      globalRole: "editor",
      projectAccess: []
    });

    const response = await request(app.getHttpServer())
      .patch("/admin/users/user-2")
      .set(authHeaders("admin", { userId: "admin-1", email: "admin@example.com" }))
      .send({ globalRole: "editor" })
      .expect(200);

    expect(adminUsersService.updateUser).toHaveBeenCalledWith(
      "user-2",
      { globalRole: "editor" },
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      }
    );
    expect(response.body).toEqual({
      id: "user-2",
      email: "user-2@example.com",
      name: "User Two",
      globalRole: "editor",
      projectAccess: []
    });
  });
});
