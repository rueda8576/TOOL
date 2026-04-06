import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { GitlabController } from "../../src/gitlab/gitlab.controller";
import { GitlabService } from "../../src/gitlab/gitlab.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("GitlabController HTTP", () => {
  let app: INestApplication;
  let gitlabService: Record<string, jest.Mock>;

  beforeEach(async () => {
    gitlabService = {
      searchProjects: jest.fn(),
      getRepositoryStatus: jest.fn(),
      linkRepository: jest.fn(),
      createRepository: jest.fn(),
      disconnectRepository: jest.fn(),
      listBranches: jest.fn(),
      listCommits: jest.fn(),
      getRepositoryTree: jest.fn(),
      getRepositoryFile: jest.fn(),
      listMergeRequests: jest.fn(),
      getRepositoryArchive: jest.fn(),
      createBranch: jest.fn(),
      createMergeRequest: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [GitlabController],
      providers: [{ provide: GitlabService, useValue: gitlabService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when repository status is requested without auth", async () => {
    await request(app.getHttpServer()).get("/projects/project-1/repository").expect(401);
  });

  it("returns 403 when a non-admin user tries to provision a repository", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/repository/create")
      .set(authHeaders("reader"))
      .send({})
      .expect(403);
  });

  it("returns 400 for malformed branch creation payloads", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/repository/branches")
      .set(authHeaders("editor"))
      .send({ name: "feature/nav" })
      .expect(400);
  });

  it("binds repository file query parameters and current user", async () => {
    gitlabService.getRepositoryFile.mockResolvedValue({
      filePath: "README.md",
      fileName: "README.md",
      ref: "main",
      size: 12,
      binary: false,
      content: "# Atlasium"
    });

    const response = await request(app.getHttpServer())
      .get("/projects/project-1/repository/file")
      .query({ filePath: "README.md", ref: "main" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(gitlabService.getRepositoryFile).toHaveBeenCalledWith(
      "project-1",
      "README.md",
      "main",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(response.body).toEqual({
      filePath: "README.md",
      fileName: "README.md",
      ref: "main",
      size: 12,
      binary: false,
      content: "# Atlasium"
    });
  });
});
