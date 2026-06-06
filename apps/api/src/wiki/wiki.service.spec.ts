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
    gitlabService: any;
  } => {
    const prisma: any = {
      wikiPage: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
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
      wikiDocsBinding: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn()
      },
      projectRepository: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
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

    const gitlabService: any = {
      listRepositoryDocsMarkdownFiles: jest.fn(),
      getRepositoryTextFileForDocsSync: jest.fn(),
      commitRepositoryFileActions: jest.fn()
    };

    return {
      service: new WikiService(prisma, accessService, auditService, storageService, gitlabService),
      prisma,
      accessService,
      auditService,
      storageService,
      gitlabService
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
        createMany: jest.fn(),
        updateMany: jest.fn()
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
    expect(tx.wikiLink.updateMany).toHaveBeenCalledWith({
      where: {
        toPath: "guides/roadmap",
        toPageId: null,
        fromPage: {
          projectId: "project-1",
          deletedAt: null
        }
      },
      data: {
        toPageId: "page-1"
      }
    });
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
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "page-existing", path: "guides/existing" }])
      },
      wikiDraft: {
        create: jest.fn().mockResolvedValue(undefined)
      },
      wikiLink: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn()
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
            contentMarkdown: "# New notes\n\nSee [[guides/existing]]",
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
    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          deletedAt: null,
          path: {
            in: ["guides/existing", "guides/new-notes", "guides/new-notes"]
          }
        }
      })
    );
    expect(tx.wikiPage.create).toHaveBeenCalledTimes(1);
    expect(tx.wikiDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: "page-2",
          title: "New notes",
          contentMarkdown: "# New notes\n\nSee [[guides/existing]]",
          draftVersion: 1,
          updatedById: "editor-1"
        })
      })
    );
    expect(tx.wikiLink.createMany).toHaveBeenCalledWith({
      data: [
        {
          fromPageId: "page-2",
          toPath: "guides/existing",
          toPageId: "page-existing"
        }
      ],
      skipDuplicates: true
    });
    expect(tx.wikiLink.updateMany).toHaveBeenCalledWith({
      where: {
        toPath: "guides/new-notes",
        toPageId: null,
        fromPage: {
          projectId: "project-1",
          deletedAt: null
        }
      },
      data: {
        toPageId: "page-2"
      }
    });
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

  it("returns Docs sync status with stable repository prefixes", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.projectRepository.findMany
      .mockResolvedValueOnce([
        {
          id: "repo-1",
          projectId: "project-1",
          name: "Research Repo",
          pathWithNamespace: "atlasium/research-repo",
          defaultBranch: "main",
          wikiDocsPrefix: null,
          wikiDocsLastSyncedAt: null,
          wikiDocsLastSyncError: null
        }
      ])
      .mockResolvedValueOnce([]);
    prisma.projectRepository.update.mockResolvedValue({
      id: "repo-1",
      projectId: "project-1",
      name: "Research Repo",
      pathWithNamespace: "atlasium/research-repo",
      defaultBranch: "main",
      wikiDocsPrefix: "research-repo",
      wikiDocsLastSyncedAt: null,
      wikiDocsLastSyncError: null
    });
    prisma.wikiDocsBinding.findMany.mockResolvedValue([
      {
        repositoryId: "repo-1",
        docsPath: "Docs/Research/Intro.md",
        status: "active",
      },
      {
        repositoryId: "repo-1",
        docsPath: "Docs/Implementation/Architecture.md",
        status: "active",
      },
      {
        repositoryId: "repo-1",
        docsPath: "Docs/old.md",
        status: "deleted",
      }
    ]);

    const status = await service.getDocsSyncStatus("project-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("reader-1", "reader", "project-1");
    expect(prisma.projectRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          wikiDocsPrefix: "research-repo"
        }
      })
    );
    expect(status.repositories[0]).toEqual(
      expect.objectContaining({
        repositoryId: "repo-1",
        wikiDocsPrefix: "research-repo",
        bindings: {
          active: 2,
          deleted: 1
        },
        structure: {
          research: 1,
          implementation: 1,
          legacy: 0,
          migrationAvailable: false
        }
      })
    );
  });

  it("syncs new Docs markdown files into published wiki pages", async () => {
    const { service, prisma, gitlabService } = makeService();
    const tx: any = {
      wikiPage: {
        create: jest.fn().mockResolvedValue({ id: "page-1", path: "research-repo/guides/intro" }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn()
      },
      wikiRevision: {
        create: jest.fn().mockResolvedValue({ id: "revision-1" })
      },
      wikiDraft: {
        create: jest.fn()
      },
      wikiDocsBinding: {
        create: jest.fn()
      },
      wikiLink: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn()
      }
    };
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Research Repo",
        pathWithNamespace: "atlasium/research-repo",
        defaultBranch: "main",
        wikiDocsPrefix: "research-repo",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([
      {
        docsPath: "Docs/Guides/Intro.md",
        relativePath: "Guides/Intro.md",
        fileName: "Intro.md",
        ref: "main",
        blobId: "blob-1",
        lastCommitId: "commit-1",
        contentSha256: null,
        content: "# Intro\n\nSee [Next](Next.md)."
      }
    ]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.created).toBe(1);
    expect(tx.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Intro",
          path: "research-repo/guides/intro",
          templateType: "docs"
        })
      })
    );
    expect(tx.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contentMarkdown: "# Intro\n\nSee [Next](Next.md)."
        })
      })
    );
    expect(tx.wikiLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            toPath: "research-repo/guides/next"
          })
        ]
      })
    );
  });

  it("reports conflicts when Docs and Wiki both changed since last sync", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Research Repo",
        pathWithNamespace: "atlasium/research-repo",
        defaultBranch: "main",
        wikiDocsPrefix: "research-repo",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([
      {
        id: "binding-1",
        projectId: "project-1",
        repositoryId: "repo-1",
        wikiPageId: "page-1",
        docsPath: "Docs/Intro.md",
        wikiPath: "research-repo/intro",
        gitBlobId: "blob-old",
        gitLastCommitId: "commit-old",
        gitContentHash: "old-git-hash",
        wikiRevisionId: "revision-old",
        wikiContentHash: "old-wiki-hash",
        status: "active",
        lastSyncedAt: null,
        wikiPage: {
          id: "page-1",
          title: "Intro",
          path: "research-repo/intro",
          slug: "intro",
          folderPath: "research-repo",
          deletedAt: null,
          currentRevisionId: "revision-new",
          currentRevision: {
            id: "revision-new",
            revisionNumber: 2,
            contentMarkdown: "Wiki changed"
          }
        }
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([
      {
        docsPath: "Docs/Intro.md",
        relativePath: "Intro.md",
        fileName: "Intro.md",
        ref: "main",
        blobId: "blob-new",
        lastCommitId: "commit-new",
        contentSha256: null,
        content: "Docs changed"
      }
    ]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.conflicts).toBe(1);
    expect(result.repositories[0].conflicts[0]).toEqual(
      expect.objectContaining({
        docsPath: "Docs/Intro.md",
        wikiPath: "research-repo/intro"
      })
    );
    expect(gitlabService.commitRepositoryFileActions).not.toHaveBeenCalled();
  });

  it("uses a humanized file name when imported Docs markdown has no H1", async () => {
    const { service, prisma, gitlabService } = makeService();
    const tx: any = {
      wikiPage: {
        create: jest.fn().mockResolvedValue({ id: "page-1", path: "research-repo/research/my-note" }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn()
      },
      wikiRevision: {
        create: jest.fn().mockResolvedValue({ id: "revision-1" })
      },
      wikiDraft: {
        create: jest.fn()
      },
      wikiDocsBinding: {
        create: jest.fn()
      },
      wikiLink: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn()
      }
    };
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Research Repo",
        pathWithNamespace: "atlasium/research-repo",
        defaultBranch: "main",
        wikiDocsPrefix: "research-repo",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([
      {
        docsPath: "Docs/Research/My Note.md",
        relativePath: "Research/My Note.md",
        fileName: "My Note.md",
        ref: "main",
        blobId: "blob-1",
        lastCommitId: "commit-1",
        contentSha256: null,
        content: "Plain Markdown without heading"
      }
    ]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.created).toBe(1);
    expect(tx.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "My Note",
          folderPath: "research/research-repo",
          slug: "my-note",
          path: "research/research-repo/my-note"
        })
      })
    );
  });

  it("reports path collisions instead of importing Docs over an existing wiki page", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Research Repo",
        pathWithNamespace: "atlasium/research-repo",
        defaultBranch: "main",
        wikiDocsPrefix: "research-repo",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.wikiPage.findFirst.mockResolvedValue({ id: "existing-page" });
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([
      {
        docsPath: "Docs/Intro.md",
        relativePath: "Intro.md",
        fileName: "Intro.md",
        ref: "main",
        blobId: "blob-1",
        lastCommitId: "commit-1",
        contentSha256: null,
        content: "# Intro"
      }
    ]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.conflicts).toBe(1);
    expect(result.repositories[0].conflicts[0]).toEqual(
      expect.objectContaining({
        docsPath: "Docs/Intro.md",
        wikiPath: "research-repo/intro",
        reason: "Wiki path is already used by another page or Docs binding"
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("exports Wiki-only changes to Git when Docs has not changed", async () => {
    const { service, prisma, gitlabService } = makeService();
    const syncedHash = (service as any).hashMarkdownContent("Original");
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Research Repo",
        pathWithNamespace: "atlasium/research-repo",
        defaultBranch: "main",
        wikiDocsPrefix: "research-repo",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([
      {
        id: "binding-1",
        projectId: "project-1",
        repositoryId: "repo-1",
        wikiPageId: "page-1",
        docsPath: "Docs/Intro.md",
        wikiPath: "research-repo/intro",
        gitBlobId: "blob-1",
        gitLastCommitId: "commit-1",
        gitContentHash: syncedHash,
        wikiRevisionId: "revision-1",
        wikiContentHash: syncedHash,
        status: "active",
        lastSyncedAt: null,
        wikiPage: {
          id: "page-1",
          title: "Intro",
          path: "research-repo/intro",
          slug: "intro",
          folderPath: "research-repo",
          deletedAt: null,
          currentRevisionId: "revision-2",
          currentRevision: {
            id: "revision-2",
            revisionNumber: 2,
            contentMarkdown: "Wiki changed"
          }
        }
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.projectRepository.update.mockResolvedValue({});
    prisma.wikiDocsBinding.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([
      {
        docsPath: "Docs/Intro.md",
        relativePath: "Intro.md",
        fileName: "Intro.md",
        ref: "main",
        blobId: "blob-1",
        lastCommitId: "commit-1",
        contentSha256: null,
        content: "Original"
      }
    ]);
    gitlabService.commitRepositoryFileActions.mockResolvedValue({
      id: "commit-2",
      shortId: "commit-2",
      title: "Update wiki docs file Docs/Intro.md",
      message: "Update wiki docs file Docs/Intro.md",
      createdAt: "2026-06-02T10:00:00.000Z",
      webUrl: "https://git.example/commit-2"
    });

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.updatedToGit).toBe(1);
    expect(gitlabService.commitRepositoryFileActions).toHaveBeenCalledWith(
      "project-1",
      expect.any(Object),
      "repo-1",
      [
        {
          action: "update",
          filePath: "Docs/Intro.md",
          content: "Wiki changed",
          lastCommitId: "commit-1"
        }
      ],
      "Update wiki docs file Docs/Intro.md"
    );
    expect(prisma.wikiDocsBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "binding-1" },
        data: expect.objectContaining({
          gitBlobId: "blob-1",
          gitLastCommitId: "commit-2",
          wikiRevisionId: "revision-2",
          status: "active"
        })
      })
    );
  });

  it("soft-deletes a Docs-bound wiki page when the Git file disappears without Wiki changes", async () => {
    const { service, prisma, gitlabService } = makeService();
    const syncedHash = (service as any).hashMarkdownContent("Published");
    const tx: any = {
      wikiLink: {
        deleteMany: jest.fn(),
        updateMany: jest.fn()
      },
      wikiPage: {
        update: jest.fn()
      },
      wikiDocsBinding: {
        update: jest.fn()
      }
    };
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Research Repo",
        pathWithNamespace: "atlasium/research-repo",
        defaultBranch: "main",
        wikiDocsPrefix: "research-repo",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([
      {
        id: "binding-1",
        projectId: "project-1",
        repositoryId: "repo-1",
        wikiPageId: "page-1",
        docsPath: "Docs/Intro.md",
        wikiPath: "research-repo/intro",
        gitBlobId: "blob-1",
        gitLastCommitId: "commit-1",
        gitContentHash: syncedHash,
        wikiRevisionId: "revision-1",
        wikiContentHash: syncedHash,
        status: "active",
        lastSyncedAt: null,
        wikiPage: {
          id: "page-1",
          title: "Intro",
          path: "research-repo/intro",
          slug: "intro",
          folderPath: "research-repo",
          deletedAt: null,
          currentRevisionId: "revision-1",
          currentRevision: {
            id: "revision-1",
            revisionNumber: 1,
            contentMarkdown: "Published"
          }
        }
      }
    ]);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.deletedFromWiki).toBe(1);
    expect(tx.wikiPage.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: {
        deletedAt: expect.any(Date)
      }
    });
    expect(tx.wikiDocsBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "binding-1" },
        data: expect.objectContaining({
          status: "deleted",
          gitBlobId: null,
          gitLastCommitId: null,
          gitContentHash: null
        })
      })
    );
  });

  it("exports an unbound published wiki page under a repository prefix to Git", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Auth",
        path: "backend/research/auth",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Auth"
        }
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.create.mockResolvedValue({});
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([]);
    gitlabService.getRepositoryTextFileForDocsSync.mockResolvedValue(null);
    gitlabService.commitRepositoryFileActions.mockResolvedValue({
      id: "commit-1",
      shortId: "commit-1",
      title: "Create wiki docs file Docs/research/auth.md",
      message: "Create wiki docs file Docs/research/auth.md",
      createdAt: "2026-06-02T10:00:00.000Z",
      webUrl: "https://git.example/commit-1"
    });

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.exportedToGit).toBe(1);
    expect(result.totals.unassigned).toBe(0);
    expect(gitlabService.commitRepositoryFileActions).toHaveBeenCalledWith(
      "project-1",
      expect.any(Object),
      "repo-1",
      [
        {
          action: "create",
          filePath: "Docs/research/auth.md",
          content: "# Auth"
        }
      ],
      "Create wiki docs file Docs/research/auth.md"
    );
    expect(prisma.wikiDocsBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          repositoryId: "repo-1",
          wikiPageId: "page-1",
          docsPath: "Docs/research/auth.md",
          wikiPath: "backend/research/auth",
          gitLastCommitId: "commit-1",
          wikiRevisionId: "revision-1",
          status: "active"
        })
      })
    );
  });

  it("links an unbound wiki page to an identical existing Docs file without committing", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Auth",
        path: "backend/research/auth",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Auth"
        }
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.create.mockResolvedValue({});
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([
      {
        docsPath: "Docs/research/auth.md",
        relativePath: "research/auth.md",
        fileName: "auth.md",
        ref: "main",
        blobId: "blob-1",
        lastCommitId: "commit-1",
        contentSha256: null,
        content: "# Auth"
      }
    ]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.linked).toBe(1);
    expect(result.totals.created).toBe(0);
    expect(gitlabService.commitRepositoryFileActions).not.toHaveBeenCalled();
    expect(gitlabService.getRepositoryTextFileForDocsSync).not.toHaveBeenCalled();
    expect(prisma.wikiDocsBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gitBlobId: "blob-1",
          gitLastCommitId: "commit-1",
          docsPath: "Docs/research/auth.md",
          wikiPath: "backend/research/auth"
        })
      })
    );
  });

  it("reports a conflict when an unbound wiki page differs from an existing Docs file", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Auth",
        path: "backend/research/auth",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Wiki Auth"
        }
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([
      {
        docsPath: "Docs/research/auth.md",
        relativePath: "research/auth.md",
        fileName: "auth.md",
        ref: "main",
        blobId: "blob-1",
        lastCommitId: "commit-1",
        contentSha256: null,
        content: "# Git Auth"
      }
    ]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.conflicts).toBe(1);
    expect(result.repositories[0].conflicts[0]).toEqual(
      expect.objectContaining({
        docsPath: "Docs/research/auth.md",
        wikiPath: "backend/research/auth",
        reason: "Unbound Wiki page and existing Docs file have different content"
      })
    );
    expect(gitlabService.commitRepositoryFileActions).not.toHaveBeenCalled();
    expect(prisma.wikiDocsBinding.create).not.toHaveBeenCalled();
  });

  it("reports unbound published wiki pages outside repository prefixes as unassigned", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Roadmap",
        path: "roadmap",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Roadmap"
        }
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([]);

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          currentRevisionId: {
            not: null
          },
          docsBinding: {
            is: null
          }
        })
      })
    );
    expect(result.totals.unassigned).toBe(1);
    expect(result.unassigned).toEqual([
      {
        pageId: "page-1",
        wikiPath: "roadmap",
        title: "Roadmap",
        hasDraftChanges: false,
        reason: "Wiki page is not under any repository Docs prefix"
      }
    ]);
    expect(gitlabService.commitRepositoryFileActions).not.toHaveBeenCalled();
  });

  it("does not create a Docs binding when exporting an unbound page fails in GitLab", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Auth",
        path: "backend/research/auth",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Auth"
        }
      }
    ]);
    prisma.wikiDocsBinding.findMany.mockResolvedValue([]);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.projectRepository.update.mockResolvedValue({});
    gitlabService.listRepositoryDocsMarkdownFiles.mockResolvedValue([]);
    gitlabService.getRepositoryTextFileForDocsSync.mockResolvedValue(null);
    gitlabService.commitRepositoryFileActions.mockRejectedValue(new Error("GitLab commit failed"));

    const result = await service.syncDocs("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(result.totals.errors).toBe(1);
    expect(result.repositories[0].errors[0]).toBe("/backend/research/auth: GitLab commit failed");
    expect(prisma.wikiDocsBinding.create).not.toHaveBeenCalled();
  });

  it("assigns an unbound wiki page to a Docs repository and preserves the page record", async () => {
    const { service, prisma, gitlabService } = makeService();
    const tx: any = {
      wikiPage: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([])
      },
      wikiDocsBinding: {
        create: jest.fn()
      },
      wikiLink: {
        updateMany: jest.fn()
      },
      projectRepository: {
        update: jest.fn()
      }
    };
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Roadmap",
        path: "roadmap",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Roadmap"
        },
        draft: {
          title: "Roadmap",
          contentMarkdown: "# Roadmap\n\nDraft"
        }
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));
    gitlabService.getRepositoryTextFileForDocsSync.mockResolvedValue(null);
    gitlabService.commitRepositoryFileActions.mockResolvedValue({
      id: "commit-1",
      shortId: "commit-1",
      title: "Assign wiki page backend/roadmap to Docs",
      message: "Assign wiki page backend/roadmap to Docs",
      createdAt: "2026-06-02T10:00:00.000Z",
      webUrl: "https://git.example/commit-1"
    });

    const result = await service.assignDocsPages(
      "project-1",
      {
        assignments: [
          {
            pageId: "page-1",
            repositoryId: "repo-1",
            folderPath: "",
            slug: "roadmap"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(result.totals).toEqual({
      assigned: 1,
      exportedToGit: 1,
      linked: 0,
      conflicts: 0,
      errors: 0
    });
    expect(gitlabService.commitRepositoryFileActions).toHaveBeenCalledWith(
      "project-1",
      expect.any(Object),
      "repo-1",
      [
        {
          action: "create",
          filePath: "Docs/Research/roadmap.md",
          content: "# Roadmap"
        }
      ],
      "Assign wiki page research/backend/roadmap to Docs"
    );
    expect(tx.wikiPage.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: {
        slug: "roadmap",
        folderPath: "research/backend",
        path: "research/backend/roadmap"
      }
    });
    expect(tx.wikiDocsBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          repositoryId: "repo-1",
          wikiPageId: "page-1",
          docsPath: "Docs/Research/roadmap.md",
          wikiPath: "research/backend/roadmap",
          gitLastCommitId: "commit-1",
          wikiRevisionId: "revision-1"
        })
      })
    );
    expect(tx.wikiLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { toPageId: "page-1" },
        data: { toPath: "research/backend/roadmap" }
      })
    );
    expect(tx.wikiLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          toPath: "roadmap",
          fromPage: {
            projectId: "project-1"
          }
        }),
        data: {
          toPath: "research/backend/roadmap",
          toPageId: "page-1"
        }
      })
    );
  });

  it("links an assigned wiki page when the destination Docs file has identical content", async () => {
    const { service, prisma, gitlabService } = makeService();
    const tx: any = {
      wikiPage: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([])
      },
      wikiDocsBinding: {
        create: jest.fn()
      },
      wikiLink: {
        updateMany: jest.fn()
      },
      projectRepository: {
        update: jest.fn()
      }
    };
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Roadmap",
        path: "roadmap",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Roadmap"
        },
        draft: null
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));
    gitlabService.getRepositoryTextFileForDocsSync.mockResolvedValue({
      docsPath: "Docs/roadmap.md",
      relativePath: "roadmap.md",
      fileName: "roadmap.md",
      ref: "main",
      blobId: "blob-1",
      lastCommitId: "commit-1",
      contentSha256: null,
      content: "# Roadmap"
    });

    const result = await service.assignDocsPages(
      "project-1",
      {
        assignments: [
          {
            pageId: "page-1",
            repositoryId: "repo-1",
            folderPath: "",
            slug: "roadmap"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(result.totals.linked).toBe(1);
    expect(gitlabService.commitRepositoryFileActions).not.toHaveBeenCalled();
    expect(tx.wikiDocsBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gitBlobId: "blob-1",
          gitLastCommitId: "commit-1"
        })
      })
    );
  });

  it("reports assignment conflicts for different remote content and occupied wiki paths", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValue([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Roadmap",
        path: "roadmap",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Roadmap"
        },
        draft: null
      },
      {
        id: "page-2",
        projectId: "project-1",
        title: "Vision",
        path: "vision",
        currentRevisionId: "revision-2",
        currentRevision: {
          id: "revision-2",
          contentMarkdown: "# Vision"
        },
        draft: null
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing-page" });
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    gitlabService.getRepositoryTextFileForDocsSync.mockResolvedValueOnce({
      docsPath: "Docs/roadmap.md",
      relativePath: "roadmap.md",
      fileName: "roadmap.md",
      ref: "main",
      blobId: "blob-1",
      lastCommitId: "commit-1",
      contentSha256: null,
      content: "# Remote"
    });

    const result = await service.assignDocsPages(
      "project-1",
      {
        assignments: [
          {
            pageId: "page-1",
            repositoryId: "repo-1",
            folderPath: "",
            slug: "roadmap"
          },
          {
            pageId: "page-2",
            repositoryId: "repo-1",
            folderPath: "",
            slug: "vision"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(result.totals.conflicts).toBe(2);
    expect(result.pages.map((page) => page.reason)).toEqual([
      "Destination Docs file exists with different content",
      "Destination wiki path is already used"
    ]);
    expect(gitlabService.commitRepositoryFileActions).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not mutate wiki assignment state when grouped GitLab commit fails", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.projectRepository.findMany.mockResolvedValueOnce([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: "page-1",
        projectId: "project-1",
        title: "Roadmap",
        path: "roadmap",
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          contentMarkdown: "# Roadmap"
        },
        draft: null
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    gitlabService.getRepositoryTextFileForDocsSync.mockResolvedValue(null);
    gitlabService.commitRepositoryFileActions.mockRejectedValue(new Error("GitLab commit failed"));

    const result = await service.assignDocsPages(
      "project-1",
      {
        assignments: [
          {
            pageId: "page-1",
            repositoryId: "repo-1",
            folderPath: "",
            slug: "roadmap"
          }
        ]
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(result.totals.errors).toBe(1);
    expect(result.pages[0]).toEqual(
      expect.objectContaining({
        status: "error",
        reason: "GitLab commit failed"
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("previews legacy Docs structure migration into Research by default", async () => {
    const { service, prisma, accessService, gitlabService } = makeService();
    prisma.wikiDocsBinding.findMany.mockResolvedValue([
      {
        id: "binding-1",
        projectId: "project-1",
        repositoryId: "repo-1",
        wikiPageId: "page-1",
        docsPath: "Docs/Guide.md",
        wikiPath: "backend/guide",
        gitBlobId: "blob-old",
        gitLastCommitId: "commit-old",
        gitContentHash: "hash-old",
        wikiRevisionId: "revision-1",
        wikiContentHash: "hash-old",
        status: "active",
        lastSyncedAt: null,
        repository: {
          id: "repo-1",
          projectId: "project-1",
          name: "Backend",
          pathWithNamespace: "atlasium/backend",
          defaultBranch: "main",
          wikiDocsPrefix: "backend",
          wikiDocsLastSyncedAt: null,
          wikiDocsLastSyncError: null
        },
        wikiPage: {
          id: "page-1",
          projectId: "project-1",
          title: "Guide",
          path: "backend/guide",
          slug: "guide",
          folderPath: "backend",
          deletedAt: null,
          currentRevisionId: "revision-1",
          currentRevision: {
            id: "revision-1",
            revisionNumber: 1,
            contentMarkdown: "# Guide"
          },
          draft: null
        }
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    gitlabService.getRepositoryTextFileForDocsSync
      .mockResolvedValueOnce({
        docsPath: "Docs/Guide.md",
        relativePath: "Guide.md",
        fileName: "Guide.md",
        ref: "main",
        blobId: "blob-old",
        lastCommitId: "commit-old",
        contentSha256: null,
        content: "# Guide"
      })
      .mockResolvedValueOnce(null);

    const preview = await service.getDocsStructureMigrationPreview("project-1", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("reader-1", "reader", "project-1");
    expect(preview.totals).toEqual({
      legacy: 1,
      ready: 1,
      conflicts: 0
    });
    expect(preview.rows[0]).toEqual(
      expect.objectContaining({
        bindingId: "binding-1",
        currentWikiPath: "backend/guide",
        currentDocsPath: "Docs/Guide.md",
        targetKind: "research",
        targetWikiPath: "research/backend/guide",
        targetDocsPath: "Docs/Research/Guide.md",
        hasDraftChanges: false,
        conflicts: []
      })
    );
  });

  it("reports structure migration conflicts before moving legacy Docs files", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.wikiDocsBinding.findMany.mockResolvedValue([
      {
        id: "binding-1",
        projectId: "project-1",
        repositoryId: "repo-1",
        wikiPageId: "page-1",
        docsPath: "Docs/Guide.md",
        wikiPath: "backend/guide",
        gitBlobId: "blob-old",
        gitLastCommitId: "commit-old",
        gitContentHash: "hash-old",
        wikiRevisionId: "revision-1",
        wikiContentHash: "hash-old",
        status: "active",
        lastSyncedAt: null,
        repository: {
          id: "repo-1",
          projectId: "project-1",
          name: "Backend",
          pathWithNamespace: "atlasium/backend",
          defaultBranch: "main",
          wikiDocsPrefix: "backend",
          wikiDocsLastSyncedAt: null,
          wikiDocsLastSyncError: null
        },
        wikiPage: {
          id: "page-1",
          projectId: "project-1",
          title: "Guide",
          path: "backend/guide",
          slug: "guide",
          folderPath: "backend",
          deletedAt: null,
          currentRevisionId: "revision-1",
          currentRevision: {
            id: "revision-1",
            revisionNumber: 1,
            contentMarkdown: "# Guide"
          },
          draft: {
            title: "Guide",
            contentMarkdown: "# Draft guide"
          }
        }
      }
    ]);
    prisma.wikiPage.findFirst.mockResolvedValue({ id: "page-existing" });
    prisma.wikiDocsBinding.findFirst.mockResolvedValue({ id: "binding-existing" });
    gitlabService.getRepositoryTextFileForDocsSync
      .mockResolvedValueOnce({
        docsPath: "Docs/Guide.md",
        relativePath: "Guide.md",
        fileName: "Guide.md",
        ref: "main",
        blobId: "blob-old",
        lastCommitId: "commit-old",
        contentSha256: null,
        content: "# Guide"
      })
      .mockResolvedValueOnce({
        docsPath: "Docs/Research/Guide.md",
        relativePath: "Research/Guide.md",
        fileName: "Guide.md",
        ref: "main",
        blobId: "blob-target",
        lastCommitId: "commit-target",
        contentSha256: null,
        content: "# Existing"
      });

    const preview = await service.getDocsStructureMigrationPreview("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(preview.totals).toEqual({
      legacy: 1,
      ready: 0,
      conflicts: 1
    });
    expect(preview.rows[0]?.conflicts).toEqual([
      "Wiki page has unpublished draft changes",
      "Destination wiki path is already used",
      "Destination Docs binding already exists",
      "Destination Docs file already exists"
    ]);
    expect(gitlabService.commitRepositoryFileActions).not.toHaveBeenCalled();
  });

  it("applies selected Docs structure migration to Implementation and rewrites wiki bindings", async () => {
    const { service, prisma, gitlabService } = makeService();
    const binding = {
      id: "binding-1",
      projectId: "project-1",
      repositoryId: "repo-1",
      wikiPageId: "page-1",
      docsPath: "Docs/Guide.md",
      wikiPath: "backend/guide",
      gitBlobId: "blob-old",
      gitLastCommitId: "commit-old",
      gitContentHash: "hash-old",
      wikiRevisionId: "revision-1",
      wikiContentHash: "hash-old",
      status: "active",
      lastSyncedAt: null,
      repository: {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      },
      wikiPage: {
        id: "page-1",
        projectId: "project-1",
        title: "Guide",
        path: "backend/guide",
        slug: "guide",
        folderPath: "backend",
        deletedAt: null,
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          revisionNumber: 1,
          contentMarkdown: "# Guide"
        },
        draft: null
      }
    };
    const tx: any = {
      wikiPage: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([])
      },
      wikiDocsBinding: {
        update: jest.fn()
      },
      wikiLink: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn()
      },
      projectRepository: {
        update: jest.fn()
      }
    };
    prisma.wikiDocsBinding.findMany.mockResolvedValue([binding]);
    prisma.wikiPage.findFirst.mockResolvedValue(null);
    prisma.wikiDocsBinding.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (handler: (client: any) => Promise<any>) => handler(tx));
    gitlabService.getRepositoryTextFileForDocsSync
      .mockResolvedValueOnce({
        docsPath: "Docs/Guide.md",
        relativePath: "Guide.md",
        fileName: "Guide.md",
        ref: "main",
        blobId: "blob-old",
        lastCommitId: "commit-old",
        contentSha256: null,
        content: "# Guide\n\nSee [Architecture](Architecture.md)."
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        docsPath: "Docs/Guide.md",
        relativePath: "Guide.md",
        fileName: "Guide.md",
        ref: "main",
        blobId: "blob-old",
        lastCommitId: "commit-old",
        contentSha256: null,
        content: "# Guide\n\nSee [Architecture](Architecture.md)."
      })
      .mockResolvedValueOnce({
        docsPath: "Docs/Implementation/Guide.md",
        relativePath: "Implementation/Guide.md",
        fileName: "Guide.md",
        ref: "main",
        blobId: "blob-new",
        lastCommitId: "commit-new",
        contentSha256: null,
        content: "# Guide\n\nSee [Architecture](Architecture.md)."
      });
    gitlabService.commitRepositoryFileActions.mockResolvedValue({
      id: "commit-new"
    });

    const result = await service.applyDocsStructureMigration(
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

    expect(result.totals).toEqual({
      migrated: 1,
      conflicts: 0,
      errors: 0
    });
    expect(gitlabService.commitRepositoryFileActions).toHaveBeenCalledWith(
      "project-1",
      expect.any(Object),
      "repo-1",
      [
        {
          action: "create",
          filePath: "Docs/Implementation/Guide.md",
          content: "# Guide\n\nSee [Architecture](Architecture.md)."
        },
        {
          action: "delete",
          filePath: "Docs/Guide.md",
          lastCommitId: "commit-old"
        }
      ],
      "Move wiki docs file Docs/Guide.md to Docs/Implementation/Guide.md"
    );
    expect(tx.wikiPage.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: {
        slug: "guide",
        folderPath: "implementation/backend",
        path: "implementation/backend/guide"
      }
    });
    expect(tx.wikiDocsBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "binding-1" },
        data: expect.objectContaining({
          docsPath: "Docs/Implementation/Guide.md",
          wikiPath: "implementation/backend/guide",
          gitBlobId: "blob-new",
          gitLastCommitId: "commit-new",
          status: "active"
        })
      })
    );
    expect(tx.wikiLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            fromPageId: "page-1",
            toPath: "implementation/backend/architecture"
          })
        ],
        skipDuplicates: true
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

  it("builds Docs taxonomy roots with repository labels and overview pages first", async () => {
    const { service, prisma } = makeService();
    prisma.projectRepository.findMany.mockResolvedValue([
      {
        id: "repo-1",
        projectId: "project-1",
        name: "Backend Repository",
        pathWithNamespace: "atlasium/backend",
        defaultBranch: "main",
        wikiDocsPrefix: "backend",
        wikiDocsLastSyncedAt: null,
        wikiDocsLastSyncError: null
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValue([
      {
        id: "page-methods",
        title: "Methods",
        path: "research/backend/methods",
        updatedAt: new Date("2026-03-03T10:00:00.000Z"),
        currentRevision: {
          contentMarkdown: "# Methods"
        },
        draft: null,
        docsBinding: {
          docsPath: "Docs/Research/Methods.md",
          repository: {
            name: "Backend Repository"
          }
        }
      },
      {
        id: "page-overview",
        title: "Research Overview",
        path: "research/backend/readme",
        updatedAt: new Date("2026-03-03T10:00:00.000Z"),
        currentRevision: {
          contentMarkdown: "# Research Overview"
        },
        draft: null,
        docsBinding: {
          docsPath: "Docs/Research/README.md",
          repository: {
            name: "Backend Repository"
          }
        }
      },
      {
        id: "page-architecture",
        title: "Architecture",
        path: "implementation/backend/architecture",
        updatedAt: new Date("2026-03-03T10:00:00.000Z"),
        currentRevision: {
          contentMarkdown: "# Architecture"
        },
        draft: null,
        docsBinding: {
          docsPath: "Docs/Implementation/Architecture.md",
          repository: {
            name: "Backend Repository"
          }
        }
      }
    ]);

    const tree = await service.listTree("project-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(tree[0]).toEqual(
      expect.objectContaining({
        type: "folder",
        name: "research",
        path: "research",
        displayName: "Research",
        docsKind: "research"
      })
    );
    expect(tree[1]).toEqual(
      expect.objectContaining({
        type: "folder",
        name: "implementation",
        path: "implementation",
        displayName: "Implementation",
        docsKind: "implementation"
      })
    );
    expect(tree[0]?.children[0]).toEqual(
      expect.objectContaining({
        type: "folder",
        name: "backend",
        path: "research/backend",
        displayName: "Backend Repository",
        docsKind: "research"
      })
    );
    expect(tree[0]?.children[0]?.children.map((node) => node.path)).toEqual([
      "research/backend/readme",
      "research/backend/methods"
    ]);
    expect(tree[0]?.children[0]?.children[0]).toEqual(
      expect.objectContaining({
        title: "Research Overview",
        isDocsOverview: true,
        docsKind: "research",
        repositoryName: "Backend Repository"
      })
    );
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

  it("hides draft-only link targets and backlinks from reader page details", async () => {
    const { service, prisma } = makeService();
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
      draft: null
    });
    prisma.wikiLink.findMany
      .mockResolvedValueOnce([
        {
          toPath: "published-target",
          toPageId: "published-page",
          toPage: {
            title: "Published target",
            path: "published-target",
            currentRevisionId: "revision-target"
          }
        },
        {
          toPath: "draft-target",
          toPageId: "draft-page",
          toPage: {
            title: "Draft target",
            path: "draft-target",
            currentRevisionId: null
          }
        }
      ])
      .mockResolvedValueOnce([
        {
          fromPageId: "published-source",
          fromPage: {
            title: "Published source",
            path: "published-source",
            currentRevisionId: "revision-source"
          }
        }
      ]);

    const detail = await service.getByPath(
      "project-1",
      "roadmap",
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      }
    );

    expect(prisma.wikiLink.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          fromPage: {
            deletedAt: null,
            currentRevisionId: { not: null }
          }
        })
      })
    );
    expect(detail.outgoingLinks).toEqual([
      {
        toPath: "published-target",
        toPageId: "published-page",
        title: "Published target",
        path: "published-target"
      }
    ]);
    expect(detail.backlinks).toEqual([
      {
        fromPageId: "published-source",
        fromTitle: "Published source",
        fromPath: "published-source"
      }
    ]);
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
    prisma.wikiPage.findFirst.mockImplementation(tx.wikiPage.findFirst);
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
    prisma.wikiPage.findFirst.mockImplementation(tx.wikiPage.findFirst);
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
        createMany: jest.fn(),
        updateMany: jest.fn()
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
        createMany: jest.fn(),
        updateMany: jest.fn()
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
    prisma.wikiPage.findFirst.mockImplementation(tx.wikiPage.findFirst);
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
    prisma.wikiPage.findFirst.mockImplementation(tx.wikiPage.findFirst);
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
