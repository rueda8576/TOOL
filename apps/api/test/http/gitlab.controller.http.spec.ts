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

  it("allows admins to search GitLab projects and binds the query", async () => {
    gitlabService.searchProjects.mockResolvedValue([
      {
        id: "gl-1",
        name: "Navigation",
        pathWithNamespace: "atlasium/nav"
      }
    ]);

    const response = await request(app.getHttpServer())
      .get("/gitlab/projects/search")
      .query({ q: "nav" })
      .set(authHeaders("admin", { userId: "admin-1" }))
      .expect(200);

    expect(gitlabService.searchProjects).toHaveBeenCalledWith(
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      },
      "nav"
    );
    expect(response.body[0].pathWithNamespace).toBe("atlasium/nav");
  });

  it("binds commit and merge-request list queries", async () => {
    gitlabService.listCommits.mockResolvedValue([{ id: "abc123" }]);
    gitlabService.listMergeRequests.mockResolvedValue([{ id: 7 }]);

    const commits = await request(app.getHttpServer())
      .get("/projects/project-1/repository/commits")
      .query({ ref: "feature/nav" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    const mergeRequests = await request(app.getHttpServer())
      .get("/projects/project-1/repository/merge-requests")
      .query({ state: "opened" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(gitlabService.listCommits).toHaveBeenCalledWith(
      "project-1",
      "feature/nav",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(gitlabService.listMergeRequests).toHaveBeenCalledWith(
      "project-1",
      "opened",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(commits.body).toEqual([{ id: "abc123" }]);
    expect(mergeRequests.body).toEqual([{ id: 7 }]);
  });

  it("streams repository archives and binds merge request creation DTOs", async () => {
    gitlabService.getRepositoryArchive.mockResolvedValue({
      fileName: "atlasium-nav-main.zip",
      contentType: "application/zip",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04])
    });
    gitlabService.createMergeRequest.mockResolvedValue({
      id: 8,
      iid: 8,
      title: "Merge notes",
      webUrl: "https://git.atlasium.info/atlasium/nav/-/merge_requests/8",
      state: "opened"
    });

    const archive = await request(app.getHttpServer())
      .get("/projects/project-1/repository/archive")
      .query({ ref: "main" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    const mergeRequest = await request(app.getHttpServer())
      .post("/projects/project-1/repository/merge-requests")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({
        title: "Merge notes",
        sourceBranch: "feature/notes",
        targetBranch: "main"
      })
      .expect(201);

    expect(gitlabService.getRepositoryArchive).toHaveBeenCalledWith(
      "project-1",
      "main",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(gitlabService.createMergeRequest).toHaveBeenCalledWith(
      "project-1",
      {
        title: "Merge notes",
        sourceBranch: "feature/notes",
        targetBranch: "main"
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(archive.headers["content-type"]).toContain("application/zip");
    expect(archive.headers["content-disposition"]).toBe("attachment; filename=\"atlasium-nav-main.zip\"");
    expect(mergeRequest.body.id).toBe(8);
  });
});
