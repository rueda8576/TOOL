"use client";

import { useEffect, useMemo, useState } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { API_BASE_URL } from "../lib/client-api";
import { normalizeWikiMathMarkdown, WikiDocsSourceView, WikiLinkView } from "../lib/wiki";

const WIKI_LINK_PATTERN = /\[\[([^[\]]+)]]/g;
const WIKI_PATH_SEGMENT_PATTERN = /^[a-z0-9-]+$/;
const WIKI_LINK_PREFIX = "/__wiki-link/";

function encodeWikiPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeWikiPath(rawPath: string): string | null {
  const normalized = rawPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!normalized) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => !WIKI_PATH_SEGMENT_PATTERN.test(segment))) {
    return null;
  }

  return segments.join("/");
}

function isExternalMarkdownTarget(rawTarget: string): boolean {
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

function stripMarkdownExtension(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, "");
}

function toWikiPathSegment(rawSegment: string, fallback = "page"): string {
  const normalized = rawSegment
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

function resolveRelativeDocsPath(fromDocsPath: string, rawTarget: string): string | null {
  if (!rawTarget.trim() || isExternalMarkdownTarget(rawTarget)) {
    return null;
  }

  let targetPath = rawTarget.trim().replace(/^<|>$/g, "").split("#")[0]?.split("?")[0] ?? "";
  try {
    targetPath = decodeURIComponent(targetPath);
  } catch {
    // Keep raw target when it is not URI-encoded.
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

function docsPathToWikiPath(docsSource: WikiDocsSourceView, docsPath: string): string {
  const normalizedDocsPath = docsPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const relativePath = normalizedDocsPath.startsWith(`${docsSource.docsRoot}/`)
    ? normalizedDocsPath.slice(`${docsSource.docsRoot}/`.length)
    : normalizedDocsPath;
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return docsSource.wikiPrefix;
  }

  const rawKind = segments[0];
  const canonicalKind = rawKind === "Research" ? "research" : rawKind === "Implementation" ? "implementation" : null;
  const contentSegments = canonicalKind ? segments.slice(1) : segments;
  if (contentSegments.length === 0) {
    return canonicalKind ? `${canonicalKind}/${docsSource.wikiPrefix}` : docsSource.wikiPrefix;
  }

  const last = contentSegments[contentSegments.length - 1] ?? "index.md";
  return [
    ...(canonicalKind ? [canonicalKind] : []),
    docsSource.wikiPrefix,
    ...contentSegments.slice(0, -1).map((segment) => toWikiPathSegment(segment, "folder")),
    toWikiPathSegment(stripMarkdownExtension(last))
  ].join("/");
}

function rewriteWikiLinksInText(markdown: string): string {
  return markdown.replace(WIKI_LINK_PATTERN, (match, rawPath: string) => {
    const normalizedPath = normalizeWikiPath(rawPath);
    if (!normalizedPath) {
      return match;
    }

    return `[${rawPath.trim()}](${WIKI_LINK_PREFIX}${encodeWikiPath(normalizedPath)})`;
  });
}

function rewriteWikiLinksOutsideCodeSpans(markdown: string): string {
  let index = 0;
  let result = "";
  let buffer = "";

  const flushBuffer = (): void => {
    if (!buffer) {
      return;
    }
    result += rewriteWikiLinksInText(buffer);
    buffer = "";
  };

  while (index < markdown.length) {
    if (markdown[index] !== "`") {
      buffer += markdown[index];
      index += 1;
      continue;
    }

    flushBuffer();

    let tickCount = 1;
    while (markdown[index + tickCount] === "`") {
      tickCount += 1;
    }

    const fence = "`".repeat(tickCount);
    const closingIndex = markdown.indexOf(fence, index + tickCount);
    if (closingIndex === -1) {
      result += markdown.slice(index);
      return result;
    }

    result += markdown.slice(index, closingIndex + tickCount);
    index = closingIndex + tickCount;
  }

  flushBuffer();
  return result;
}

function normalizeWikiLinksMarkdown(markdown: string): string {
  if (!markdown.includes("[[")) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const normalizedLines: string[] = [];
  const textBuffer: string[] = [];
  let activeFenceMarker: string | null = null;

  const flushTextBuffer = (): void => {
    if (textBuffer.length === 0) {
      return;
    }
    normalizedLines.push(rewriteWikiLinksOutsideCodeSpans(textBuffer.join("\n")));
    textBuffer.length = 0;
  };

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(```+|~~~+)/);

    if (activeFenceMarker) {
      normalizedLines.push(line);
      if (fenceMatch && fenceMatch[1] === activeFenceMarker) {
        activeFenceMarker = null;
      }
      continue;
    }

    if (fenceMatch) {
      flushTextBuffer();
      activeFenceMarker = fenceMatch[1];
      normalizedLines.push(line);
      continue;
    }

    textBuffer.push(line);
  }

  flushTextBuffer();
  return normalizedLines.join("\n");
}

function resolveWikiAssetPath(src: string): string | null {
  if (src.startsWith("/wiki-assets/")) {
    return src;
  }
  if (src.startsWith(`${API_BASE_URL}/wiki-assets/`)) {
    return src.slice(API_BASE_URL.length);
  }
  return null;
}

function AuthenticatedWikiImage({
  src,
  alt,
  token,
  projectId,
  docsSource
}: {
  src: string;
  alt?: string;
  token: string | null;
  projectId?: string;
  docsSource?: WikiDocsSourceView | null;
}): JSX.Element {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const assetPath = resolveWikiAssetPath(src);
  const docsPath = !assetPath && docsSource ? resolveRelativeDocsPath(docsSource.docsPath, src) : null;
  const docsImagePath = docsPath && !/\.(md|markdown)$/i.test(docsPath) ? docsPath : null;

  useEffect(() => {
    if ((!assetPath && !docsImagePath) || !token) {
      setBlobUrl(null);
      setFailed(false);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);

    void (async () => {
      try {
        const url = assetPath
          ? `${API_BASE_URL}${assetPath}`
          : projectId && docsSource && docsImagePath
            ? `${API_BASE_URL}/projects/${projectId}/repositories/${docsSource.repositoryId}/file/raw?${new URLSearchParams({
                filePath: docsImagePath,
                ref: docsSource.defaultBranch
              }).toString()}`
            : null;
        if (!url) {
          throw new Error("Failed to resolve image");
        }

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) {
          throw new Error("Failed to load image");
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setBlobUrl(objectUrl);
        }
      } catch {
        if (active) {
          setFailed(true);
        }
      }
    })();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [assetPath, docsImagePath, docsSource, projectId, token]);

  if (!assetPath && !docsImagePath) {
    return <img src={src} alt={alt ?? ""} />;
  }
  if (failed || !blobUrl) {
    return <span className="wiki-image-fallback">Image unavailable</span>;
  }
  return <img src={blobUrl} alt={alt ?? ""} />;
}

export function WikiMarkdown({
  contentMarkdown,
  links = [],
  token,
  projectId,
  docsSource,
  onNavigateWikiPath
}: {
  contentMarkdown: string;
  links?: WikiLinkView[];
  token: string | null;
  projectId?: string;
  docsSource?: WikiDocsSourceView | null;
  onNavigateWikiPath?: (path: string) => void;
}): JSX.Element {
  const renderedMarkdown = useMemo(
    () => normalizeWikiLinksMarkdown(normalizeWikiMathMarkdown(contentMarkdown)),
    [contentMarkdown]
  );
  const linkByPath = useMemo(() => new Map(links.map((link) => [link.toPath, link])), [links]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ href, children }) => {
          if (!href?.startsWith(WIKI_LINK_PREFIX)) {
            const activeDocsSource = docsSource ?? null;
            const docsPath = activeDocsSource ? resolveRelativeDocsPath(activeDocsSource.docsPath, href ?? "") : null;
            if (activeDocsSource && docsPath && /\.(md|markdown)$/i.test(docsPath) && onNavigateWikiPath) {
              const wikiPath = docsPathToWikiPath(activeDocsSource, docsPath);
              return (
                <button type="button" className="link-button" onClick={() => onNavigateWikiPath(wikiPath)}>
                  {children}
                </button>
              );
            }
            return <a href={href}>{children}</a>;
          }

          const normalizedPath = normalizeWikiPath(decodeURIComponent(href.slice(WIKI_LINK_PREFIX.length)));
          if (!normalizedPath) {
            return <span className="wiki-broken-link">{children}</span>;
          }

          const link = linkByPath.get(normalizedPath);
          if (!link?.toPageId || !link.path || !onNavigateWikiPath) {
            return <span className="wiki-broken-link">{children}</span>;
          }

          return (
            <button type="button" className="link-button" onClick={() => onNavigateWikiPath(link.path ?? normalizedPath)}>
              {children}
            </button>
          );
        },
        img: ({ src, alt }) => (
          <AuthenticatedWikiImage
            src={String(src ?? "")}
            alt={alt}
            token={token}
            projectId={projectId}
            docsSource={docsSource}
          />
        )
      }}
    >
      {renderedMarkdown}
    </ReactMarkdown>
  );
}
