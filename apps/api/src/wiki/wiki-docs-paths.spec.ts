import { BadRequestException } from "@nestjs/common";

import {
  buildCanonicalDocsPath,
  buildStructureCounts,
  docsPathToWikiPath,
  extractDocsKindFromWikiPath,
  extractRepositoryPrefixFromWikiPath,
  getDocsPathInfo,
  isLegacyDocsPath,
  legacyDocsPathToCanonicalDocsPath,
  normalizeDocsKind,
  splitWikiPath,
  wikiPathToDocsPath
} from "./wiki-docs-paths";

describe("wiki Docs path helpers", () => {
  it("identifies canonical and legacy Docs paths", () => {
    expect(getDocsPathInfo("Docs/Research/README.md")).toEqual({
      docsPath: "Docs/Research/README.md",
      relativePath: "Research/README.md",
      kind: "research",
      canonical: true,
      isOverview: true
    });
    expect(getDocsPathInfo("/Docs/Implementation/backend/API.md")).toMatchObject({
      docsPath: "Docs/Implementation/backend/API.md",
      relativePath: "Implementation/backend/API.md",
      kind: "implementation",
      canonical: true,
      isOverview: false
    });
    expect(getDocsPathInfo("Docs/legacy/topic.md")).toMatchObject({
      kind: "legacy",
      canonical: false,
      isOverview: false
    });
  });

  it("maps Docs paths to Wiki paths and preserves legacy behavior", () => {
    expect(docsPathToWikiPath("repo", "Docs/Research/README.md")).toBe("research/repo/readme");
    expect(docsPathToWikiPath("repo", "Docs/Implementation/backend/API Reference.md")).toBe(
      "implementation/repo/backend/api-reference"
    );
    expect(docsPathToWikiPath("repo", "Docs/legacy topic.md")).toBe("repo/legacy-topic");
    expect(() => docsPathToWikiPath("repo", "Docs/Research")).toThrow(BadRequestException);
  });

  it("maps Wiki paths back to Docs paths with repository prefix checks", () => {
    expect(wikiPathToDocsPath("repo", "research/repo")).toBe("Docs/Research/index.md");
    expect(wikiPathToDocsPath("repo", "implementation/repo/backend/api")).toBe("Docs/Implementation/backend/api.md");
    expect(wikiPathToDocsPath("repo", "repo/legacy")).toBe("Docs/legacy.md");
    expect(() => wikiPathToDocsPath("repo", "other/legacy")).toThrow(BadRequestException);
  });

  it("builds canonical migration targets and repository metadata helpers", () => {
    expect(normalizeDocsKind("implementation")).toBe("implementation");
    expect(normalizeDocsKind("unexpected")).toBe("research");
    expect(buildCanonicalDocsPath("research", "backend/guide.md")).toBe("Docs/Research/backend/guide.md");
    expect(buildCanonicalDocsPath("implementation", "")).toBe("Docs/Implementation/index.md");
    expect(legacyDocsPathToCanonicalDocsPath("Docs/backend/guide.md", "implementation")).toBe(
      "Docs/Implementation/backend/guide.md"
    );
    expect(isLegacyDocsPath("Docs/backend/guide.md")).toBe(true);
    expect(isLegacyDocsPath("Docs/Research/guide.md")).toBe(false);
    expect(splitWikiPath("research/repo/backend/guide")).toEqual({ slug: "guide", folderPath: "research/repo/backend" });
    expect(extractRepositoryPrefixFromWikiPath("research/repo/backend/guide")).toBe("repo");
    expect(extractRepositoryPrefixFromWikiPath("repo/backend/guide")).toBe("repo");
    expect(extractDocsKindFromWikiPath("implementation/repo/backend")).toBe("implementation");
    expect(extractDocsKindFromWikiPath("repo/backend")).toBe("legacy");
  });

  it("counts Docs structures for sync status", () => {
    expect(
      buildStructureCounts([
        "Docs/Research/index.md",
        "Docs/Research/topic.md",
        "Docs/Implementation/architecture.md",
        "Docs/legacy.md"
      ])
    ).toEqual({
      research: 2,
      implementation: 1,
      legacy: 1,
      migrationAvailable: true
    });
    expect(buildStructureCounts([])).toEqual({
      research: 0,
      implementation: 0,
      legacy: 0,
      migrationAvailable: false
    });
  });
});
