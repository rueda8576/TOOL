"use client";

import { useEffect, useMemo, useState } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { API_BASE_URL } from "../lib/client-api";
import { normalizeWikiMathMarkdown, WikiLinkView } from "../lib/wiki";

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
  token
}: {
  src: string;
  alt?: string;
  token: string | null;
}): JSX.Element {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const assetPath = resolveWikiAssetPath(src);

  useEffect(() => {
    if (!assetPath || !token) {
      setBlobUrl(null);
      setFailed(false);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);

    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}${assetPath}`, {
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
  }, [assetPath, token]);

  if (!assetPath) {
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
  onNavigateWikiPath
}: {
  contentMarkdown: string;
  links?: WikiLinkView[];
  token: string | null;
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
        img: ({ src, alt }) => <AuthenticatedWikiImage src={String(src ?? "")} alt={alt} token={token} />
      }}
    >
      {renderedMarkdown}
    </ReactMarkdown>
  );
}
