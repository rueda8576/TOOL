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

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("reader-1", "reader", "project-1");
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
});
