import { BadRequestException } from "@nestjs/common";
import { createHash } from "crypto";

export const WIKI_SEGMENT_PATTERN = /^[a-z0-9-]+$/;

export function normalizeSlug(rawSlug: string): string {
  const slug = rawSlug.trim().toLowerCase();
  if (!WIKI_SEGMENT_PATTERN.test(slug)) {
    throw new BadRequestException("Invalid wiki slug");
  }
  return slug;
}

export function normalizeFolderPath(rawFolderPath?: string): string {
  if (!rawFolderPath) {
    return "";
  }

  const cleaned = rawFolderPath.trim().toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) {
    return "";
  }

  const segments = cleaned.split("/").filter(Boolean);
  for (const segment of segments) {
    if (!WIKI_SEGMENT_PATTERN.test(segment)) {
      throw new BadRequestException("Invalid wiki folder path");
    }
  }

  return segments.join("/");
}

export function normalizePath(rawPath: string): string {
  const cleaned = rawPath.trim().toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) {
    throw new BadRequestException("Wiki path is required");
  }

  const segments = cleaned.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new BadRequestException("Wiki path is required");
  }

  for (const segment of segments) {
    if (!WIKI_SEGMENT_PATTERN.test(segment)) {
      throw new BadRequestException("Invalid wiki path");
    }
  }

  return segments.join("/");
}

export function composePath(folderPath: string, slug: string): string {
  return folderPath ? `${folderPath}/${slug}` : slug;
}

export function hashMarkdownContent(contentMarkdown: string): string {
  return createHash("sha256").update(contentMarkdown, "utf8").digest("hex");
}

export function toWikiPathSegment(rawSegment: string, fallback = "page"): string {
  const normalized = rawSegment
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

export function stripMarkdownExtension(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, "");
}

export function humanizeFileStem(fileStem: string): string {
  const humanized = fileStem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return humanized || fileStem || "Untitled";
}

export function extractTitleFromMarkdown(contentMarkdown: string, docsPath: string): string {
  for (const line of contentMarkdown.split("\n")) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match?.[1]?.trim()) {
      return match[1].trim().slice(0, 300);
    }
  }

  const fileName = docsPath.split("/").pop() ?? docsPath;
  return humanizeFileStem(stripMarkdownExtension(fileName)).slice(0, 300);
}
