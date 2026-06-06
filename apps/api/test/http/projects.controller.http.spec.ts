import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { ProjectsController } from "../../src/projects/projects.controller";
import { ProjectsService } from "../../src/projects/projects.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("ProjectsController HTTP", () => {
  let app: INestApplication;
  let projectsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    projectsService = {
      createProject: jest.fn(),
      listProjects: jest.fn(),
      getProjectAccess: jest.fn(),
      updateProject: jest.fn(),
      pinProject: jest.fn(),
      unpinProject: jest.fn(),
      listMembers: jest.fn(),
      deleteProject: jest.fn(),
      addMember: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: projectsService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when listing projects without auth", async () => {
    await request(app.getHttpServer()).get("/projects").expect(401);
  });

  it("returns 403 when a non-admin user tries to create a project", async () => {
    await request(app.getHttpServer())
      .post("/projects")
      .set(authHeaders("reader"))
      .send({ key: "NAV", name: "Navigation" })
      .expect(403);
  });

  it("returns 400 for malformed project creation payloads", async () => {
    await request(app.getHttpServer())
      .post("/projects")
      .set(authHeaders("admin"))
      .send({ key: "nav", name: "N" })
      .expect(400);
  });

  it("lists projects and binds the current user", async () => {
    projectsService.listProjects.mockResolvedValue([
      {
        id: "project-1",
        key: "NAV",
        name: "Navigation",
        description: null,
        createdAt: "2026-04-06T10:00:00.000Z",
        isPinned: false
      }
    ]);

    const response = await request(app.getHttpServer())
      .get("/projects")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(200);

    expect(projectsService.listProjects).toHaveBeenCalledWith({
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(response.body).toEqual([
      {
        id: "project-1",
        key: "NAV",
        name: "Navigation",
        description: null,
        createdAt: "2026-04-06T10:00:00.000Z",
        isPinned: false
      }
    ]);
  });

  it("binds add-member params, DTO, and current user", async () => {
    projectsService.addMember.mockResolvedValue({ projectId: "project-1", userId: "user-2" });

    const response = await request(app.getHttpServer())
      .post("/projects/project-1/members")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ email: "new.member@example.com" })
      .expect(201);

    expect(projectsService.addMember).toHaveBeenCalledWith(
      "project-1",
      { email: "new.member@example.com" },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body).toEqual({ projectId: "project-1", userId: "user-2" });
  });

  it("binds project update params, DTO, and current user", async () => {
    projectsService.updateProject.mockResolvedValue({
      id: "project-1",
      key: "NAV",
      name: "Navigation Archive",
      description: "Updated project context.",
      updatedAt: "2026-06-06T12:00:00.000Z"
    });

    const response = await request(app.getHttpServer())
      .patch("/projects/project-1")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ name: "Navigation Archive", description: "Updated project context." })
      .expect(200);

    expect(projectsService.updateProject).toHaveBeenCalledWith(
      "project-1",
      { name: "Navigation Archive", description: "Updated project context." },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body).toEqual({
      id: "project-1",
      key: "NAV",
      name: "Navigation Archive",
      description: "Updated project context.",
      updatedAt: "2026-06-06T12:00:00.000Z"
    });
  });
});
