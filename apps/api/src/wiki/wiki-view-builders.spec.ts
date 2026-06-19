import {
  buildDocsConflict,
  buildDocsSourceView,
  buildEmptyDocsSyncRepositoryResult,
  buildPreparedDocsPage,
  buildPublishedRevision,
  buildStructureMigrationRow,
  buildSyncRepositoryStatus,
  buildUnassignedDocsPages,
  buildWikiPageSummary,
  buildWikiTreeNodes,
  groupUnboundWikiPagesByRepository,
  isBindingWikiChanged,
  sanitizeSearchSnippet
} from "./wiki-view-builders";

describe("wiki view builders", () => {
  const repository = {
    id: "repo-1",
    name: "Atlasium Nav",
    pathWithNamespace: "atlasium/nav",
    defaultBranch: "main",
    wikiDocsPrefix: "atlasium-nav",
    wikiDocsLastSyncedAt: new Date("2026-06-18T12:00:00.000Z"),
    wikiDocsLastSyncError: null
  };

  it("builds prepared Docs pages with wiki path, title, and stable content hash", () => {
    const prepared = buildPreparedDocsPage("atlasium-nav", {
      docsPath: "Docs/Research/index.md",
      relativePath: "Research/index.md",
      fileName: "index.md",
      ref: "main",
      blobId: "blob-1",
      lastCommitId: "commit-1",
      contentSha256: null,
      content: "# Research Index\n\nArchive notes"
    });

    expect(prepared).toMatchObject({
      title: "Research Index",
      slug: "index",
      folderPath: "research/atlasium-nav",
      wikiPath: "research/atlasium-nav/index",
      docsPath: "Docs/Research/index.md",
      contentMarkdown: "# Research Index\n\nArchive notes"
    });
    expect(prepared.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.contentHash).toBe(buildPreparedDocsPage("atlasium-nav", {
      docsPath: "Docs/Research/index.md",
      relativePath: "Research/index.md",
      fileName: "index.md",
      ref: "main",
      blobId: "blob-1",
      lastCommitId: "commit-1",
      contentSha256: null,
      content: "# Research Index\n\nArchive notes"
    }).contentHash);
  });

  it("builds Docs-aware tree nodes with taxonomy roots and overview pages first", () => {
    const tree = buildWikiTreeNodes(
      [
        {
          id: "page-2",
          title: "Architecture",
          path: "implementation/atlasium-nav/architecture",
          docsPath: "Docs/Implementation/architecture.md",
          repositoryName: "Atlasium Nav",
          isUnpublished: false,
          updatedAt: new Date("2026-06-18T11:00:00.000Z"),
          hasDraftChanges: true,
          draftUpdatedAt: new Date("2026-06-18T11:30:00.000Z"),
          draftUpdatedBy: { id: "user-1", name: "Editor", email: "editor@example.com" }
        },
        {
          id: "page-1",
          title: "Implementation Overview",
          path: "implementation/atlasium-nav/index",
          docsPath: "Docs/Implementation/index.md",
          repositoryName: "Atlasium Nav",
          isUnpublished: false,
          updatedAt: new Date("2026-06-18T10:00:00.000Z"),
          hasDraftChanges: false,
          draftUpdatedAt: null,
          draftUpdatedBy: null
        },
        {
          id: "page-3",
          title: "Research Overview",
          path: "research/atlasium-nav/index",
          docsPath: "Docs/Research/README.md",
          repositoryName: "Atlasium Nav",
          isUnpublished: true,
          updatedAt: new Date("2026-06-18T09:00:00.000Z"),
          hasDraftChanges: false,
          draftUpdatedAt: null,
          draftUpdatedBy: null
        }
      ],
      [repository]
    );

    expect(tree.map((node) => node.path)).toEqual(["research", "implementation"]);
    expect(tree[0]).toMatchObject({ type: "folder", path: "research", displayName: "Research", docsKind: "research" });
    expect(tree[1]?.children[0]).toMatchObject({
      type: "folder",
      path: "implementation/atlasium-nav",
      displayName: "Atlasium Nav",
      docsKind: "implementation"
    });
    expect(tree[1]?.children[0]?.children.map((node) => node.path)).toEqual([
      "implementation/atlasium-nav/index",
      "implementation/atlasium-nav/architecture"
    ]);
    expect(tree[1]?.children[0]?.children[1]).toMatchObject({
      pageId: "page-2",
      hasDraftChanges: true,
      draftUpdatedAt: "2026-06-18T11:30:00.000Z",
      repositoryName: "Atlasium Nav"
    });
  });

  it("maps page summaries, revisions, snippets, docs source, and repository status", () => {
    const page = {
      id: "page-1",
      projectId: "project-1",
      title: "Roadmap",
      slug: "roadmap",
      folderPath: "guides",
      path: "guides/roadmap",
      templateType: null,
      updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      currentRevision: {
        id: "revision-1",
        revisionNumber: 2,
        contentMarkdown: "# Roadmap",
        createdAt: new Date("2026-06-18T12:05:00.000Z"),
        changeNote: "Publish",
        createdBy: { id: "user-1", name: "Editor", email: "editor@example.com" }
      }
    };

    expect(buildWikiPageSummary(page)).toEqual({
      id: "page-1",
      projectId: "project-1",
      title: "Roadmap",
      slug: "roadmap",
      folderPath: "guides",
      path: "guides/roadmap",
      templateType: null,
      updatedAt: "2026-06-18T12:00:00.000Z"
    });
    expect(buildPublishedRevision(page)).toMatchObject({
      id: "revision-1",
      revisionNumber: 2,
      publishedAt: "2026-06-18T12:05:00.000Z"
    });
    expect(sanitizeSearchSnippet("  <b>Roadmap</b>   <mark>draft</mark>  ")).toBe("Roadmap draft");
    expect(buildDocsSourceView({
      id: "binding-1",
      repositoryId: repository.id,
      docsPath: "Docs/Research/index.md",
      wikiPath: "research/atlasium-nav/index",
      status: "active",
      wikiRevisionId: null,
      wikiContentHash: null,
      wikiPage: null,
      repository
    })).toEqual({
      repositoryId: "repo-1",
      repositoryName: "Atlasium Nav",
      pathWithNamespace: "atlasium/nav",
      defaultBranch: "main",
      docsPath: "Docs/Research/index.md",
      docsRoot: "Docs",
      wikiPrefix: "atlasium-nav",
      docsKind: "research",
      isOverview: true
    });
    expect(buildSyncRepositoryStatus(repository, 3, 1, {
      research: 2,
      implementation: 1,
      legacy: 0,
      migrationAvailable: false
    })).toMatchObject({
      repositoryId: "repo-1",
      wikiDocsPrefix: "atlasium-nav",
      lastSyncedAt: "2026-06-18T12:00:00.000Z",
      bindings: { active: 3, deleted: 1 }
    });
  });

  it("builds structure migration and sync conflict helpers without changing API field names", () => {
    const binding = {
      id: "binding-1",
      projectId: "project-1",
      repositoryId: repository.id,
      wikiPageId: "page-1",
      docsPath: "Docs/legacy.md",
      wikiPath: "atlasium-nav/legacy",
      gitBlobId: null,
      gitLastCommitId: null,
      gitContentHash: null,
      wikiRevisionId: "revision-1",
      wikiContentHash: null,
      status: "active",
      lastSyncedAt: null,
      repository,
      wikiPage: {
        id: "page-1",
        projectId: "project-1",
        title: "Legacy",
        path: "atlasium-nav/legacy",
        slug: "legacy",
        folderPath: "atlasium-nav",
        deletedAt: null,
        currentRevisionId: "revision-1",
        currentRevision: {
          id: "revision-1",
          revisionNumber: 1,
          contentMarkdown: "# Legacy"
        },
        draft: {
          title: "Legacy draft",
          contentMarkdown: "# Legacy"
        }
      }
    };

    expect(buildStructureMigrationRow({ binding, targetKind: "implementation", conflicts: ["Destination exists"] })).toEqual({
      bindingId: "binding-1",
      pageId: "page-1",
      title: "Legacy",
      repositoryId: "repo-1",
      repositoryName: "Atlasium Nav",
      currentWikiPath: "atlasium-nav/legacy",
      currentDocsPath: "Docs/legacy.md",
      targetKind: "implementation",
      targetWikiPath: "implementation/atlasium-nav/legacy",
      targetDocsPath: "Docs/Implementation/legacy.md",
      hasDraftChanges: true,
      conflicts: ["Destination exists"]
    });

    const result = buildEmptyDocsSyncRepositoryResult(repository);
    result.conflicts.push(buildDocsConflict({
      repositoryId: "repo-1",
      docsPath: "Docs/Research/index.md",
      wikiPath: "research/atlasium-nav/index",
      reason: "Both sides changed"
    }));
    expect(result).toMatchObject({
      repositoryId: "repo-1",
      structure: { research: 0, implementation: 0, legacy: 0, migrationAvailable: false },
      conflicts: [{ reason: "Both sides changed" }]
    });
  });

  it("groups unbound pages and detects wiki-side changes", () => {
    const pages = [
      {
        id: "page-1",
        title: "Assigned",
        path: "atlasium-nav/assigned",
        currentRevision: { id: "revision-1", contentMarkdown: "# Assigned" },
        draft: null
      },
      {
        id: "page-2",
        title: "Loose",
        path: "loose",
        currentRevision: { id: "revision-2", contentMarkdown: "# Loose" },
        draft: { title: "Loose draft", contentMarkdown: "# Loose draft" }
      }
    ];

    const grouped = groupUnboundWikiPagesByRepository({ repositories: [repository], pages });
    expect(grouped.pagesByRepositoryId.get("repo-1")?.map((page) => page.id)).toEqual(["page-1"]);
    expect(grouped.unassigned).toEqual([
      {
        pageId: "page-2",
        wikiPath: "loose",
        title: "Loose",
        hasDraftChanges: true,
        reason: "Wiki page is not under any repository Docs prefix"
      }
    ]);
    expect(buildUnassignedDocsPages(pages, [repository]).map((page) => page.pageId)).toEqual(["page-2"]);
    expect(isBindingWikiChanged({
      id: "binding-1",
      repositoryId: "repo-1",
      docsPath: "Docs/Research/assigned.md",
      wikiPath: "atlasium-nav/assigned",
      status: "active",
      wikiRevisionId: "old-revision",
      wikiContentHash: null,
      wikiPage: {
        id: "page-1",
        title: "Assigned",
        path: "atlasium-nav/assigned",
        slug: "assigned",
        folderPath: "atlasium-nav",
        currentRevision: {
          id: "revision-1",
          revisionNumber: 1,
          contentMarkdown: "# Assigned"
        }
      }
    })).toBe(true);
  });
});
