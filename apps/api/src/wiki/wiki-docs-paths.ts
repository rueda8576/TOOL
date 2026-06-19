import { BadRequestException } from "@nestjs/common";

import { WikiDocsKind, WikiDocsStructureCounts, WikiDocsStructureKind } from "./wiki.types";
import { normalizePath, stripMarkdownExtension, toWikiPathSegment } from "./wiki-paths";

export const WIKI_DOCS_ROOT = "Docs";
export const WIKI_DOCS_DEFAULT_KIND: WikiDocsKind = "research";
export const WIKI_DOCS_KIND_SEGMENTS: Record<WikiDocsKind, string> = {
  research: "Research",
  implementation: "Implementation"
};

export type WikiDocsPathInfo = {
  docsPath: string;
  relativePath: string;
  kind: WikiDocsStructureKind;
  canonical: boolean;
  isOverview: boolean;
};

export function normalizeDocsKind(rawKind?: string | null): WikiDocsKind {
  return rawKind === "implementation" ? "implementation" : WIKI_DOCS_DEFAULT_KIND;
}

export function docsKindToGitSegment(kind: WikiDocsKind): string {
  return WIKI_DOCS_KIND_SEGMENTS[kind];
}

export function getDocsPathInfo(docsPath: string): WikiDocsPathInfo {
  const normalizedDocsPath = docsPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const relativePath = normalizedDocsPath.startsWith(`${WIKI_DOCS_ROOT}/`)
    ? normalizedDocsPath.slice(`${WIKI_DOCS_ROOT}/`.length)
    : normalizedDocsPath;
  const segments = relativePath.split("/").filter(Boolean);
  const rawKind = segments[0];
  const canonicalKind: WikiDocsKind | null =
    rawKind === "Research" ? "research" : rawKind === "Implementation" ? "implementation" : null;
  const fileName = segments[segments.length - 1] ?? "";
  const fileStem = stripMarkdownExtension(fileName).toLowerCase();

  return {
    docsPath: normalizedDocsPath,
    relativePath,
    kind: canonicalKind ?? "legacy",
    canonical: canonicalKind !== null,
    isOverview: canonicalKind !== null && (fileStem === "readme" || fileStem === "index")
  };
}

export function docsPathToWikiPath(prefix: string, docsPath: string): string {
  const normalizedDocsPath = docsPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const relativePath = normalizedDocsPath.startsWith(`${WIKI_DOCS_ROOT}/`)
    ? normalizedDocsPath.slice(`${WIKI_DOCS_ROOT}/`.length)
    : normalizedDocsPath;
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new BadRequestException("Docs path is required");
  }

  const rawKind = segments[0];
  const canonicalKind: WikiDocsKind | null =
    rawKind === "Research" ? "research" : rawKind === "Implementation" ? "implementation" : null;
  const contentSegments = canonicalKind ? segments.slice(1) : segments;
  if (contentSegments.length === 0) {
    throw new BadRequestException("Docs path must include a Markdown file");
  }

  const last = contentSegments[contentSegments.length - 1]!;
  const fileStem = stripMarkdownExtension(last);
  const wikiSegments = [
    ...(canonicalKind ? [canonicalKind] : []),
    prefix,
    ...contentSegments.slice(0, -1).map((segment) => toWikiPathSegment(segment, "folder")),
    toWikiPathSegment(fileStem)
  ];
  return wikiSegments.join("/");
}

export function wikiPathToDocsPath(prefix: string, wikiPath: string): string {
  const normalizedWikiPath = normalizePath(wikiPath);
  const segments = normalizedWikiPath.split("/").filter(Boolean);
  const first = segments[0];
  const second = segments[1];

  if ((first === "research" || first === "implementation") && second === prefix) {
    const relativeWikiPath = segments.length <= 2 ? "index" : segments.slice(2).join("/");
    return `${WIKI_DOCS_ROOT}/${docsKindToGitSegment(first)}/${relativeWikiPath}.md`;
  }

  if (normalizedWikiPath !== prefix && !normalizedWikiPath.startsWith(`${prefix}/`)) {
    throw new BadRequestException("Wiki page is outside the repository Docs prefix");
  }

  const relativeWikiPath = normalizedWikiPath === prefix ? "index" : normalizedWikiPath.slice(prefix.length + 1);
  return `${WIKI_DOCS_ROOT}/${relativeWikiPath}.md`;
}

export function buildCanonicalDocsPath(kind: WikiDocsKind, relativePath: string): string {
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return `${WIKI_DOCS_ROOT}/${docsKindToGitSegment(kind)}/${normalizedRelativePath || "index.md"}`;
}

export function legacyDocsPathToCanonicalDocsPath(docsPath: string, kind: WikiDocsKind): string {
  const info = getDocsPathInfo(docsPath);
  if (info.canonical) {
    return info.docsPath;
  }
  return buildCanonicalDocsPath(kind, info.relativePath);
}

export function emptyStructureCounts(): WikiDocsStructureCounts {
  return {
    research: 0,
    implementation: 0,
    legacy: 0,
    migrationAvailable: false
  };
}

export function buildStructureCounts(docsPaths: string[]): WikiDocsStructureCounts {
  const counts = emptyStructureCounts();
  for (const docsPath of docsPaths) {
    const info = getDocsPathInfo(docsPath);
    if (info.kind === "research") {
      counts.research += 1;
    } else if (info.kind === "implementation") {
      counts.implementation += 1;
    } else {
      counts.legacy += 1;
    }
  }
  counts.migrationAvailable = counts.legacy > 0;
  return counts;
}

export function isLegacyDocsPath(docsPath: string): boolean {
  return !getDocsPathInfo(docsPath).canonical;
}

export function splitWikiPath(path: string): { slug: string; folderPath: string } {
  const segments = path.split("/").filter(Boolean);
  const slug = segments[segments.length - 1] ?? path;
  return {
    slug,
    folderPath: segments.slice(0, -1).join("/")
  };
}

export function extractRepositoryPrefixFromWikiPath(wikiPath: string): string | null {
  const segments = wikiPath.split("/").filter(Boolean);
  if (segments[0] === "research" || segments[0] === "implementation") {
    return segments[1] ?? null;
  }
  return segments[0] ?? null;
}

export function extractDocsKindFromWikiPath(wikiPath: string): WikiDocsStructureKind {
  const first = wikiPath.split("/").filter(Boolean)[0];
  return first === "research" || first === "implementation" ? first : "legacy";
}
