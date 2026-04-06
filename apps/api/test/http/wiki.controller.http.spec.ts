import { INestApplication } from "@nestjs/common";
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
      listRevisions: jest.fn()
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

  it("returns 400 for invalid wiki search queries", async () => {
    await request(app.getHttpServer())
      .get("/projects/project-1/wiki-pages/search")
      .query({ q: "a" })
      .set(authHeaders("reader"))
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

  it("streams asset bytes with inline headers", async () => {
    wikiService.getWikiAssetContent.mockResolvedValue({
      mimeType: "image/png",
      fileName: "diagram.png",
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
    expect(response.headers["content-disposition"]).toBe('inline; filename="diagram.png"');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.toString()).toBe("png");
  });
});
