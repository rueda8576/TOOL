import { BadRequestException } from "@nestjs/common";

import {
  buildDocsAssignmentCommitMessage,
  buildDocsAssignmentDestination,
  buildDocsAssignmentKey,
  buildDocsAssignmentResult,
  buildDocsAssignTotals,
  groupDocsAssignmentsByRepository,
  sortDocsAssignmentResults
} from "./wiki-docs-assignment";

describe("wiki docs assignment helpers", () => {
  const page = {
    id: "page-1",
    title: "Navigation Notes",
    path: "notes/navigation"
  };
  const repository = {
    id: "repo-1",
    name: "Research Repo",
    wikiDocsPrefix: "research-repo"
  };

  it("builds canonical assignment destinations for Docs taxonomy paths", () => {
    expect(buildDocsAssignmentDestination({
      docsKind: "implementation",
      repositoryPrefix: "research-repo",
      slug: " Nav-Guide ",
      folderPath: " Architecture\\Runtime "
    })).toEqual({
      docsKind: "implementation",
      slug: "nav-guide",
      relativeFolderPath: "architecture/runtime",
      folderPath: "implementation/research-repo/architecture/runtime",
      newWikiPath: "implementation/research-repo/architecture/runtime/nav-guide",
      docsPath: "Docs/Implementation/architecture/runtime/nav-guide.md"
    });

    expect(() => buildDocsAssignmentDestination({
      docsKind: "research",
      repositoryPrefix: "research-repo",
      slug: "Invalid Slug",
      folderPath: ""
    })).toThrow(BadRequestException);
  });

  it("builds assignment result rows with default Docs kind", () => {
    expect(buildDocsAssignmentResult({
      page,
      repository,
      oldWikiPath: "notes/navigation",
      newWikiPath: "research/research-repo/navigation",
      docsPath: "Docs/Research/navigation.md",
      status: "linked",
      reason: null
    })).toEqual({
      pageId: "page-1",
      title: "Navigation Notes",
      oldWikiPath: "notes/navigation",
      newWikiPath: "research/research-repo/navigation",
      repositoryId: "repo-1",
      repositoryName: "Research Repo",
      docsPath: "Docs/Research/navigation.md",
      docsKind: "research",
      status: "linked",
      reason: null
    });
  });

  it("groups exported assignments and builds current commit messages", () => {
    const assignments = [
      {
        mode: "exportedToGit" as const,
        repository: { id: "repo-1" },
        newWikiPath: "research/repo-1/a"
      },
      {
        mode: "linked" as const,
        repository: { id: "repo-1" },
        newWikiPath: "research/repo-1/b"
      },
      {
        mode: "exportedToGit" as const,
        repository: { id: "repo-2" },
        newWikiPath: "research/repo-2/c"
      }
    ];

    expect(buildDocsAssignmentKey("repo-1", "Docs/Research/a.md")).toBe("repo-1:Docs/Research/a.md");
    expect([...groupDocsAssignmentsByRepository(assignments).keys()]).toEqual(["repo-1", "repo-2"]);
    expect(buildDocsAssignmentCommitMessage([assignments[0]!])).toBe("Assign wiki page research/repo-1/a to Docs");
    expect(buildDocsAssignmentCommitMessage([assignments[0]!, assignments[2]!])).toBe("Assign 2 wiki pages to Docs");
  });

  it("builds totals and sorts rows by previous wiki path", () => {
    const results = [
      buildDocsAssignmentResult({
        page: { ...page, id: "page-b", path: "z" },
        repository,
        oldWikiPath: "z",
        newWikiPath: "research/research-repo/z",
        docsPath: "Docs/Research/z.md",
        status: "error",
        reason: "Failed"
      }),
      buildDocsAssignmentResult({
        page: { ...page, id: "page-a", path: "a" },
        repository,
        oldWikiPath: "a",
        newWikiPath: "research/research-repo/a",
        docsPath: "Docs/Research/a.md",
        status: "exportedToGit",
        reason: null
      }),
      buildDocsAssignmentResult({
        page: { ...page, id: "page-c", path: "c" },
        repository,
        oldWikiPath: "c",
        newWikiPath: "research/research-repo/c",
        docsPath: "Docs/Research/c.md",
        status: "conflict",
        reason: "Conflict"
      })
    ];

    expect(buildDocsAssignTotals(results)).toEqual({
      assigned: 1,
      exportedToGit: 1,
      linked: 0,
      conflicts: 1,
      errors: 1
    });
    expect(sortDocsAssignmentResults(results).map((result) => result.oldWikiPath)).toEqual(["a", "c", "z"]);
  });
});
