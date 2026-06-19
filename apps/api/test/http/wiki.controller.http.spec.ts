import { ForbiddenException, INestApplication, NotFoundException } from "@nestjs/common";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import request from "supertest";

import { WikiController } from "../../src/wiki/wiki.controller";
import { WikiService } from "../../src/wiki/wiki.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("WikiController HTTP", () => {
  let app: INestApplication;
  let wikiService: Record<string, jest.Mock>;

  beforeEach(async () => {
    wikiService = {
      createPage: jest.fn(),
      importPages: jest.fn(),
      getDocsSyncStatus: jest.fn(),
      syncDocs: jest.fn(),
      getDocsStructureMigrationPreview: jest.fn(),
      applyDocsStructureMigration: jest.fn(),
      assignDocsPages: jest.fn(),
      listTree: jest.fn(),
      getByPath: jest.fn(),
      searchPages: jest.fn(),
      saveDraft: jest.fn(),
      flushRealtimeDraft: jest.fn(),
      publishDraft: jest.fn(),
      deletePage: jest.fn(),
      listBacklinks: jest.fn(),
      uploadWikiAsset: jest.fn(),
      getWikiAssetContent: jest.fn(),
      updatePage: jest.fn(),
      listRevisions: jest.fn(),
      getRevision: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [WikiController],
      providers: [{ provide: WikiService, useValue: wikiService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when listing the wiki tree without auth", async () => {
    await request(app.getHttpServer()).get("/projects/project-1/wiki-pages/tree").expect(401);
  });

  it("returns 401 when reading a wiki revision preview without auth", async () => {
    await request(app.getHttpServer()).get("/wiki-pages/page-1/revisions/rev-1").expect(401);
  });

  it("returns 400 for invalid wiki search queries", async () => {
    await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/search")
      .query({ q: "a" })
      .set(authHeaders("reader"))
      .expect(400);
  });

  it("validates wiki search DTO trimming and limit coercion", async () => {
    wikiService.searchPages.mockResolvedValue([
      {
        pageId: "page-1",
        path: "guides/roadmap",
        title: "Roadmap",
        snippet: "Navigation roadmap",
        publishedRevisionNumber: 2,
        hasDraftChanges: false,
        draftUpdatedAt: null,
        draftUpdatedBy: null
      }
    ]);

    const response = await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/search")
      .query({ q: "  roadmap  ", limit: "5" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(wikiService.searchPages).toHaveBeenCalledWith(
      "project-1",
      {
        q: "roadmap",
        limit: 5
      },
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(response.body[0].pageId).toBe("page-1");
  });

  it("rejects wiki search limits outside the allowed DTO range", async () => {
    await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/search")
      .query({ q: "roadmap", limit: "0" })
      .set(authHeaders("reader"))
      .expect(400);

    await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/search")
      .query({ q: "roadmap", limit: "51" })
      .set(authHeaders("reader"))
      .expect(400);

    await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/search")
      .query({ q: "roadmap", limit: "3.5" })
      .set(authHeaders("reader"))
      .expect(400);

    await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/search")
      .query({ q: "x".repeat(201) })
      .set(authHeaders("reader"))
      .expect(400);
  });

  it("creates pages and lists the wiki tree with bound params", async () => {
    wikiService.createPage.mockResolvedValue({
      id: "page-1",
      projectId: "project-1",
      slug: "roadmap",
      title: "Roadmap",
      path: "guides/roadmap",
      revisionNumber: 1
    });
    wikiService.listTree.mockResolvedValue([
      {
        type: "page",
        name: "roadmap",
        path: "guides/roadmap",
        pageId: "page-1",
        title: "Roadmap",
        hasDraftChanges: false,
        draftUpdatedAt: null,
        draftUpdatedBy: null,
        children: []
      }
    ]);

    const createResponse = await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({
        title: "Roadmap",
        slug: "roadmap",
        folderPath: "guides",
        docsRepositoryId: "repo-1",
        contentMarkdown: "# Roadmap"
      })
      .expect(201);

    const treeResponse = await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/tree")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(wikiService.createPage).toHaveBeenCalledWith(
      "project-1",
      {
        title: "Roadmap",
        slug: "roadmap",
        folderPath: "guides",
        docsRepositoryId: "repo-1",
        contentMarkdown: "# Roadmap"
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(wikiService.listTree).toHaveBeenCalledWith("project-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(createResponse.body.revisionNumber).toBe(1);
    expect(treeResponse.body[0].pageId).toBe("page-1");
  });

  it("binds Docs sync status and run endpoints", async () => {
    wikiService.getDocsSyncStatus.mockResolvedValue({
      repositories: [
        {
          repositoryId: "repo-1",
          name: "Atlasium",
          pathWithNamespace: "atlasium/project",
          defaultBranch: "main",
          wikiDocsPrefix: "atlasium",
          docsRoot: "Docs",
          lastSyncedAt: null,
          lastSyncError: null,
          bindings: {
            active: 1,
            deleted: 0
          },
          structure: {
            research: 1,
            implementation: 0,
            legacy: 1,
            migrationAvailable: true
          }
        }
      ],
      unassigned: [
        {
          pageId: "page-2",
          wikiPath: "roadmap",
          title: "Roadmap",
          hasDraftChanges: false,
          reason: "Wiki page is not under any repository Docs prefix"
        }
      ]
    });
    wikiService.syncDocs.mockResolvedValue({
      repositories: [],
      totals: {
        created: 1,
        updatedFromGit: 0,
        updatedToGit: 0,
        exportedToGit: 1,
        linked: 1,
        deletedFromWiki: 0,
        deletedFromGit: 0,
        unchanged: 0,
        unassigned: 1,
        conflicts: 0,
        errors: 0
      },
      unassigned: [
        {
          pageId: "page-2",
          wikiPath: "roadmap",
          title: "Roadmap",
          hasDraftChanges: false,
          reason: "Wiki page is not under any repository Docs prefix"
        }
      ]
    });

    const statusResponse = await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/docs-sync/status")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(200);
    const syncResponse = await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/docs-sync")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(201);

    expect(wikiService.getDocsSyncStatus).toHaveBeenCalledWith("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(wikiService.syncDocs).toHaveBeenCalledWith("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(statusResponse.body.repositories[0].wikiDocsPrefix).toBe("atlasium");
    expect(syncResponse.body.totals.created).toBe(1);
    expect(syncResponse.body.totals.exportedToGit).toBe(1);
    expect(syncResponse.body.totals.linked).toBe(1);
    expect(statusResponse.body.unassigned[0].hasDraftChanges).toBe(false);
    expect(syncResponse.body.unassigned[0].wikiPath).toBe("roadmap");
  });

  it("binds Docs structure migration preview and apply endpoints", async () => {
    wikiService.getDocsStructureMigrationPreview.mockResolvedValue({
      rows: [
        {
          bindingId: "binding-1",
          pageId: "page-1",
          title: "Guide",
          repositoryId: "repo-1",
          repositoryName: "Backend",
          currentWikiPath: "backend/guide",
          currentDocsPath: "Docs/Guide.md",
          targetKind: "research",
          targetWikiPath: "research/backend/guide",
          targetDocsPath: "Docs/Research/Guide.md",
          hasDraftChanges: false,
          conflicts: []
        }
      ],
      totals: {
        legacy: 1,
        ready: 1,
        conflicts: 0
      }
    });
    wikiService.applyDocsStructureMigration.mockResolvedValue({
      rows: [
        {
          bindingId: "binding-1",
          pageId: "page-1",
          title: "Guide",
          repositoryId: "repo-1",
          repositoryName: "Backend",
          currentWikiPath: "backend/guide",
          currentDocsPath: "Docs/Guide.md",
          targetKind: "implementation",
          targetWikiPath: "implementation/backend/guide",
          targetDocsPath: "Docs/Implementation/Guide.md",
          hasDraftChanges: false,
          conflicts: [],
          status: "migrated",
          reason: null
        }
      ],
      totals: {
        migrated: 1,
        conflicts: 0,
        errors: 0
      }
    });

    const previewResponse = await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/docs-sync/structure-preview")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(200);
    const applyResponse = await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/docs-sync/structure-migration")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({
        operations: [
          {
            bindingId: "binding-1",
            targetKind: "implementation"
          }
        ]
      })
      .expect(201);

    expect(wikiService.getDocsStructureMigrationPreview).toHaveBeenCalledWith("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(wikiService.applyDocsStructureMigration).toHaveBeenCalledWith(
      "project-1",
      {
        operations: [
          {
            bindingId: "binding-1",
            targetKind: "implementation"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(previewResponse.body.rows[0].targetDocsPath).toBe("Docs/Research/Guide.md");
    expect(applyResponse.body.totals.migrated).toBe(1);
  });

  it("validates Docs structure migration operations", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/docs-sync/structure-migration")
      .set(authHeaders("editor"))
      .send({
        operations: []
      })
      .expect(400);

    await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/docs-sync/structure-migration")
      .set(authHeaders("editor"))
      .send({
        operations: [
          {
            bindingId: "binding-1",
            targetKind: "code"
          }
        ]
      })
      .expect(400);
  });

  it("binds Docs assignment endpoint with validated body", async () => {
    wikiService.assignDocsPages.mockResolvedValue({
      pages: [
        {
          pageId: "page-1",
          title: "Roadmap",
          oldWikiPath: "roadmap",
          newWikiPath: "backend/roadmap",
          repositoryId: "repo-1",
          repositoryName: "Backend",
          docsPath: "Docs/roadmap.md",
          docsKind: "research",
          status: "exportedToGit",
          reason: null
        }
      ],
      totals: {
        assigned: 1,
        exportedToGit: 1,
        linked: 0,
        conflicts: 0,
        errors: 0
      }
    });

    const response = await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/docs-sync/assign")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({
        assignments: [
          {
            pageId: "page-1",
            repositoryId: "repo-1",
            folderPath: "",
            slug: "roadmap",
            docsKind: "implementation"
          }
        ]
      })
      .expect(201);

    expect(wikiService.assignDocsPages).toHaveBeenCalledWith(
      "project-1",
      {
        assignments: [
          {
            pageId: "page-1",
            repositoryId: "repo-1",
            folderPath: "",
            slug: "roadmap",
            docsKind: "implementation"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body.totals.assigned).toBe(1);
    expect(response.body.pages[0].newWikiPath).toBe("backend/roadmap");
  });

  it("imports markdown pages with bound params and body", async () => {
    wikiService.importPages.mockResolvedValue({
      created: [
        {
          id: "page-1",
          title: "Roadmap",
          path: "guides/roadmap",
          sourcePath: "guides/roadmap.md"
        }
      ],
      skipped: [
        {
          title: "Existing",
          path: "guides/existing",
          sourcePath: "guides/existing.md",
          reason: "path_exists"
        }
      ]
    });

    const response = await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/import")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({
        entries: [
          {
            title: "Roadmap",
            slug: "roadmap",
            folderPath: "guides",
            contentMarkdown: "# Roadmap",
            sourcePath: "guides/roadmap.md"
          }
        ]
      })
      .expect(201);

    expect(wikiService.importPages).toHaveBeenCalledWith(
      "project-1",
      {
        entries: [
          {
            title: "Roadmap",
            slug: "roadmap",
            folderPath: "guides",
            contentMarkdown: "# Roadmap",
            sourcePath: "guides/roadmap.md"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body.created[0].path).toBe("guides/roadmap");
    expect(response.body.skipped[0].reason).toBe("path_exists");
  });

  it("returns 400 for invalid wiki import payloads", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/import")
      .set(authHeaders("editor"))
      .send({
        entries: []
      })
      .expect(400);

    await request(app.getHttpServer())
      .post("/projects/project-1/wiki-pages/import")
      .set(authHeaders("editor"))
      .send({
        entries: [
          {
            title: "x",
            slug: "Not Safe",
            contentMarkdown: "# Invalid",
            sourcePath: "bad.md"
          }
        ]
      })
      .expect(400);
  });

  it("binds get-by-path query params and current user", async () => {
    wikiService.getByPath.mockResolvedValue({
      page: { id: "page-1", title: "Roadmap", path: "roadmap" },
      published: { revisionNumber: 1 },
      outgoingLinks: [],
      backlinks: []
    });

    const response = await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/by-path")
      .query({ path: "roadmap" })
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(wikiService.getByPath).toHaveBeenCalledWith(
      "project-1",
      "roadmap",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );
    expect(response.body.page.path).toBe("roadmap");
  });

  it("binds draft save payloads and params", async () => {
    wikiService.saveDraft.mockResolvedValue({
      draftVersion: 2,
      updatedAt: "2026-04-06T12:00:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });

    const response = await request(app.getHttpServer())
      .put("/wiki-pages/page-1/draft")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ title: "Roadmap", contentMarkdown: "Updated", baseDraftVersion: 1 })
      .expect(200);

    expect(wikiService.saveDraft).toHaveBeenCalledWith(
      "page-1",
      { title: "Roadmap", contentMarkdown: "Updated", baseDraftVersion: 1 },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body.draftVersion).toBe(2);
  });

  it("flushes, publishes, deletes, updates, and lists backlinks/revisions with bound params", async () => {
    wikiService.flushRealtimeDraft.mockResolvedValue({
      draftVersion: 3,
      updatedAt: "2026-04-06T12:05:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });
    wikiService.publishDraft.mockResolvedValue({
      pageId: "page-1",
      revisionNumber: 4,
      publishedAt: "2026-04-06T12:10:00.000Z",
      draftVersion: 4
    });
    wikiService.deletePage.mockResolvedValue({
      id: "page-1",
      deletedAt: "2026-04-06T12:20:00.000Z"
    });
    wikiService.listBacklinks.mockResolvedValue([
      { fromPageId: "page-2", fromTitle: "Refs", fromPath: "refs" }
    ]);
    wikiService.updatePage.mockResolvedValue({
      pageId: "page-1",
      revisionNumber: 5
    });
    wikiService.listRevisions.mockResolvedValue([
      {
        id: "rev-5",
        revisionNumber: 5,
        publishedAt: "2026-04-06T12:30:00.000Z",
        createdBy: {
          id: "editor-1",
          name: "Editor",
          email: "editor@example.com"
        },
        changeNote: "Polish"
      }
    ]);

    await request(app.getHttpServer())
      .post("/wiki-pages/page-1/realtime-flush")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(201);

    await request(app.getHttpServer())
      .post("/wiki-pages/page-1/publish")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ baseDraftVersion: 3, changeNote: "Publish" })
      .expect(201);

    await request(app.getHttpServer())
      .delete("/wiki-pages/page-1")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .expect(200);

    const backlinksResponse = await request(app.getHttpServer())
      .get("/wiki-pages/page-1/backlinks")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    await request(app.getHttpServer())
      .put("/wiki-pages/page-1")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ title: "Roadmap v2", contentMarkdown: "Updated", changeNote: "Polish" })
      .expect(200);

    const revisionsResponse = await request(app.getHttpServer())
      .get("/wiki-pages/page-1/revisions")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(wikiService.flushRealtimeDraft).toHaveBeenCalledWith("page-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(wikiService.publishDraft).toHaveBeenCalledWith(
      "page-1",
      { baseDraftVersion: 3, changeNote: "Publish" },
      expect.objectContaining({ userId: "editor-1" })
    );
    expect(wikiService.deletePage).toHaveBeenCalledWith("page-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(wikiService.listBacklinks).toHaveBeenCalledWith("page-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(wikiService.updatePage).toHaveBeenCalledWith(
      "page-1",
      { title: "Roadmap v2", contentMarkdown: "Updated", changeNote: "Polish" },
      expect.objectContaining({ userId: "editor-1" })
    );
    expect(wikiService.listRevisions).toHaveBeenCalledWith("page-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(backlinksResponse.body[0].fromPageId).toBe("page-2");
    expect(revisionsResponse.body[0].id).toBe("rev-5");
  });

  it("streams asset bytes with inline headers", async () => {
    wikiService.getWikiAssetContent.mockResolvedValue({
      mimeType: "image/png",
      fileName: "diagram\r\n\"quoted\".png",
      buffer: Buffer.from("png")
    });

    const response = await request(app.getHttpServer())
      .get("/wiki-assets/asset-1/content")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(wikiService.getWikiAssetContent).toHaveBeenCalledWith("asset-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toBe('inline; filename="diagram___quoted_.png"');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.toString()).toBe("png");
  });

  it("binds wiki revision detail params and surfaces not found responses", async () => {
    wikiService.getRevision.mockResolvedValue({
      id: "rev-2",
      revisionNumber: 2,
      contentMarkdown: "# Archived roadmap",
      publishedAt: "2026-04-06T12:30:00.000Z",
      createdBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      },
      changeNote: "Clarify scope"
    });

    const successResponse = await request(app.getHttpServer())
      .get("/wiki-pages/page-1/revisions/rev-2")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(wikiService.getRevision).toHaveBeenCalledWith("page-1", "rev-2", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(successResponse.body.contentMarkdown).toBe("# Archived roadmap");

    wikiService.getRevision.mockRejectedValueOnce(new NotFoundException("Wiki revision not found"));

    await request(app.getHttpServer())
      .get("/wiki-pages/page-1/revisions/rev-missing")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(404);

    wikiService.getRevision.mockRejectedValueOnce(new ForbiddenException("Forbidden"));

    await request(app.getHttpServer())
      .get("/wiki-pages/page-1/revisions/rev-forbidden")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(403);
  });

  it("uploads wiki assets through multipart storage callbacks", async () => {
    const uploadDir = join(tmpdir(), "doctoral-platform-uploads");
    rmSync(uploadDir, { recursive: true, force: true });

    wikiService.uploadWikiAsset.mockResolvedValue({
      assetId: "asset-1",
      url: "/wiki-assets/asset-1/content",
      mimeType: "image/png",
      sizeBytes: 3,
      originalName: "diagram.png"
    });

    const response = await request(app.getHttpServer())
      .post("/projects/project-1/wiki-assets")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .attach("file", Buffer.from("png"), "diagram.png")
      .expect(201);

    expect(wikiService.uploadWikiAsset).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        originalname: "diagram.png"
      }),
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body.assetId).toBe("asset-1");
  });
});
