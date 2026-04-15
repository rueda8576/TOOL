import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";

import * as collaborationRegistry from "../documents/collaboration-server-registry";
import { WikiService } from "./wiki.service";

describe("WikiService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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
        deleteMany: jest.fn(),
        updateMany: jest.fn()
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
      getProjectAccess: jest.fn(async (_userId: string, role: string) => ({
        isAdmin: role === "admin",
        projectRole: role === "admin" ? "admin" : role,
        canWrite: role !== "reader"
      })),
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

  it("validates wiki slugs, folder paths, plain paths, and parsed wiki links", () => {
    const { service } = makeService();

    expect((service as any).normalizeSlug("RoadMap")).toBe("roadmap");
    expect(() => (service as any).normalizeSlug("Road map")).toThrow(BadRequestException);

    expect((service as any).normalizeFolderPath(" Guides/Systems ")).toBe("guides/systems");
    expect((service as any).normalizeFolderPath("   ")).toBe("");
    expect(() => (service as any).normalizeFolderPath("guides/invalid path")).toThrow(BadRequestException);

    expect((service as any).normalizePath(" /Guides/Roadmap/ ")).toBe("guides/roadmap");
    expect(() => (service as any).normalizePath("   ")).toThrow(BadRequestException);
    expect(() => (service as any).normalizePath("guides/invalid path")).toThrow(BadRequestException);

    expect((service as any).parseWikiLinks("[[guides/roadmap]] [[bad path]] [[guides\\\\notes]] [[guides/roadmap]]")).toEqual([
      "guides/roadmap",
      "guides/notes"
    ]);
  });

  it("fails read helpers when the wiki page no longer exists", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.wikiPage.findFirst.mockResolvedValue(null);

    await expect(
      (service as any).ensurePageReadable("missing-page", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.getByPath(
        "project-1",
        "missing-page",
        {
          userId: "reader-1",
          email: "reader@example.com",
          globalRole: "reader"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(accessService.ensureProjectReadable).not.toHaveBeenCalled();
  });

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

  it("creates a wiki page with its initial revision and draft", async () => {
    const { service, prisma, auditService } = makeService();
    const tx: any = {
      wikiPage: {
        create: jest.fn().mockResolvedValue({
          id: "page-1",
          projectId: "project-1",
          slug: "roadmap",
          title: "Roadmap",
          path: "guides/roadmap"
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "page-2", path: "roadmap" }]),
        update: jest.fn().mockResolvedValue(undefined)
      },
      wikiRevision: {
        create: jest.fn().mockResolvedValue({
          id: "revision-1",
          revisionNumber: 1
        })
      },
      wikiDraft: {
        create: jest.fn().mockResolvedValue(undefined)
      },
      wikiLink: {
        deleteMany: jest.fn(),
        createMany: jest.fn()
      }
    };
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    await expect(
      service.createPage(
        "project-1",
        {
          title: "Roadmap",
          slug: "roadmap",
          folderPath: "guides",
          contentMarkdown: "See [[roadmap]]"
        } as any,
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).resolves.toEqual({
      id: "page-1",
      projectId: "project-1",
      slug: "roadmap",
      title: "Roadmap",
      path: "guides/roadmap",
      revisionNumber: 1
    });

    expect(tx.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          slug: "roadmap",
          folderPath: "guides",
          path: "guides/roadmap",
          createdById: "editor-1"
        })
      })
    );
    expect(tx.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: "page-1",
          revisionNumber: 1
        })
      })
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "wiki.page.create",
        entityType: "wiki_page"
      })
    );
  });

  it("imports markdown pages as draft-only pages and skips conflicting paths", async () => {
    const { service, prisma, auditService, accessService } = makeService();
    const tx: any = {
      wikiPage: {
        create: jest.fn().mockResolvedValue({
          id: "page-2",
          title: "New notes",
          path: "guides/new-notes"
        })
      },
      wikiDraft: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    };
    prisma.wikiPage.findMany.mockResolvedValue([{ path: "guides/existing" }]);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    const result = await service.importPages(
      "project-1",
      {
        entries: [
          {
            title: "Existing",
            slug: "existing",
            folderPath: "guides",
            contentMarkdown: "# Existing",
            sourcePath: "guides/existing.md"
          },
          {
            title: "New notes",
            slug: "new-notes",
            folderPath: "guides",
            contentMarkdown: "# New notes",
            sourcePath: "guides/new-notes.md"
          },
          {
            title: "Duplicate in batch",
            slug: "new-notes",
            folderPath: "guides",
            contentMarkdown: "# Duplicate",
            sourcePath: "guides/duplicate.md"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(tx.wikiPage.create).toHaveBeenCalledTimes(1);
    expect(tx.wikiDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: "page-2",
          title: "New notes",
          contentMarkdown: "# New notes",
          draftVersion: 1,
          updatedById: "editor-1"
        })
      })
    );
    expect(result).toEqual({
      created: [
        {
          id: "page-2",
          title: "New notes",
          path: "guides/new-notes",
          sourcePath: "guides/new-notes.md"
        }
      ],
      skipped: [
        {
          title: "Existing",
          path: "guides/existing",
          sourcePath: "guides/existing.md",
          reason: "path_exists"
        },
        {
          title: "Duplicate in batch",
          path: "guides/new-notes",
          sourcePath: "guides/duplicate.md",
          reason: "path_exists"
        }
      ]
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "wiki.page.import",
        entityId: "page-2"
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

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("user-1", "editor", "project-1");
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
            isUnpublished: false,
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

  it("hides unpublished draft-only pages from reader trees", async () => {
    const { service, prisma } = makeService();
    prisma.wikiPage.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Published",
        path: "guides/published",
        updatedAt: new Date("2026-03-03T10:00:00.000Z"),
        currentRevision: {
          contentMarkdown: "published"
        },
        draft: null
      }
    ]);

    const tree = await service.listTree("project-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });

    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          deletedAt: null,
          currentRevisionId: { not: null }
        })
      })
    );
    expect(tree[0]?.children[0]).toEqual(
      expect.objectContaining({
        pageId: "page-1",
        isUnpublished: false
      })
    );
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

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("reader-1", "reader", "project-1");
    expect(detail.draft).toBeUndefined();
    expect(detail.page.path).toBe("roadmap");
    expect(detail.published).not.toBeNull();
    expect(detail.published?.revisionNumber).toBe(1);
  });

  it("lets editors read draft-only pages with nullable published revision", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.wikiPage.findFirst.mockResolvedValue({
      id: "page-1",
      projectId: "project-1",
      title: "Imported page",
      slug: "imported-page",
      folderPath: "guides",
      path: "guides/imported-page",
      templateType: null,
      updatedAt: new Date("2026-03-03T10:00:00.000Z"),
      createdById: "user-1",
      currentRevision: null,
      draft: {
        id: "draft-1",
        title: "Imported page",
        contentMarkdown: "# Imported page",
        draftVersion: 1,
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
      "guides/imported-page",
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(detail.published).toBeNull();
    expect(detail.draft?.draftVersion).toBe(1);
  });

  it("hides draft-only pages from reader path lookups", async () => {
    const { service, prisma } = makeService();
    prisma.wikiPage.findFirst.mockResolvedValue({
      id: "page-1",
      projectId: "project-1",
      title: "Imported page",
      slug: "imported-page",
      folderPath: "guides",
      path: "guides/imported-page",
      templateType: null,
      updatedAt: new Date("2026-03-03T10:00:00.000Z"),
      createdById: "user-1",
      currentRevision: null,
      draft: {
        id: "draft-1",
        title: "Imported page",
        contentMarkdown: "# Imported page",
        draftVersion: 1,
        updatedAt: new Date("2026-03-03T11:00:00.000Z"),
        updatedBy: {
          id: "user-2",
          name: "Editor",
          email: "editor@example.com"
        }
      }
    });

    await expect(
      service.getByPath(
        "project-1",
        "guides/imported-page",
        {
          userId: "reader-1",
          email: "reader@example.com",
          globalRole: "reader"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it("saves a draft and increments the draft version", async () => {
    const { service, prisma, auditService } = makeService();
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
        update: jest.fn().mockResolvedValue({
          draftVersion: 3,
          updatedAt: new Date("2026-03-03T12:00:00.000Z"),
          updatedBy: {
            id: "user-3",
            name: "Reviewer",
            email: "reviewer@example.com"
          }
        })
      }
    };
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    await expect(
      service.saveDraft(
        "page-1",
        {
          title: "Roadmap v2",
          contentMarkdown: "draft v2",
          baseDraftVersion: 2
        },
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).resolves.toEqual({
      draftVersion: 3,
      updatedAt: "2026-03-03T12:00:00.000Z",
      updatedBy: {
        id: "user-3",
        name: "Reviewer",
        email: "reviewer@example.com"
      }
    });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "wiki.page.draft.save"
      })
    );
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

  it("publishes a draft-only page as revision 1", async () => {
    const { service, prisma } = makeService();
    const tx: any = {
      wikiPage: {
        findFirst: jest.fn().mockResolvedValue({
          id: "page-1",
          projectId: "project-1",
          title: "Imported page",
          slug: "imported-page",
          folderPath: "guides",
          path: "guides/imported-page",
          templateType: null,
          updatedAt: new Date("2026-03-03T10:00:00.000Z"),
          createdById: "user-1",
          currentRevision: null,
          draft: {
            id: "draft-1",
            title: "Imported page",
            contentMarkdown: "# Imported page",
            draftVersion: 1,
            updatedAt: new Date("2026-03-03T11:00:00.000Z"),
            updatedBy: {
              id: "user-2",
              name: "Editor",
              email: "editor@example.com"
            }
          }
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(undefined)
      },
      wikiRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "revision-1",
          revisionNumber: 1,
          createdAt: new Date("2026-03-03T12:00:00.000Z")
        })
      },
      wikiDraft: {
        update: jest.fn().mockResolvedValue({ draftVersion: 2 })
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
        baseDraftVersion: 1
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(tx.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revisionNumber: 1
        })
      })
    );
    expect(tx.wikiPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Imported page",
          currentRevisionId: "revision-1"
        })
      })
    );
    expect(result.revisionNumber).toBe(1);
  });

  it("flushes realtime wiki draft through collaboration server when available", async () => {
    const { service } = makeService();
    const flushWikiPageDraft = jest.fn().mockResolvedValue({
      draftVersion: 8,
      updatedAt: "2026-03-22T20:15:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });

    jest.spyOn(collaborationRegistry, "getDocumentsCollaborationServer").mockReturnValue({
      flushWikiPageDraft
    } as any);

    const user = {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor" as const
    };
    const result = await service.flushRealtimeDraft("page-1", user);

    expect(flushWikiPageDraft).toHaveBeenCalledWith("page-1", user);
    expect(result).toEqual({
      draftVersion: 8,
      updatedAt: "2026-03-22T20:15:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });
  });

  it("falls back to local draft snapshot when collaboration server is unavailable", async () => {
    const { service, prisma, accessService } = makeService();
    jest.spyOn(collaborationRegistry, "getDocumentsCollaborationServer").mockReturnValue(null);

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
          draft: null
        })
      },
      wikiDraft: {
        create: jest.fn().mockResolvedValue({
          id: "draft-1",
          title: "Roadmap",
          contentMarkdown: "published",
          draftVersion: 1,
          updatedAt: new Date("2026-03-22T20:20:00.000Z"),
          updatedBy: {
            id: "editor-1",
            name: "Editor",
            email: "editor@example.com"
          }
        })
      }
    };
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    const result = await service.flushRealtimeDraft("page-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(tx.wikiDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: "page-1",
          updatedById: "editor-1"
        })
      })
    );
    expect(result).toEqual({
      draftVersion: 1,
      updatedAt: "2026-03-22T20:20:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });
  });

  it("soft deletes wiki pages and detaches related links for editor users", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    const deletedAt = new Date("2026-03-26T15:30:00.000Z");
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
            draftVersion: 1,
            updatedAt: new Date("2026-03-03T11:00:00.000Z"),
            updatedBy: {
              id: "user-2",
              name: "Editor",
              email: "editor@example.com"
            }
          }
        }),
        update: jest.fn().mockResolvedValue({
          id: "page-1",
          deletedAt
        })
      },
      wikiLink: {
        deleteMany: jest.fn(),
        updateMany: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    const result = await service.deletePage("page-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(tx.wikiLink.deleteMany).toHaveBeenCalledWith({
      where: {
        fromPageId: "page-1"
      }
    });
    expect(tx.wikiLink.updateMany).toHaveBeenCalledWith({
      where: {
        toPageId: "page-1"
      },
      data: {
        toPageId: null
      }
    });
    expect(tx.wikiPage.update).toHaveBeenCalledWith({
      where: {
        id: "page-1"
      },
      data: {
        deletedAt: expect.any(Date)
      },
      select: {
        id: true,
        deletedAt: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "wiki.page.delete" }));
    expect(result).toEqual({
      id: "page-1",
      deletedAt: "2026-03-26T15:30:00.000Z"
    });
  });

  it("updates a page by chaining saveDraft and publishDraft", async () => {
    const { service } = makeService();
    jest.spyOn(service as any, "getPageForMutation").mockResolvedValue({
      id: "page-1",
      projectId: "project-1",
      title: "Roadmap",
      draft: {
        draftVersion: 4
      }
    });
    const saveDraftSpy = jest.spyOn(service, "saveDraft").mockResolvedValue({
      draftVersion: 5,
      updatedAt: "2026-03-03T12:00:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });
    const publishDraftSpy = jest.spyOn(service, "publishDraft").mockResolvedValue({
      pageId: "page-1",
      revisionNumber: 6,
      publishedAt: "2026-03-03T12:10:00.000Z",
      draftVersion: 6
    });

    await expect(
      service.updatePage(
        "page-1",
        {
          title: "Roadmap v2",
          contentMarkdown: "Updated content",
          changeNote: "Polish roadmap"
        },
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).resolves.toEqual({
      pageId: "page-1",
      revisionNumber: 6
    });

    expect(saveDraftSpy).toHaveBeenCalledWith(
      "page-1",
      {
        title: "Roadmap v2",
        contentMarkdown: "Updated content",
        baseDraftVersion: 4
      },
      expect.objectContaining({
        userId: "editor-1"
      })
    );
    expect(publishDraftSpy).toHaveBeenCalledWith(
      "page-1",
      {
        baseDraftVersion: 5,
        changeNote: "Polish roadmap"
      },
      expect.objectContaining({
        userId: "editor-1"
      })
    );
  });

  it("updates a page using the existing title when the incoming title is blank and there is no draft", async () => {
    const { service } = makeService();
    jest.spyOn(service as any, "getPageForMutation").mockResolvedValue({
      id: "page-1",
      projectId: "project-1",
      title: "Existing title",
      draft: null
    });
    const saveDraftSpy = jest.spyOn(service, "saveDraft").mockResolvedValue({
      draftVersion: 2,
      updatedAt: "2026-03-03T12:00:00.000Z",
      updatedBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });
    jest.spyOn(service, "publishDraft").mockResolvedValue({
      pageId: "page-1",
      revisionNumber: 2,
      publishedAt: "2026-03-03T12:10:00.000Z",
      draftVersion: 3
    });

    await service.updatePage(
      "page-1",
      {
        title: "   ",
        contentMarkdown: "Updated content"
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(saveDraftSpy).toHaveBeenCalledWith(
      "page-1",
      {
        title: "Existing title",
        contentMarkdown: "Updated content",
        baseDraftVersion: 1
      },
      expect.objectContaining({ userId: "editor-1" })
    );
  });

  it("rejects wiki page deletion for reader users", async () => {
    const { service, prisma, accessService } = makeService();
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
          currentRevision: null,
          draft: null
        }),
        update: jest.fn()
      },
      wikiLink: {
        deleteMany: jest.fn(),
        updateMany: jest.fn()
      }
    };
    accessService.ensureProjectWritable.mockRejectedValueOnce(new ForbiddenException("Forbidden"));
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    await expect(
      service.deletePage("page-1", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.wikiLink.deleteMany).not.toHaveBeenCalled();
    expect(tx.wikiLink.updateMany).not.toHaveBeenCalled();
    expect(tx.wikiPage.update).not.toHaveBeenCalled();
  });

  it("returns not found when deleting a missing wiki page", async () => {
    const { service, prisma, accessService } = makeService();
    const tx: any = {
      wikiPage: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    await expect(
      service.deletePage("missing-page", {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(accessService.ensureProjectWritable).not.toHaveBeenCalled();
  });

  it("throws when delete returns a page without deletedAt", async () => {
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
          currentRevision: null,
          draft: null
        }),
        update: jest.fn().mockResolvedValue({
          id: "page-1",
          deletedAt: null
        })
      },
      wikiLink: {
        deleteMany: jest.fn(),
        updateMany: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));

    await expect(
      service.deletePage("page-1", {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it("rejects missing and oversized wiki uploads", async () => {
    const { service, storageService } = makeService();

    await expect(
      service.uploadWikiAsset(
        "project-1",
        undefined,
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.uploadWikiAsset(
        "project-1",
        {
          mimetype: "image/png",
          size: 10 * 1024 * 1024 + 1,
          originalname: "huge.png"
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

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("reader-1", "reader", "project-1");
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

  it("lists backlinks with de-duplication and stable ordering", async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, "ensurePageReadable").mockResolvedValue({
      id: "page-1",
      projectId: "project-1"
    });
    prisma.wikiPage.findUnique.mockResolvedValue({
      path: "guides/roadmap"
    });
    prisma.wikiLink.findMany.mockResolvedValue([
      {
        fromPageId: "page-b",
        fromPage: {
          title: "Beta",
          path: "beta"
        }
      },
      {
        fromPageId: "page-a",
        fromPage: {
          title: "Alpha",
          path: "alpha"
        }
      },
      {
        fromPageId: "page-b",
        fromPage: {
          title: "Beta",
          path: "beta"
        }
      },
      {
        fromPageId: "deleted",
        fromPage: null
      }
    ]);

    await expect(
      service.listBacklinks("page-1", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual([
      {
        fromPageId: "page-a",
        fromTitle: "Alpha",
        fromPath: "alpha"
      },
      {
        fromPageId: "page-b",
        fromTitle: "Beta",
        fromPath: "beta"
      }
    ]);
  });

  it("returns not found when backlink lookup cannot reload the wiki page path", async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, "ensurePageReadable").mockResolvedValue({
      id: "page-1",
      projectId: "project-1"
    });
    prisma.wikiPage.findUnique.mockResolvedValue(null);

    await expect(
      service.listBacklinks("page-1", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lists revision history in descending revision order", async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, "ensurePageReadable").mockResolvedValue({
      id: "page-1",
      projectId: "project-1"
    });
    prisma.wikiRevision.findMany.mockResolvedValue([
      {
        id: "rev-2",
        revisionNumber: 2,
        createdAt: new Date("2026-03-04T10:00:00.000Z"),
        changeNote: "Second",
        createdBy: {
          id: "user-2",
          name: "Editor",
          email: "editor@example.com"
        }
      }
    ]);

    await expect(
      service.listRevisions("page-1", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual([
      {
        id: "rev-2",
        revisionNumber: 2,
        publishedAt: "2026-03-04T10:00:00.000Z",
        createdBy: {
          id: "user-2",
          name: "Editor",
          email: "editor@example.com"
        },
        changeNote: "Second"
      }
    ]);
  });

  it("returns a specific readable wiki revision with content and author metadata", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.wikiPage.findFirst.mockResolvedValue({
      id: "page-1",
      projectId: "project-1",
      currentRevisionId: "rev-2"
    });
    prisma.wikiRevision.findFirst.mockResolvedValue({
      id: "rev-2",
      revisionNumber: 2,
      contentMarkdown: "# Roadmap",
      createdAt: new Date("2026-03-04T12:00:00.000Z"),
      changeNote: "Clarify scope",
      createdBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      }
    });

    await expect(
      service.getRevision("page-1", "rev-2", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual({
      id: "rev-2",
      revisionNumber: 2,
      contentMarkdown: "# Roadmap",
      publishedAt: "2026-03-04T12:00:00.000Z",
      createdBy: {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com"
      },
      changeNote: "Clarify scope"
    });

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("reader-1", "reader", "project-1");
    expect(prisma.wikiRevision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "rev-2",
          pageId: "page-1"
        }
      })
    );
  });

  it("throws when the requested wiki revision does not belong to the page", async () => {
    const { service, prisma } = makeService();
    prisma.wikiPage.findFirst.mockResolvedValue({
      id: "page-1",
      projectId: "project-1"
    });
    prisma.wikiRevision.findFirst.mockResolvedValue(null);

    await expect(
      service.getRevision("page-1", "rev-missing", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("uploads a valid wiki image and returns stored asset metadata", async () => {
    const { service, prisma, storageService, auditService, accessService } = makeService();
    storageService.saveUpload.mockResolvedValue({ id: "file-1" });
    prisma.fileObject.findUnique.mockResolvedValue({
      id: "file-1",
      mimeType: "image/png",
      sizeBytes: BigInt(12),
      originalName: "diagram.png"
    });
    prisma.wikiAsset.create.mockResolvedValue({
      id: "asset-1"
    });

    await expect(
      service.uploadWikiAsset(
        "project-1",
        {
          originalname: "diagram.png",
          mimetype: "image/png",
          size: 12
        } as any,
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).resolves.toEqual({
      assetId: "asset-1",
      url: "/wiki-assets/asset-1/content",
      mimeType: "image/png",
      sizeBytes: 12,
      originalName: "diagram.png"
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "wiki.asset.upload"
      })
    );
  });

  it("throws when the uploaded wiki file metadata cannot be reloaded", async () => {
    const { service, prisma, storageService } = makeService();
    storageService.saveUpload.mockResolvedValue({ id: "file-1" });
    prisma.fileObject.findUnique.mockResolvedValue(null);

    await expect(
      service.uploadWikiAsset(
        "project-1",
        {
          originalname: "diagram.png",
          mimetype: "image/png",
          size: 12
        } as any,
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns wiki asset content after checking read access", async () => {
    const { service, prisma, storageService, accessService } = makeService();
    prisma.wikiAsset.findFirst.mockResolvedValue({
      id: "asset-1",
      projectId: "project-1",
      fileObject: {
        storagePath: "wiki/asset-1.png",
        mimeType: "image/png",
        originalName: "asset.png"
      }
    });
    storageService.readObject.mockResolvedValue(Buffer.from("png-bytes"));

    await expect(
      service.getWikiAssetContent("asset-1", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual({
      buffer: Buffer.from("png-bytes"),
      mimeType: "image/png",
      fileName: "asset.png"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("reader-1", "reader", "project-1");
  });

  it("returns not found when a wiki asset cannot be loaded", async () => {
    const { service, prisma } = makeService();
    prisma.wikiAsset.findFirst.mockResolvedValue(null);

    await expect(
      service.getWikiAssetContent("missing-asset", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
