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
      listRepositories: jest.fn(),
      ensureCurrentUserRepositoryAccess: jest.fn(),
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

  it("returns 400 when repository creation payload is malformed", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/repository/create")
      .set(authHeaders("reader"))
      .send({})
      .expect(400);
  });

  it("returns 400 for malformed branch creation payloads", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/repository/branches")
      .set(authHeaders("editor"))
      .send({ name: "feature/nav" })
      .expect(400);
  });

  it("returns 400 for malformed repository-link, merge-request-state, and archive-ref queries", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/repository/link")
      .set(authHeaders("admin"))
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .get("/projects/project-1/repository/merge-requests")
      .query({ state: "draft" })
      .set(authHeaders("reader"))
      .expect(400);

    await request(app.getHttpServer())
      .get("/projects/project-1/repository/archive")
      .query({ ref: "x".repeat(256) })
      .set(authHeaders("reader"))
      .expect(400);
  });

  it("binds repository status, ensure-access, link, create, disconnect, branch-list, and tree routes", async () => {
    gitlabService.getRepositoryStatus.mockResolvedValue({
      connected: true,
      id: "repo-1",
      gitlabProjectId: "123",
      name: "Navigation",
      webUrl: "https://git.atlasium.info/atlasium/nav",
      sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
      httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git",
      pathWithNamespace: "atlasium/nav",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-04-06T12:00:00.000Z",
      connectedAt: "2026-04-06T12:00:00.000Z",
      connectedByUserId: "admin-1",
      managed: true
    });
    gitlabService.listRepositories.mockResolvedValue([
      {
        id: "repo-1",
        gitlabProjectId: "123",
        name: "Navigation",
        webUrl: "https://git.atlasium.info/atlasium/nav",
        sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
        httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git",
        pathWithNamespace: "atlasium/nav",
        defaultBranch: "main",
        visibility: "private",
        lastActivityAt: "2026-04-06T12:00:00.000Z",
        connectedAt: "2026-04-06T12:00:00.000Z",
        connectedByUserId: "admin-1",
        managed: true
      }
    ]);
    gitlabService.ensureCurrentUserRepositoryAccess.mockResolvedValue({
      connected: true,
      id: "repo-1",
      gitlabProjectId: "123",
      name: "Navigation",
      webUrl: "https://git.atlasium.info/atlasium/nav",
      sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
      httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git",
      pathWithNamespace: "atlasium/nav",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-04-06T12:00:00.000Z",
      connectedAt: "2026-04-06T12:00:00.000Z",
      connectedByUserId: "admin-1",
      managed: true
    });
    gitlabService.linkRepository.mockResolvedValue({ connected: true, gitlabProjectId: "123" });
    gitlabService.createRepository.mockResolvedValue({ connected: true, gitlabProjectId: "124" });
    gitlabService.disconnectRepository.mockResolvedValue({ disconnected: true });
    gitlabService.listBranches.mockResolvedValue([{ name: "main", default: true }]);
    gitlabService.getRepositoryTree.mockResolvedValue({
      ref: "main",
      path: "src",
      entries: [{ id: "blob-1", name: "index.ts", path: "src/index.ts", type: "blob" }]
    });

    const statusResponse = await request(app.getHttpServer())
      .get("/projects/project-1/repository")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    const repositoriesResponse = await request(app.getHttpServer())
      .get("/projects/project-1/repositories")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    const ensureAccessResponse = await request(app.getHttpServer())
      .post("/projects/project-1/repository/access/ensure")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(201);

    await request(app.getHttpServer())
      .post("/projects/project-1/repository/link")
      .set(authHeaders("admin", { userId: "admin-1" }))
      .send({ gitlabProjectId: "123" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/projects/project-1/repository/create")
      .set(authHeaders("admin", { userId: "admin-1" }))
      .send({ name: "Navigation", path: "nav" })
      .expect(201);

    await request(app.getHttpServer())
      .delete("/projects/project-1/repository")
      .set(authHeaders("admin", { userId: "admin-1" }))
      .expect(200);

    const branchesResponse = await request(app.getHttpServer())
      .get("/projects/project-1/repository/branches")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    const treeResponse = await request(app.getHttpServer())
      .get("/projects/project-1/repository/tree")
      .query({ path: "src", ref: "main" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(gitlabService.getRepositoryStatus).toHaveBeenCalledWith(
      "project-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(gitlabService.listRepositories).toHaveBeenCalledWith(
      "project-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(gitlabService.ensureCurrentUserRepositoryAccess).toHaveBeenCalledWith(
      "project-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(gitlabService.linkRepository).toHaveBeenCalledWith(
      "project-1",
      { gitlabProjectId: "123" },
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      }
    );
    expect(gitlabService.createRepository).toHaveBeenCalledWith(
      "project-1",
      { name: "Navigation", path: "nav" },
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      }
    );
    expect(gitlabService.disconnectRepository).toHaveBeenCalledWith(
      "project-1",
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      }
    );
    expect(gitlabService.listBranches).toHaveBeenCalledWith(
      "project-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(gitlabService.getRepositoryTree).toHaveBeenCalledWith(
      "project-1",
      "src",
      "main",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(statusResponse.body.gitlabProjectId).toBe("123");
    expect(repositoriesResponse.body[0].id).toBe("repo-1");
    expect(ensureAccessResponse.body.gitlabProjectId).toBe("123");
    expect(branchesResponse.body[0].name).toBe("main");
    expect(treeResponse.body.entries[0].path).toBe("src/index.ts");
  });

  it("binds repository-scoped Code routes", async () => {
    gitlabService.ensureCurrentUserRepositoryAccess.mockResolvedValue({ connected: true, id: "repo-1" });
    gitlabService.listBranches.mockResolvedValue([{ name: "main", default: true }]);
    gitlabService.listCommits.mockResolvedValue([{ id: "abc123" }]);
    gitlabService.getRepositoryTree.mockResolvedValue({
      ref: "main",
      path: "src",
      entries: [{ id: "blob-1", name: "index.ts", path: "src/index.ts", type: "blob" }]
    });
    gitlabService.getRepositoryFile.mockResolvedValue({
      filePath: "README.md",
      fileName: "README.md",
      ref: "main",
      size: 12,
      binary: false,
      content: "# Atlasium"
    });
    gitlabService.listMergeRequests.mockResolvedValue([{ id: 7 }]);
    gitlabService.getRepositoryArchive.mockResolvedValue({
      fileName: "atlasium-nav-main.zip",
      contentType: "application/zip",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04])
    });
    gitlabService.createBranch.mockResolvedValue({ name: "feature/nav" });
    gitlabService.createMergeRequest.mockResolvedValue({ id: 8, iid: 8, title: "Merge notes", state: "opened" });

    await request(app.getHttpServer())
      .post("/projects/project-1/repositories/repo-1/access/ensure")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(201);

    await request(app.getHttpServer())
      .get("/projects/project-1/repositories/repo-1/branches")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    await request(app.getHttpServer())
      .get("/projects/project-1/repositories/repo-1/commits")
      .query({ ref: "main" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    await request(app.getHttpServer())
      .get("/projects/project-1/repositories/repo-1/tree")
      .query({ path: "src", ref: "main" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    await request(app.getHttpServer())
      .get("/projects/project-1/repositories/repo-1/file")
      .query({ filePath: "README.md", ref: "main" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    await request(app.getHttpServer())
      .get("/projects/project-1/repositories/repo-1/merge-requests")
      .query({ state: "opened" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    await request(app.getHttpServer())
      .get("/projects/project-1/repositories/repo-1/archive")
      .query({ ref: "main" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    await request(app.getHttpServer())
      .post("/projects/project-1/repositories/repo-1/branches")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ name: "feature/nav", sourceRef: "main" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/projects/project-1/repositories/repo-1/merge-requests")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ title: "Merge notes", sourceBranch: "feature/nav", targetBranch: "main" })
      .expect(201);

    expect(gitlabService.ensureCurrentUserRepositoryAccess).toHaveBeenCalledWith(
      "project-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "repo-1"
    );
    expect(gitlabService.listBranches).toHaveBeenCalledWith(
      "project-1",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "repo-1"
    );
    expect(gitlabService.listCommits).toHaveBeenCalledWith(
      "project-1",
      "main",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "repo-1"
    );
    expect(gitlabService.getRepositoryTree).toHaveBeenCalledWith(
      "project-1",
      "src",
      "main",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "repo-1"
    );
    expect(gitlabService.getRepositoryFile).toHaveBeenCalledWith(
      "project-1",
      "README.md",
      "main",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "repo-1"
    );
    expect(gitlabService.listMergeRequests).toHaveBeenCalledWith(
      "project-1",
      "opened",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "repo-1"
    );
    expect(gitlabService.getRepositoryArchive).toHaveBeenCalledWith(
      "project-1",
      "main",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      "repo-1"
    );
    expect(gitlabService.createBranch).toHaveBeenCalledWith(
      "project-1",
      { name: "feature/nav", sourceRef: "main" },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      },
      "repo-1"
    );
    expect(gitlabService.createMergeRequest).toHaveBeenCalledWith(
      "project-1",
      { title: "Merge notes", sourceBranch: "feature/nav", targetBranch: "main" },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      },
      "repo-1"
    );
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
