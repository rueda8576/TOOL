import { docsPathToWikiPath } from "./wiki-docs-paths";
import { WIKI_SEGMENT_PATTERN } from "./wiki-paths";

const WIKI_LINK_PATTERN = /\[\[([^[\]]+)\]\]/g;
const MARKDOWN_LINK_PATTERN = /(?<!!)\[[^\]]+]\(([^)]+)\)/g;

export function isExternalMarkdownTarget(rawTarget: string): boolean {
  const target = rawTarget.trim();
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("data:") ||
    target.startsWith("mailto:") ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    target.startsWith("//")
  );
}

export function resolveRelativeDocsPath(fromDocsPath: string, rawTarget: string): string | null {
  if (!rawTarget.trim() || isExternalMarkdownTarget(rawTarget)) {
    return null;
  }

  let targetPath = rawTarget.trim().replace(/^<|>$/g, "").split("#")[0]?.split("?")[0] ?? "";
  try {
    targetPath = decodeURIComponent(targetPath);
  } catch {
    // Keep raw target when it is not URI-encoded.
  }
  if (!/\.(md|markdown)$/i.test(targetPath)) {
    return null;
  }

  const sourceSegments = fromDocsPath.replace(/\\/g, "/").split("/").filter(Boolean);
  sourceSegments.pop();
  const resolvedSegments = [...sourceSegments];
  for (const segment of targetPath.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolvedSegments.length === 0) {
        return null;
      }
      resolvedSegments.pop();
      continue;
    }
    resolvedSegments.push(segment);
  }

  return resolvedSegments.join("/");
}

export function parseMarkdownRelativeWikiLinks(contentMarkdown: string, docsSource?: { prefix: string; docsPath: string }): string[] {
  if (!docsSource) {
    return [];
  }

  const links = new Set<string>();
  for (const match of contentMarkdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const rawTarget = (match[1] ?? "").trim();
    const resolvedDocsPath = resolveRelativeDocsPath(docsSource.docsPath, rawTarget);
    if (!resolvedDocsPath) {
      continue;
    }
    links.add(docsPathToWikiPath(docsSource.prefix, resolvedDocsPath));
  }
  return [...links];
}

export function parseWikiLinks(contentMarkdown: string, docsSource?: { prefix: string; docsPath: string }): string[] {
  const links = new Set<string>();
  for (const match of contentMarkdown.matchAll(WIKI_LINK_PATTERN)) {
    const rawPath = (match[1] ?? "").trim().toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!rawPath) {
      continue;
    }

    const segments = rawPath.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    if (segments.some((segment) => !WIKI_SEGMENT_PATTERN.test(segment))) {
      continue;
    }

    links.add(segments.join("/"));
  }
  for (const docsLink of parseMarkdownRelativeWikiLinks(contentMarkdown, docsSource)) {
    links.add(docsLink);
  }
  return [...links];
}
