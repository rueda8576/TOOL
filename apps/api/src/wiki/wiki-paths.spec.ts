import { BadRequestException } from "@nestjs/common";

import {
  composePath,
  extractTitleFromMarkdown,
  hashMarkdownContent,
  humanizeFileStem,
  normalizeFolderPath,
  normalizePath,
  normalizeSlug,
  stripMarkdownExtension,
  toWikiPathSegment
} from "./wiki-paths";

describe("wiki path helpers", () => {
  it("normalizes wiki slugs, folder paths, and page paths with existing errors", () => {
    expect(normalizeSlug("RoadMap")).toBe("roadmap");
    expect(() => normalizeSlug("Road map")).toThrow(BadRequestException);

    expect(normalizeFolderPath(" Guides\\Systems ")).toBe("guides/systems");
    expect(normalizeFolderPath("   ")).toBe("");
    expect(normalizeFolderPath()).toBe("");
    expect(() => normalizeFolderPath("guides/invalid path")).toThrow(BadRequestException);

    expect(normalizePath(" /Guides/Roadmap/ ")).toBe("guides/roadmap");
    expect(() => normalizePath("   ")).toThrow(BadRequestException);
    expect(() => normalizePath("guides/invalid path")).toThrow(BadRequestException);
  });

  it("formats path segments and page paths without changing fallback behavior", () => {
    expect(composePath("guides", "roadmap")).toBe("guides/roadmap");
    expect(composePath("", "roadmap")).toBe("roadmap");
    expect(toWikiPathSegment(" API Reference++ ")).toBe("api-reference");
    expect(toWikiPathSegment("!!!", "folder")).toBe("folder");
    expect(toWikiPathSegment("x".repeat(140))).toHaveLength(120);
  });

  it("extracts titles and hashes markdown content deterministically", () => {
    expect(stripMarkdownExtension("guide.markdown")).toBe("guide");
    expect(humanizeFileStem("api_reference-guide")).toBe("api reference guide");
    expect(humanizeFileStem("")).toBe("Untitled");
    expect(extractTitleFromMarkdown("intro\n# Canonical Title\nbody", "Docs/Research/fallback.md")).toBe("Canonical Title");
    expect(extractTitleFromMarkdown("body", "Docs/Research/API_reference.md")).toBe("API reference");
    expect(hashMarkdownContent("content")).toBe("ed7002b439e9ac845f22357d822bac1444730fbdb6016d3ec9432297b9ec9f73");
  });
});
