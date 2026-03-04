import { BadRequestException, ConflictException } from "@nestjs/common";

import { WikiService } from "./wiki.service";

describe("WikiService", () => {
  const makeService = (): {
    service: WikiService;
    prisma: any;
    accessService: any;
    auditService: any;
    storageService: any;
  } => {
    const prisma: any = {
      wikiPage: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      wikiRevision: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn()
      },
      wikiDraft: {
        create: jest.fn(),
        update: jest.fn()
      },
      wikiLink: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn()
      },
      wikiAsset: {
        create: jest.fn(),
        findFirst: jest.fn()
      },
      fileObject: {
        findUnique: jest.fn()
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn()
    };

    const accessService: any = {
      ensureProjectReadable: jest.fn().mockResolvedValue(undefined),
      ensureProjectWritable: jest.fn().mockResolvedValue(undefined)
    };

    const auditService: any = {
      log: jest.fn().mockResolvedValue(undefined)
    };

    const storageService: any = {
      saveUpload: jest.fn(),
      readObject: jest.fn()
    };

    return {
      service: new WikiService(prisma, accessService, auditService, storageService),
      prisma,
      accessService,
      auditService,
      storageService
    };
  };

  it("rejects page creation when project path already exists", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.wikiPage.findFirst.mockResolvedValue({ id: "existing-page" });

    await expect(
      service.createPage(
        "project-1",
        {
          title: "Roadmap",
          slug: "roadmap",
          folderPath: "guides"
        } as any,
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(prisma.wikiPage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          path: "guides/roadmap",
          deletedAt: null
        }
      })
    );
  });

  it("builds tree with draft markers for editor users", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.wikiPage.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Roadmap",
        path: "guides/roadmap",
        updatedAt: new Date("2026-03-03T10:00:00.000Z"),
        currentRevision: {
          contentMarkdown: "published"
        },
        draft: {
          title: "Roadmap draft",
          contentMarkdown: "draft update",
          updatedAt: new Date("2026-03-03T11:00:00.000Z"),
          updatedBy: {
            id: "user-2",
            name: "Editor",
            email: "editor@example.com"
          }
        }
      }
    ]);

    const tree = await service.listTree(
      "project-1",
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(tree).toEqual([
      {
        type: "folder",
        name: "guides",
        path: "guides",
        children: [
          {
            type: "page",
            name: "roadmap",
            path: "guides/roadmap",
            pageId: "page-1",
            title: "Roadmap",
            hasDraftChanges: true,
            draftUpdatedAt: "2026-03-03T11:00:00.000Z",
            draftUpdatedBy: {
              id: "user-2",
              name: "Editor",
              email: "editor@example.com"
            },
            children: []
          }
        ]
      }
    ]);
  });

  it("hides draft content from reader users", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.wikiPage.findFirst.mockResolvedValue({
      id: "page-1",
      projectId: "project-1",
      title: "Roadmap",
      slug: "roadmap",
      folderPath: "",
      path: "roadmap",
      templateType: null,
      updatedAt: new Date("2026-03-03T10:00:00.000Z"),
      createdById: "user-1",
      currentRevision: {
        id: "revision-1",
        revisionNumber: 1,
        contentMarkdown: "published",
        createdAt: new Date("2026-03-03T09:00:00.000Z"),
        changeNote: null,
        createdBy: {
          id: "user-1",
          name: "Owner",
          email: "owner@example.com"
        }
      },
      draft: {
        id: "draft-1",
        title: "Roadmap draft",
        contentMarkdown: "draft",
        draftVersion: 2,
        updatedAt: new Date("2026-03-03T11:00:00.000Z"),
        updatedBy: {
          id: "user-2",
          name: "Editor",
          email: "editor@example.com"
        }
      }
    });
    prisma.wikiLink.findMany.mockResolvedValue([]);

    const detail = await service.getByPath(
      "project-1",
      "roadmap",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("reader-1", "reader", "project-1");
    expect(detail.draft).toBeUndefined();
    expect(detail.page.path).toBe("roadmap");
    expect(detail.published.revisionNumber).toBe(1);
  });

  it("returns conflict on stale draft version", async () => {
    const { service, prisma } = makeService();
    const tx: any = {
      wikiPage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "page-1",
          projectId: "project-1",
          title: "Roadmap",
          slug: "roadmap",
          folderPath: "",
          path: "roadmap",
          templateType: null,
          updatedAt: new Date("2026-03-03T10:00:00.000Z"),
          createdById: "user-1",
          currentRevision: {
            id: "revision-1",
            revisionNumber: 1,
            contentMarkdown: "published",
            createdAt: new Date("2026-03-03T09:00:00.000Z"),
            changeNote: null,
            createdBy: {
              id: "user-1",
              name: "Owner",
              email: "owner@example.com"
            }
          },
          draft: {
            id: "draft-1",
            title: "Roadmap",
            contentMarkdown: "draft",
            draftVersion: 2,
            updatedAt: new Date("2026-03-03T11:00:00.000Z"),
            updatedBy: {
              id: "user-2",
              name: "Editor",
              email: "editor@example.com"
            }
          }
        })
      },
      wikiDraft: {
        update: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    await expect(
      service.saveDraft(
        "page-1",
        {
          title: "Roadmap",
          contentMarkdown: "local draft",
          baseDraftVersion: 1
        },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.wikiDraft.update).not.toHaveBeenCalled();
  });

  it("publishes draft to a new immutable revision", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    const tx: any = {
      wikiPage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "page-1",
          projectId: "project-1",
          title: "Roadmap",
          slug: "roadmap",
          folderPath: "",
          path: "roadmap",
          templateType: null,
          updatedAt: new Date("2026-03-03T10:00:00.000Z"),
          createdById: "user-1",
          currentRevision: {
            id: "revision-1",
            revisionNumber: 1,
            contentMarkdown: "published",
            createdAt: new Date("2026-03-03T09:00:00.000Z"),
            changeNote: null,
            createdBy: {
              id: "user-1",
              name: "Owner",
              email: "owner@example.com"
            }
          },
          draft: {
            id: "draft-1",
            title: "Roadmap v2",
            contentMarkdown: "updated [[roadmap]]",
            draftVersion: 3,
            updatedAt: new Date("2026-03-03T11:00:00.000Z"),
            updatedBy: {
              id: "user-2",
              name: "Editor",
              email: "editor@example.com"
            }
          }
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "page-1", path: "roadmap" }]),
        update: jest.fn()
      },
      wikiRevision: {
        findFirst: jest.fn().mockResolvedValue({ revisionNumber: 1 }),
        create: jest.fn().mockResolvedValue({
          id: "revision-2",
          revisionNumber: 2,
          createdAt: new Date("2026-03-03T12:00:00.000Z")
        })
      },
      wikiDraft: {
        update: jest.fn().mockResolvedValue({ draftVersion: 4 })
      },
      wikiLink: {
        deleteMany: jest.fn(),
        createMany: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    const result = await service.publishDraft(
      "page-1",
      {
        baseDraftVersion: 3,
        changeNote: "Publish update"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(tx.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: "page-1",
          revisionNumber: 2
        })
      })
    );
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "wiki.page.publish" }));
    expect(result).toEqual({
      pageId: "page-1",
      revisionNumber: 2,
      publishedAt: "2026-03-03T12:00:00.000Z",
      draftVersion: 4
    });
  });

  it("rejects unsupported wiki asset mime types", async () => {
    const { service, storageService } = makeService();

    await expect(
      service.uploadWikiAsset(
        "project-1",
        {
          mimetype: "text/plain",
          size: 128,
          originalname: "notes.txt"
        } as Express.Multer.File,
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageService.saveUpload).not.toHaveBeenCalled();
  });

  it("searches wiki pages for reader role using published content", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.$queryRaw.mockResolvedValue([
      {
        pageId: "page-1",
        path: "research/vision",
        title: "Vision notes",
        snippet: "pose estimation and gnc",
        score: 0.83,
        matchTitle: true,
        matchPath: false,
        matchPublished: true,
        matchDraft: true,
        updatedAt: new Date("2026-03-03T10:00:00.000Z")
      }
    ]);

    const results = await service.searchPages(
      "project-1",
      {
        q: "pose estimation",
        limit: 10
      },
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("reader-1", "reader", "project-1");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        pageId: "page-1",
        path: "research/vision",
        title: "Vision notes",
        snippet: "pose estimation and gnc",
        score: 0.83,
        matches: {
          title: true,
          path: false,
          published: true,
          draft: false
        },
        updatedAt: "2026-03-03T10:00:00.000Z"
      }
    ]);
  });

  it("searches wiki pages for editor role including draft matches", async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValue([
      {
        pageId: "page-2",
        path: "drafts/satgnc",
        title: "SATGNC draft",
        snippet: "<b>cross-domain</b> adaptation",
        score: 0.72,
        matchTitle: false,
        matchPath: true,
        matchPublished: false,
        matchDraft: true,
        updatedAt: new Date("2026-03-03T12:00:00.000Z")
      }
    ]);

    const results = await service.searchPages(
      "project-1",
      {
        q: "cross-domain"
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(results[0]).toEqual({
      pageId: "page-2",
      path: "drafts/satgnc",
      title: "SATGNC draft",
      snippet: "cross-domain adaptation",
      score: 0.72,
      matches: {
        title: false,
        path: true,
        published: false,
        draft: true
      },
      updatedAt: "2026-03-03T12:00:00.000Z"
    });
  });

  it("rejects short search queries", async () => {
    const { service, prisma } = makeService();

    await expect(
      service.searchPages(
        "project-1",
        {
          q: "a"
        },
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
