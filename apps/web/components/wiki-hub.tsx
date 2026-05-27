"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { AppShell } from "./app-shell";
import { ProjectSubtitle } from "./project-subtitle";
import { LoadingState } from "./ui";
import { WikiHistoryDiff } from "./wiki-history-diff";
import { API_BASE_URL, LoginResponse } from "../lib/client-api";
import {
  buildCollaboratorIdentity,
  CollaboratorPresence,
  listCollaboratorsFromAwareness,
  resolveCollaborationServerUrl
} from "../lib/documents-collaboration";
import { useUnsavedChangesGuard } from "../lib/use-unsaved-changes-guard";
import {
  createWikiPage,
  deleteWikiPage,
  DraftConflictPayload,
  flushWikiRealtimeDraft,
  ImportWikiPagesResult,
  importWikiPages,
  getWikiRevision,
  getWikiPageByPath,
  listWikiRevisions,
  listWikiTree,
  normalizeWikiMathMarkdown,
  publishWikiPage,
  saveWikiDraft,
  searchWikiPages,
  uploadWikiAsset,
  WikiDraftConflictError,
  WikiPageDetail,
  WikiRevisionView,
  WikiRevisionSummary,
  WikiSearchResult,
  WikiTreeNode
} from "../lib/wiki";
import { getProjectAccess, ProjectAccess } from "../lib/project-access";
import { useConfirmDialog } from "../lib/use-confirm-dialog";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type WikiSidebarWidthMode = "auto" | "manual";

type WikiImportDraftEntry = {
  id: string;
  sourcePath: string;
  title: string;
  slug: string;
  folderPath: string;
  templateType: string;
  contentMarkdown: string;
  localConflict: boolean;
  warnings: string[];
};

type WikiImportSelectionResult = {
  entries: WikiImportDraftEntry[];
  assetFilesByPath: Map<string, File>;
  warnings: string[];
};

const WIKI_PATH_SEGMENT_PATTERN = /^[a-z0-9-]+$/;
const INDENT_SIZE = 2;
const WIKI_REALTIME_TITLE_KEY = "title";
const WIKI_REALTIME_CONTENT_KEY = "content";
const WIKI_REALTIME_AUTOSAVE_MARK_MS = 3250;
const WIKI_FLASH_SUCCESS_KEY = "atlasium_wiki_flash_success";
const WIKI_SIDEBAR_WIDTH_STORAGE_KEY = "atlasium_wiki_sidebar_width_px";
const WIKI_SIDEBAR_MODE_STORAGE_KEY = "atlasium_wiki_sidebar_width_mode";
const WIKI_SPLITTER_SIZE_PX = 10;
const WIKI_SPLITTER_KEYBOARD_STEP_PX = 24;
const WIKI_SPLIT_MIN_VIEWPORT_PX = 1200;
const WIKI_SIDEBAR_MIN_PX = 260;
const WIKI_SIDEBAR_MAX_PX = 520;
const WIKI_MAIN_MIN_PX = 520;
const WIKI_SIDEBAR_AUTO_FALLBACK_PX = 320;
const WIKI_IMPORT_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);

type TextTransformResult = {
  nextValue: string;
  nextSelectionStart: number;
  nextSelectionEnd: number;
};

type WikiMarkdownAction =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "link"
  | "inlineCode"
  | "codeBlock"
  | "quote"
  | "bullets"
  | "numbered"
  | "checklist"
  | "horizontalRule"
  | "indent"
  | "outdent";

type WikiMarkdownTool = {
  action: WikiMarkdownAction;
  label: string;
  title: string;
};

type ListMarkerInfo = {
  indent: string;
  marker: string;
  content: string;
};

const WIKI_MARKDOWN_TOOL_GROUPS: WikiMarkdownTool[][] = [
  [
    { action: "heading1", label: "H1", title: "Heading 1" },
    { action: "heading2", label: "H2", title: "Heading 2" },
    { action: "heading3", label: "H3", title: "Heading 3" }
  ],
  [
    { action: "bold", label: "B", title: "Bold (Ctrl/Cmd+B)" },
    { action: "italic", label: "I", title: "Italic (Ctrl/Cmd+I)" },
    { action: "link", label: "Link", title: "Link (Ctrl/Cmd+K)" },
    { action: "inlineCode", label: "Code", title: "Inline code" },
    { action: "codeBlock", label: "Block", title: "Code block" }
  ],
  [
    { action: "quote", label: "Quote", title: "Block quote" },
    { action: "bullets", label: "- List", title: "Bulleted list (Ctrl/Cmd+Shift+8)" },
    { action: "numbered", label: "1. List", title: "Numbered list (Ctrl/Cmd+Shift+7)" },
    { action: "checklist", label: "Task", title: "Checklist" },
    { action: "horizontalRule", label: "HR", title: "Horizontal rule" },
    { action: "indent", label: ">>", title: "Indent (Tab)" },
    { action: "outdent", label: "<<", title: "Outdent (Shift+Tab)" }
  ]
];

function clampSelectionRange(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { safeStart: number; safeEnd: number } {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
  return { safeStart, safeEnd };
}

function transformSelectedLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transformLine: (line: string, index: number) => string
): TextTransformResult {
  const { safeStart, safeEnd } = clampSelectionRange(value, selectionStart, selectionEnd);
  const lineStart = value.lastIndexOf("\n", Math.max(0, safeStart - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", safeEnd);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const selectedBlock = value.slice(lineStart, lineEnd);
  const selectedLines = selectedBlock.split("\n");
  const transformedBlock = selectedLines.map((line, index) => transformLine(line, index)).join("\n");
  return {
    nextValue: `${value.slice(0, lineStart)}${transformedBlock}${value.slice(lineEnd)}`,
    nextSelectionStart: lineStart,
    nextSelectionEnd: lineStart + transformedBlock.length
  };
}

function indentLine(line: string): string {
  return `${" ".repeat(INDENT_SIZE)}${line}`;
}

function outdentLine(line: string): string {
  if (line.startsWith("\t")) {
    return line.slice(1);
  }
  if (line.startsWith("  ")) {
    return line.slice(2);
  }
  if (line.startsWith(" ")) {
    return line.slice(1);
  }
  return line;
}

function applyHeadingToLine(line: string, level: 1 | 2 | 3): string {
  const marker = `${"#".repeat(level)} `;
  const headingMatch = line.match(/^(\s{0,3})(#{1,6}\s+)?(.*)$/);
  if (!headingMatch) {
    return `${marker}${line.trimStart()}`;
  }
  const indent = headingMatch[1] ?? "";
  const content = (headingMatch[3] ?? "").trimStart();
  return `${indent}${marker}${content}`;
}

function wrapSelectionWith(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  suffix: string,
  placeholder: string
): TextTransformResult {
  const { safeStart, safeEnd } = clampSelectionRange(value, selectionStart, selectionEnd);
  const hasSelection = safeEnd > safeStart;
  const content = hasSelection ? value.slice(safeStart, safeEnd) : placeholder;
  const wrapped = `${prefix}${content}${suffix}`;
  return {
    nextValue: `${value.slice(0, safeStart)}${wrapped}${value.slice(safeEnd)}`,
    nextSelectionStart: safeStart + prefix.length,
    nextSelectionEnd: safeStart + prefix.length + content.length
  };
}

function insertLinkMarkdown(value: string, selectionStart: number, selectionEnd: number): TextTransformResult {
  const { safeStart, safeEnd } = clampSelectionRange(value, selectionStart, selectionEnd);
  const label = safeEnd > safeStart ? value.slice(safeStart, safeEnd) : "link text";
  const urlPlaceholder = "https://";
  const snippet = `[${label}](${urlPlaceholder})`;
  const urlStart = safeStart + snippet.length - 1 - urlPlaceholder.length;
  return {
    nextValue: `${value.slice(0, safeStart)}${snippet}${value.slice(safeEnd)}`,
    nextSelectionStart: urlStart,
    nextSelectionEnd: urlStart + urlPlaceholder.length
  };
}

function wrapWithCodeBlock(value: string, selectionStart: number, selectionEnd: number): TextTransformResult {
  const { safeStart, safeEnd } = clampSelectionRange(value, selectionStart, selectionEnd);
  if (safeEnd > safeStart) {
    const selected = value.slice(safeStart, safeEnd);
    const snippet = `\`\`\`\n${selected}\n\`\`\``;
    return {
      nextValue: `${value.slice(0, safeStart)}${snippet}${value.slice(safeEnd)}`,
      nextSelectionStart: safeStart + 4,
      nextSelectionEnd: safeStart + 4 + selected.length
    };
  }

  const snippet = "```\n\n```";
  const cursor = safeStart + 4;
  return {
    nextValue: `${value.slice(0, safeStart)}${snippet}${value.slice(safeEnd)}`,
    nextSelectionStart: cursor,
    nextSelectionEnd: cursor
  };
}

function insertHorizontalRule(value: string, selectionStart: number, selectionEnd: number): TextTransformResult {
  const { safeStart, safeEnd } = clampSelectionRange(value, selectionStart, selectionEnd);
  const before = value.slice(0, safeStart);
  const after = value.slice(safeEnd);
  const leading = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trailing = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const snippet = `${leading}---${trailing}`;
  const cursor = before.length + snippet.length;
  return {
    nextValue: `${before}${snippet}${after}`,
    nextSelectionStart: cursor,
    nextSelectionEnd: cursor
  };
}

function extractListMarker(line: string): ListMarkerInfo | null {
  const checklistMatch = line.match(/^(\s*)-\s\[(?: |x|X)\]\s?(.*)$/);
  if (checklistMatch) {
    return {
      indent: checklistMatch[1] ?? "",
      marker: "- [ ] ",
      content: checklistMatch[2] ?? ""
    };
  }

  const unorderedMatch = line.match(/^(\s*)([-+*])\s(.*)$/);
  if (unorderedMatch) {
    return {
      indent: unorderedMatch[1] ?? "",
      marker: `${unorderedMatch[2]} `,
      content: unorderedMatch[3] ?? ""
    };
  }

  const orderedMatch = line.match(/^(\s*)\d+\.\s(.*)$/);
  if (orderedMatch) {
    return {
      indent: orderedMatch[1] ?? "",
      marker: "1. ",
      content: orderedMatch[2] ?? ""
    };
  }

  return null;
}

function buildListContinuationOnEnter(
  value: string,
  selectionStart: number,
  selectionEnd: number
): TextTransformResult | null {
  if (selectionStart !== selectionEnd) {
    return null;
  }

  const safeCursor = Math.max(0, Math.min(selectionStart, value.length));
  const lineStart = value.lastIndexOf("\n", Math.max(0, safeCursor - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", safeCursor);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const markerInfo = extractListMarker(line);
  if (!markerInfo) {
    return null;
  }

  const hasContent = markerInfo.content.trim().length > 0;
  const nextIndent = hasContent
    ? markerInfo.indent
    : markerInfo.indent.length >= INDENT_SIZE
      ? markerInfo.indent.slice(0, markerInfo.indent.length - INDENT_SIZE)
      : "";
  const insertText = hasContent || markerInfo.indent.length >= INDENT_SIZE ? `\n${nextIndent}${markerInfo.marker}` : "\n";

  return {
    nextValue: `${value.slice(0, safeCursor)}${insertText}${value.slice(safeCursor)}`,
    nextSelectionStart: safeCursor + insertText.length,
    nextSelectionEnd: safeCursor + insertText.length
  };
}

function applyStringToYText(yText: Y.Text, nextValue: string): void {
  const currentValue = yText.toString();
  if (currentValue === nextValue) {
    return;
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(currentValue.length, nextValue.length);
  while (prefixLength < maxPrefix && currentValue[prefixLength] === nextValue[prefixLength]) {
    prefixLength += 1;
  }

  let currentSuffix = currentValue.length - 1;
  let nextSuffix = nextValue.length - 1;
  while (currentSuffix >= prefixLength && nextSuffix >= prefixLength && currentValue[currentSuffix] === nextValue[nextSuffix]) {
    currentSuffix -= 1;
    nextSuffix -= 1;
  }

  const deleteLength = currentSuffix - prefixLength + 1;
  if (deleteLength > 0) {
    yText.delete(prefixLength, deleteLength);
  }

  const insertText = nextValue.slice(prefixLength, nextSuffix + 1);
  if (insertText.length > 0) {
    yText.insert(prefixLength, insertText);
  }
}

function parseStoredUser(rawUser: string | null): LoginResponse["user"] | null {
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as LoginResponse["user"];
  } catch {
    return null;
  }
}

function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 120);
}

function normalizePath(rawPath: string | null | undefined): string | null {
  if (!rawPath) {
    return null;
  }
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

function humanizeFileName(input: string): string {
  const cleaned = input.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return cleaned ? cleaned.replace(/\s+/g, " ") : input.replace(/\.[^.]+$/, "");
}

function getImportFilePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const sourcePath = relative && relative.trim().length > 0 ? relative : file.name;
  return sourcePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function splitImportPath(path: string): { dir: string; baseName: string } {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return {
      dir: "",
      baseName: normalized
    };
  }
  return {
    dir: normalized.slice(0, lastSlash),
    baseName: normalized.slice(lastSlash + 1)
  };
}

function composeWikiPath(folderPath: string, slug: string): string {
  return folderPath ? `${folderPath}/${slug}` : slug;
}

function isMarkdownImportFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function isImageImportFile(path: string): boolean {
  const lower = path.toLowerCase();
  return [...WIKI_IMPORT_IMAGE_EXTENSIONS].some((extension) => lower.endsWith(extension));
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

function resolveImportRelativePath(fromSourcePath: string, rawTarget: string): string | null {
  if (!rawTarget.trim() || isExternalMarkdownTarget(rawTarget)) {
    return null;
  }

  let targetPath = rawTarget.trim().replace(/^<|>$/g, "");
  try {
    targetPath = decodeURIComponent(targetPath);
  } catch {
    // Keep the raw target when it is not URI-encoded.
  }
  const { dir } = splitImportPath(fromSourcePath);
  const baseSegments = dir ? dir.split("/").filter(Boolean) : [];
  const targetSegments = targetPath.replace(/\\/g, "/").split("/");
  const resolvedSegments = [...baseSegments];

  for (const segment of targetSegments) {
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

function buildImportWarningList(sourcePath: string, contentMarkdown: string, assetFilesByPath: Map<string, File>): string[] {
  const warnings = new Set<string>();

  for (const match of contentMarkdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    const rawTarget = (match[1] ?? "").trim();
    if (!rawTarget || isExternalMarkdownTarget(rawTarget)) {
      continue;
    }
    const resolvedPath = resolveImportRelativePath(sourcePath, rawTarget);
    if (!resolvedPath || !assetFilesByPath.has(resolvedPath) || !isImageImportFile(resolvedPath)) {
      warnings.add(`Image not imported: ${rawTarget}`);
    }
  }

  for (const match of contentMarkdown.matchAll(/(?<!!)\[[^\]]+]\(([^)]+)\)/g)) {
    const rawTarget = (match[1] ?? "").trim();
    if (!rawTarget || isExternalMarkdownTarget(rawTarget)) {
      continue;
    }
    const resolvedPath = resolveImportRelativePath(sourcePath, rawTarget);
    if (!resolvedPath) {
      continue;
    }
    if (!isImageImportFile(resolvedPath) && assetFilesByPath.has(resolvedPath)) {
      warnings.add(`Linked local file kept as-is: ${rawTarget}`);
    }
  }

  return [...warnings];
}

async function buildWikiImportSelection(files: File[], existingPaths: Set<string>): Promise<WikiImportSelectionResult> {
  const assetFilesByPath = new Map<string, File>();
  const markdownFiles: Array<{ file: File; sourcePath: string }> = [];

  for (const file of files) {
    const sourcePath = getImportFilePath(file);
    if (!sourcePath) {
      continue;
    }
    if (isMarkdownImportFile(sourcePath)) {
      markdownFiles.push({ file, sourcePath });
      continue;
    }
    assetFilesByPath.set(sourcePath, file);
  }

  const warnings: string[] = [];
  if (markdownFiles.length === 0) {
    return {
      entries: [],
      assetFilesByPath,
      warnings: ["No `.md` or `.markdown` files found in the selection."]
    };
  }

  const entries = await Promise.all(
    markdownFiles.map(async ({ file, sourcePath }, index) => {
      const { dir, baseName } = splitImportPath(sourcePath);
      const fileStem = baseName.replace(/\.[^.]+$/, "");
      const folderPath = normalizePath(dir) ?? "";
      const slug = slugify(fileStem);
      const path = composeWikiPath(folderPath, slug);
      const contentMarkdown = await file.text();
      const entryWarnings = buildImportWarningList(sourcePath, contentMarkdown, assetFilesByPath);
      return {
        id: `${sourcePath}-${index}`,
        sourcePath,
        title: humanizeFileName(baseName),
        slug,
        folderPath,
        templateType: "",
        contentMarkdown,
        localConflict: existingPaths.has(path),
        warnings: entryWarnings
      } satisfies WikiImportDraftEntry;
    })
  );

  const pathCounts = new Map<string, number>();
  for (const entry of entries) {
    const path = composeWikiPath(entry.folderPath, entry.slug);
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }

  const entriesWithBatchWarnings = entries.map((entry) => {
    const path = composeWikiPath(entry.folderPath, entry.slug);
    if ((pathCounts.get(path) ?? 0) > 1) {
      return {
        ...entry,
        warnings: [...entry.warnings, "Another imported entry resolves to the same wiki path."]
      };
    }
    return entry;
  });

  if (assetFilesByPath.size > 0) {
    warnings.push(`Detected ${assetFilesByPath.size} local asset file(s) available for markdown image import.`);
  }

  return {
    entries: entriesWithBatchWarnings,
    assetFilesByPath,
    warnings
  };
}

async function rewriteImportedMarkdownAssets(
  projectId: string,
  token: string,
  entry: WikiImportDraftEntry,
  assetFilesByPath: Map<string, File>,
  uploadedAssetUrls: Map<string, string>
): Promise<{ contentMarkdown: string; warnings: string[] }> {
  const warnings = new Set(entry.warnings);
  let nextMarkdown = entry.contentMarkdown;
  const replacements = new Map<string, string>();

  for (const match of entry.contentMarkdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    const rawTarget = (match[1] ?? "").trim();
    if (!rawTarget || isExternalMarkdownTarget(rawTarget) || replacements.has(rawTarget)) {
      continue;
    }

    const resolvedPath = resolveImportRelativePath(entry.sourcePath, rawTarget);
    if (!resolvedPath || !isImageImportFile(resolvedPath)) {
      continue;
    }

    const assetFile = assetFilesByPath.get(resolvedPath);
    if (!assetFile) {
      warnings.add(`Image not imported: ${rawTarget}`);
      continue;
    }

    let assetUrl = uploadedAssetUrls.get(resolvedPath);
    if (!assetUrl) {
      const uploaded = await uploadWikiAsset(projectId, token, assetFile);
      assetUrl = uploaded.url;
      uploadedAssetUrls.set(resolvedPath, assetUrl);
    }

    replacements.set(rawTarget, assetUrl);
  }

  for (const [rawTarget, assetUrl] of replacements) {
    nextMarkdown = nextMarkdown.replaceAll(`(${rawTarget})`, `(${assetUrl})`);
  }

  return {
    contentMarkdown: nextMarkdown,
    warnings: [...warnings]
  };
}

function encodeWikiPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function flattenPagePaths(nodes: WikiTreeNode[]): string[] {
  const paths: string[] = [];
  const visit = (list: WikiTreeNode[]): void => {
    for (const node of list) {
      if (node.type === "page") {
        paths.push(node.path);
      }
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return paths;
}

function collectFolderPaths(nodes: WikiTreeNode[]): string[] {
  const paths: string[] = [];
  const visit = (list: WikiTreeNode[]): void => {
    for (const node of list) {
      if (node.type === "folder" && node.path) {
        paths.push(node.path);
      }
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return paths;
}

function timeLabel(dateIso: string | null | undefined): string {
  if (!dateIso) {
    return "n/a";
  }
  return new Date(dateIso).toLocaleString();
}

function getWikiLayoutWidth(container: HTMLDivElement | null): number | null {
  if (!container) {
    return null;
  }

  const { width } = container.getBoundingClientRect();
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }

  return width;
}

function clampWikiSidebarWidth(width: number, containerWidth: number): number {
  const effectiveMax = Math.max(
    WIKI_SIDEBAR_MIN_PX,
    Math.min(WIKI_SIDEBAR_MAX_PX, containerWidth - WIKI_SPLITTER_SIZE_PX - WIKI_MAIN_MIN_PX)
  );

  return Math.min(Math.max(width, WIKI_SIDEBAR_MIN_PX), effectiveMax);
}

function measureWikiSidebarAutoWidth(sidebar: HTMLElement, containerWidth: number): number {
  const measurableNodes = Array.from(sidebar.querySelectorAll<HTMLElement>("[data-wiki-sidebar-measure]"));
  let widestContentPx = 0;

  measurableNodes.forEach((element) => {
    const item = element.closest<HTMLElement>("[data-wiki-sidebar-item]");
    const itemStyle = item ? window.getComputedStyle(item) : null;
    const gapValue = itemStyle?.gap ?? itemStyle?.columnGap ?? "0";
    const gapPx = Number.parseFloat(gapValue) || 0;
    const paddingLeftPx = Number.parseFloat(itemStyle?.paddingLeft ?? "0") || 0;
    const paddingRightPx = Number.parseFloat(itemStyle?.paddingRight ?? "0") || 0;
    const badgeWidthPx = item?.querySelector<HTMLElement>(".badge")?.scrollWidth ?? 0;

    widestContentPx = Math.max(
      widestContentPx,
      Math.ceil(element.scrollWidth + paddingLeftPx + paddingRightPx + (badgeWidthPx > 0 ? badgeWidthPx + gapPx : 0))
    );
  });

  return clampWikiSidebarWidth(Math.max(WIKI_SIDEBAR_AUTO_FALLBACK_PX, widestContentPx), containerWidth);
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

export function WikiHub({
  projectId,
  initialPath
}: {
  projectId: string;
  initialPath?: string | null;
}): JSX.Element {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirmDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFilesInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef<HTMLTextAreaElement>(null);
  const lastSavedSnapshotRef = useRef<{ title: string; content: string } | null>(null);
  const draftVersionRef = useRef<number | null>(null);
  const wikiLayoutRef = useRef<HTMLDivElement | null>(null);
  const wikiSidebarRef = useRef<HTMLElement | null>(null);
  const wikiSplitDragStartRef = useRef<{ clientX: number; sidebarWidth: number } | null>(null);
  const wikiPresenceProviderRef = useRef<WebsocketProvider | null>(null);
  const wikiPresenceDocRef = useRef<Y.Doc | null>(null);
  const wikiPageProviderRef = useRef<WebsocketProvider | null>(null);
  const wikiPageDocRef = useRef<Y.Doc | null>(null);
  const wikiRealtimeTitleRef = useRef<Y.Text | null>(null);
  const wikiRealtimeContentRef = useRef<Y.Text | null>(null);
  const wikiRealtimeAutosaveMarkerRef = useRef<number | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<LoginResponse["user"] | null>(null);
  const [projectAccess, setProjectAccess] = useState<ProjectAccess | null>(null);
  const [treeNodes, setTreeNodes] = useState<WikiTreeNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [treeQuery, setTreeQuery] = useState("");
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pageDetail, setPageDetail] = useState<WikiPageDetail | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importEntries, setImportEntries] = useState<WikiImportDraftEntry[]>([]);
  const [importAssetFilesByPath, setImportAssetFilesByPath] = useState<Map<string, File>>(new Map());
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<ImportWikiPagesResult | null>(null);
  const [importingPages, setImportingPages] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createFolderPath, setCreateFolderPath] = useState("");
  const [createTemplateType, setCreateTemplateType] = useState("");
  const [createSlugEdited, setCreateSlugEdited] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [publishNote, setPublishNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [revisions, setRevisions] = useState<WikiRevisionSummary[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [revisionPreviewById, setRevisionPreviewById] = useState<Record<string, WikiRevisionView>>({});
  const [loadingRevisionPreview, setLoadingRevisionPreview] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deletingPage, setDeletingPage] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<WikiSearchResult[]>([]);
  const [conflictDraft, setConflictDraft] = useState<DraftConflictPayload | null>(null);
  const [conflictLocalSnapshot, setConflictLocalSnapshot] = useState<{ title: string; content: string } | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([]);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const [realtimeStatusNote, setRealtimeStatusNote] = useState<string | null>(null);
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number | null>(null);
  const [sidebarWidthMode, setSidebarWidthMode] = useState<WikiSidebarWidthMode>("auto");
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);
  const [isDesktopWikiLayout, setIsDesktopWikiLayout] = useState(false);
  const [isDraggingSidebarSplitter, setIsDraggingSidebarSplitter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const initialPathNormalized = useMemo(() => normalizePath(initialPath ?? null), [initialPath]);
  const normalizedSearchQuery = useMemo(() => treeQuery.trim(), [treeQuery]);
  const searchModeActive = normalizedSearchQuery.length >= 2;
  const canWrite = projectAccess?.canWrite ?? false;
  const { collaborationServerUrl, collaborationConfigError } = useMemo(() => {
    try {
      return {
        collaborationServerUrl: resolveCollaborationServerUrl(API_BASE_URL),
        collaborationConfigError: null
      };
    } catch (collaborationError) {
      console.error("Failed to resolve wiki collaboration websocket URL.", collaborationError);
      return {
        collaborationServerUrl: null,
        collaborationConfigError: "Realtime collaboration is unavailable. Editor fallback remains active."
      };
    }
  }, []);
  const collaboratorIdentity = useMemo(() => buildCollaboratorIdentity(sessionUser), [sessionUser]);

  const allPagePaths = useMemo(() => flattenPagePaths(treeNodes), [treeNodes]);
  const existingWikiPaths = useMemo(() => new Set(allPagePaths), [allPagePaths]);
  const visibleCollaborators = useMemo(() => collaborators.slice(0, 6), [collaborators]);
  const hiddenCollaboratorsCount = useMemo(
    () => Math.max(collaborators.length - visibleCollaborators.length, 0),
    [collaborators.length, visibleCollaborators.length]
  );
  const renderedPublishedMarkdown = useMemo(
    () => normalizeWikiMathMarkdown(pageDetail?.published?.contentMarkdown ?? ""),
    [pageDetail?.published?.contentMarkdown]
  );
  const renderedUnpublishedMarkdown = useMemo(
    () => normalizeWikiMathMarkdown(pageDetail?.draft?.contentMarkdown ?? ""),
    [pageDetail?.draft?.contentMarkdown]
  );
  const renderedDraftMarkdown = useMemo(() => normalizeWikiMathMarkdown(draftContent), [draftContent]);
  const selectedRevisionIndex = useMemo(
    () => revisions.findIndex((revision) => revision.id === selectedRevisionId),
    [revisions, selectedRevisionId]
  );
  const baseRevisionSummary = useMemo(
    () => (selectedRevisionIndex >= 0 ? revisions[selectedRevisionIndex + 1] ?? null : null),
    [revisions, selectedRevisionIndex]
  );
  const selectedRevisionPreview = useMemo(
    () => (selectedRevisionId ? revisionPreviewById[selectedRevisionId] ?? null : null),
    [revisionPreviewById, selectedRevisionId]
  );
  const baseRevisionPreview = useMemo(
    () => (baseRevisionSummary ? revisionPreviewById[baseRevisionSummary.id] ?? null : null),
    [baseRevisionSummary, revisionPreviewById]
  );
  const showResizableWikiLayout = isDesktopWikiLayout && sidebarWidthPx !== null;
  const wikiLayoutStyle = useMemo(
    () =>
      showResizableWikiLayout
        ? {
            gridTemplateColumns: `${sidebarWidthPx}px ${WIKI_SPLITTER_SIZE_PX}px minmax(0, 1fr)`
          }
        : undefined,
    [showResizableWikiLayout, sidebarWidthPx]
  );

  const updateDraftContent = useCallback((nextContent: string): void => {
    if (isRealtimeActive) {
      const yContent = wikiRealtimeContentRef.current;
      if (yContent) {
        applyStringToYText(yContent, nextContent);
      }
    }
    setDraftContent(nextContent);
    setSaveState((current) => (current === "saved" ? "idle" : current));
  }, [isRealtimeActive]);

  const isDirty = useMemo(() => {
    if (!isEditing || isRealtimeActive) {
      return false;
    }
    if (!lastSavedSnapshotRef.current) {
      return false;
    }
    return draftTitle !== lastSavedSnapshotRef.current.title || draftContent !== lastSavedSnapshotRef.current.content;
  }, [draftContent, draftTitle, isEditing, isRealtimeActive]);
  const { requestShellNavigation } = useUnsavedChangesGuard({
    isDirty,
    confirmMessage: "You have unsaved wiki draft changes. Leave this page anyway?",
    confirmExit: confirm
  });

  useEffect(() => {
    draftVersionRef.current = draftVersion;
  }, [draftVersion]);

  useEffect(() => {
    const storedWidth = localStorage.getItem(WIKI_SIDEBAR_WIDTH_STORAGE_KEY);
    const storedMode = localStorage.getItem(WIKI_SIDEBAR_MODE_STORAGE_KEY);
    setSidebarWidthMode(storedMode === "manual" ? "manual" : "auto");
    if (storedWidth) {
      const parsedWidth = Number.parseInt(storedWidth, 10);
      setSidebarWidthPx(Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : WIKI_SIDEBAR_AUTO_FALLBACK_PX);
    } else {
      setSidebarWidthPx(WIKI_SIDEBAR_AUTO_FALLBACK_PX);
    }
    setSidebarPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!sidebarPreferenceLoaded || sidebarWidthPx === null) {
      return;
    }
    localStorage.setItem(WIKI_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidthPx)));
    localStorage.setItem(WIKI_SIDEBAR_MODE_STORAGE_KEY, sidebarWidthMode);
  }, [sidebarPreferenceLoaded, sidebarWidthMode, sidebarWidthPx]);

  useEffect(() => {
    const desktopMedia = window.matchMedia(`(min-width: ${WIKI_SPLIT_MIN_VIEWPORT_PX}px)`);
    const updateDesktopFlag = (): void => {
      setIsDesktopWikiLayout(desktopMedia.matches);
    };

    updateDesktopFlag();
    desktopMedia.addEventListener("change", updateDesktopFlag);
    return () => {
      desktopMedia.removeEventListener("change", updateDesktopFlag);
    };
  }, []);

  useEffect(() => {
    if (!isDesktopWikiLayout || sidebarWidthMode !== "manual") {
      return;
    }

    const syncSidebarWidth = (): void => {
      const containerWidth = getWikiLayoutWidth(wikiLayoutRef.current);
      if (!containerWidth) {
        return;
      }

      setSidebarWidthPx((current) => clampWikiSidebarWidth(current ?? 320, containerWidth));
    };

    syncSidebarWidth();
    window.addEventListener("resize", syncSidebarWidth);
    return () => {
      window.removeEventListener("resize", syncSidebarWidth);
    };
  }, [isDesktopWikiLayout, sidebarWidthMode]);

  useEffect(() => {
    if (!isDesktopWikiLayout || !sidebarPreferenceLoaded || sidebarWidthMode !== "auto") {
      return;
    }

    let frameId = 0;
    const syncSidebarWidth = (): void => {
      const sidebar = wikiSidebarRef.current;
      const containerWidth = getWikiLayoutWidth(wikiLayoutRef.current);
      if (!sidebar || !containerWidth) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        setSidebarWidthPx(measureWikiSidebarAutoWidth(sidebar, containerWidth));
      });
    };

    syncSidebarWidth();
    window.addEventListener("resize", syncSidebarWidth);
    return () => {
      window.removeEventListener("resize", syncSidebarWidth);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [expandedFolders, isDesktopWikiLayout, searchModeActive, searchResults, sidebarPreferenceLoaded, sidebarWidthMode, treeNodes]);

  const destroyWikiPageCollaboration = useCallback((): void => {
    if (wikiRealtimeAutosaveMarkerRef.current !== null) {
      window.clearTimeout(wikiRealtimeAutosaveMarkerRef.current);
      wikiRealtimeAutosaveMarkerRef.current = null;
    }

    const provider = wikiPageProviderRef.current;
    if (provider) {
      provider.awareness.setLocalState(null);
      provider.destroy();
      wikiPageProviderRef.current = null;
    }

    const doc = wikiPageDocRef.current;
    if (doc) {
      doc.destroy();
      wikiPageDocRef.current = null;
    }

    wikiRealtimeTitleRef.current = null;
    wikiRealtimeContentRef.current = null;
    setIsRealtimeConnected(false);
    setIsRealtimeActive(false);
  }, []);

  const destroyWikiPresenceCollaboration = useCallback((): void => {
    const provider = wikiPresenceProviderRef.current;
    if (provider) {
      provider.awareness.setLocalState(null);
      provider.destroy();
      wikiPresenceProviderRef.current = null;
    }

    const doc = wikiPresenceDocRef.current;
    if (doc) {
      doc.destroy();
      wikiPresenceDocRef.current = null;
    }

    setCollaborators([]);
  }, []);

  const disableRealtimeWithFallback = useCallback(
    (note: string): void => {
      destroyWikiPageCollaboration();
      destroyWikiPresenceCollaboration();
      setRealtimeStatusNote(note);
    },
    [destroyWikiPageCollaboration, destroyWikiPresenceCollaboration]
  );

  const hydrateDraftFromDetail = useCallback((detail: WikiPageDetail): void => {
    const sourceTitle = detail.draft?.title ?? detail.page.title;
    const sourceContent = detail.draft?.contentMarkdown ?? detail.published?.contentMarkdown ?? "";
    const sourceVersion = detail.draft?.draftVersion ?? 1;
    setDraftTitle(sourceTitle);
    setDraftContent(sourceContent);
    setDraftVersion(sourceVersion);
    draftVersionRef.current = sourceVersion;
    setLastSavedAt(detail.draft?.updatedAt ?? detail.published?.publishedAt ?? null);
    lastSavedSnapshotRef.current = {
      title: sourceTitle,
      content: sourceContent
    };
    setSaveState("idle");
    setConflictDraft(null);
    setConflictLocalSnapshot(null);
    setPublishNote("");
  }, []);

  const loadTree = useCallback(
    async (authToken: string): Promise<WikiTreeNode[]> => {
      setLoadingTree(true);
      try {
        const nodes = await listWikiTree(projectId, authToken);
        setTreeNodes(nodes);
        setExpandedFolders(new Set(collectFolderPaths(nodes)));
        setError(null);
        return nodes;
      } catch (treeError) {
        setError((treeError as Error).message);
        return [];
      } finally {
        setLoadingTree(false);
      }
    },
    [projectId]
  );

  const loadPage = useCallback(
    async (authToken: string, path: string): Promise<void> => {
      setLoadingPage(true);
      try {
        const detail = await getWikiPageByPath(projectId, path, authToken);
        setPageDetail(detail);
        setRevisionPreviewById(detail.published ? { [detail.published.id]: detail.published } : {});
        hydrateDraftFromDetail(detail);
        setError(null);
      } catch (pageError) {
        setPageDetail(null);
        setError((pageError as Error).message);
      } finally {
        setLoadingPage(false);
      }
    },
    [hydrateDraftFromDetail, projectId]
  );

  const loadAccess = useCallback(
    async (authToken: string): Promise<void> => {
      try {
        const access = await getProjectAccess(projectId, authToken);
        setProjectAccess(access);
      } catch (accessError) {
        setProjectAccess(null);
        setError((accessError as Error).message);
      }
    },
    [projectId]
  );

  const refreshSearchResults = useCallback(
    async (authToken: string): Promise<void> => {
      if (!searchModeActive) {
        setSearchResults([]);
        setSearchError(null);
        setSearching(false);
        return;
      }

      setSearching(true);
      setSearchError(null);
      try {
        const results = await searchWikiPages(projectId, authToken, {
          q: normalizedSearchQuery,
          limit: 20
        });
        setSearchResults(results);
      } catch (searchFailure) {
        setSearchError((searchFailure as Error).message);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [normalizedSearchQuery, projectId, searchModeActive]
  );

  const openPath = useCallback(
    async (path: string, updateUrl = true): Promise<void> => {
      const normalized = normalizePath(path);
      if (!normalized) {
        return;
      }
      const href = `/projects/${projectId}/wiki/${encodeWikiPath(normalized)}`;
      const canNavigate = await requestShellNavigation({ href, reason: "module" });
      if (!canNavigate) {
        return;
      }
      setSelectedPath(normalized);
      setIsEditing(false);
      setHistoryOpen(false);
      setRevisions([]);
      setSuccess(null);
      setError(null);
      if (updateUrl) {
        router.push(href);
      }
    },
    [projectId, requestShellNavigation, router]
  );

  useEffect(() => {
    const flashSuccess = sessionStorage.getItem(WIKI_FLASH_SUCCESS_KEY);
    if (!flashSuccess) {
      return;
    }
    sessionStorage.removeItem(WIKI_FLASH_SUCCESS_KEY);
    setSuccess(flashSuccess);
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    const storedUser = parseStoredUser(localStorage.getItem("doctoral_user"));
    setSessionUser(storedUser);
    void loadAccess(storedToken);

    void (async () => {
      const nodes = await loadTree(storedToken);
      const paths = flattenPagePaths(nodes);
      const candidatePath =
        (initialPathNormalized && paths.includes(initialPathNormalized) ? initialPathNormalized : null) ??
        paths[0] ??
        null;
      setSelectedPath(candidatePath);
    })();
  }, [initialPathNormalized, loadAccess, loadTree, router]);

  useEffect(() => {
    if (!token || !selectedPath) {
      return;
    }
    void loadPage(token, selectedPath);
  }, [loadPage, selectedPath, token]);

  useEffect(() => {
    setHistoryOpen(false);
    setRevisions([]);
    setSelectedRevisionId(null);
    setRevisionPreviewById({});
    setLoadingRevisionPreview(false);
    setHistoryError(null);
  }, [selectedPath]);

  useEffect(() => {
    if (!token) {
      return;
    }

    if (!searchModeActive) {
      setSearching(false);
      setSearchError(null);
      setSearchResults([]);
      return;
    }

    let active = true;
    setSearching(true);
    setSearchError(null);

    const timeoutId = window.setTimeout(() => {
      void searchWikiPages(projectId, token, {
        q: normalizedSearchQuery,
        limit: 20
      })
        .then((results) => {
          if (active) {
            setSearchResults(results);
          }
        })
        .catch((searchFailure) => {
          if (active) {
            setSearchError((searchFailure as Error).message);
            setSearchResults([]);
          }
        })
        .finally(() => {
          if (active) {
            setSearching(false);
          }
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [normalizedSearchQuery, projectId, searchModeActive, token]);

  const stopDraggingSidebarSplitter = useCallback((): void => {
    wikiSplitDragStartRef.current = null;
    setIsDraggingSidebarSplitter(false);
  }, []);

  useEffect(() => {
    if (!isDraggingSidebarSplitter) {
      return;
    }

    document.body.classList.add("wiki-layout-dragging");

    const onPointerUp = (): void => {
      stopDraggingSidebarSplitter();
    };

    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onPointerUp);

    return () => {
      document.body.classList.remove("wiki-layout-dragging");
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onPointerUp);
    };
  }, [isDraggingSidebarSplitter, stopDraggingSidebarSplitter]);

  useEffect(() => {
    if (!isEditing || !canWrite) {
      setRealtimeStatusNote(null);
      return;
    }
    if (collaborationConfigError) {
      disableRealtimeWithFallback(collaborationConfigError);
    }
  }, [canWrite, collaborationConfigError, disableRealtimeWithFallback, isEditing]);

  useEffect(() => {
    if (!isEditing || !pageDetail || !token || !canWrite) {
      destroyWikiPresenceCollaboration();
      return;
    }

    if (!collaborationServerUrl || !collaboratorIdentity) {
      disableRealtimeWithFallback("Realtime collaboration is unavailable. Editor fallback remains active.");
      return;
    }

    destroyWikiPresenceCollaboration();

    const presenceDoc = new Y.Doc();
    let presenceProvider: WebsocketProvider;
    try {
      presenceProvider = new WebsocketProvider(collaborationServerUrl, `wiki-presence-${pageDetail.page.id}`, presenceDoc, {
        connect: true,
        disableBc: true,
        params: {
          token,
          kind: "wiki-presence",
          wikiPageId: pageDetail.page.id
        }
      });
    } catch (connectionError) {
      console.error("Failed to initialize wiki presence provider.", connectionError);
      presenceDoc.destroy();
      disableRealtimeWithFallback("Realtime collaboration is unavailable. Editor fallback remains active.");
      return;
    }

    wikiPresenceDocRef.current = presenceDoc;
    wikiPresenceProviderRef.current = presenceProvider;

    const syncCollaborators = (): void => {
      const states = presenceProvider.awareness.getStates() as Map<number, Record<string, unknown>>;
      setCollaborators(listCollaboratorsFromAwareness(states, collaboratorIdentity.id));
    };

    const onAwarenessUpdate = (): void => {
      syncCollaborators();
    };

    const onStatus = (event: { status: "connected" | "disconnected" | "connecting" }): void => {
      if (event.status === "disconnected") {
        setCollaborators([]);
      }
    };

    presenceProvider.awareness.on("update", onAwarenessUpdate);
    presenceProvider.on("status", onStatus);
    presenceProvider.awareness.setLocalState({
      user: collaboratorIdentity,
      activePath: selectedPath,
      updatedAt: Date.now()
    });
    syncCollaborators();

    return () => {
      presenceProvider.awareness.off("update", onAwarenessUpdate);
      presenceProvider.off("status", onStatus);
      destroyWikiPresenceCollaboration();
    };
  }, [
    collaborationServerUrl,
    collaboratorIdentity,
    disableRealtimeWithFallback,
    destroyWikiPresenceCollaboration,
    isEditing,
    canWrite,
    pageDetail,
    selectedPath,
    token
  ]);

  useEffect(() => {
    const presenceProvider = wikiPresenceProviderRef.current;
    if (!presenceProvider || !collaboratorIdentity || !isEditing) {
      return;
    }
    presenceProvider.awareness.setLocalState({
      user: collaboratorIdentity,
      activePath: selectedPath,
      updatedAt: Date.now()
    });
  }, [collaboratorIdentity, isEditing, selectedPath]);

  useEffect(() => {
    if (!isEditing || !pageDetail || !token || !canWrite) {
      destroyWikiPageCollaboration();
      return;
    }

    if (!collaborationServerUrl || !collaboratorIdentity) {
      disableRealtimeWithFallback("Realtime collaboration is unavailable. Editor fallback remains active.");
      return;
    }

    destroyWikiPageCollaboration();
    const pageDoc = new Y.Doc();
    let pageProvider: WebsocketProvider;

    try {
      pageProvider = new WebsocketProvider(collaborationServerUrl, `wiki-page-${pageDetail.page.id}`, pageDoc, {
        connect: true,
        disableBc: true,
        params: {
          token,
          kind: "wiki-page",
          wikiPageId: pageDetail.page.id
        }
      });
    } catch (connectionError) {
      console.error("Failed to initialize wiki page provider.", connectionError);
      pageDoc.destroy();
      disableRealtimeWithFallback("Realtime collaboration is unavailable. Editor fallback remains active.");
      return;
    }

    wikiPageDocRef.current = pageDoc;
    wikiPageProviderRef.current = pageProvider;
    setIsRealtimeActive(true);
    setIsRealtimeConnected(false);
    const yTitle = pageDoc.getText(WIKI_REALTIME_TITLE_KEY);
    const yContent = pageDoc.getText(WIKI_REALTIME_CONTENT_KEY);
    wikiRealtimeTitleRef.current = yTitle;
    wikiRealtimeContentRef.current = yContent;

    const syncFromSharedDoc = (): void => {
      setDraftTitle(yTitle.toString());
      setDraftContent(yContent.toString());
    };

    const onSharedDocUpdate = (): void => {
      syncFromSharedDoc();
      setSaveState((current) => (current === "saved" ? "idle" : current));
    };

    const onConnectionStatus = (event: { status: "connected" | "disconnected" | "connecting" }): void => {
      if (event.status === "connected") {
        setIsRealtimeConnected(true);
        setIsRealtimeActive(true);
        setRealtimeStatusNote(null);
        return;
      }
      if (event.status === "disconnected") {
        window.setTimeout(() => {
          disableRealtimeWithFallback("Realtime collaboration is offline. Switched to local draft autosave.");
        }, 0);
        return;
      }
      setIsRealtimeConnected(false);
    };

    yTitle.observe(onSharedDocUpdate);
    yContent.observe(onSharedDocUpdate);
    pageProvider.on("status", onConnectionStatus);
    pageProvider.awareness.setLocalState({
      user: collaboratorIdentity,
      activePath: selectedPath,
      updatedAt: Date.now()
    });

    return () => {
      yTitle.unobserve(onSharedDocUpdate);
      yContent.unobserve(onSharedDocUpdate);
      pageProvider.off("status", onConnectionStatus);
      destroyWikiPageCollaboration();
    };
  }, [
    collaborationServerUrl,
    collaboratorIdentity,
    disableRealtimeWithFallback,
    destroyWikiPageCollaboration,
    isEditing,
    canWrite,
    pageDetail,
    selectedPath,
    token
  ]);

  useEffect(() => {
    const pageProvider = wikiPageProviderRef.current;
    if (!pageProvider || !collaboratorIdentity || !isEditing) {
      return;
    }
    pageProvider.awareness.setLocalState({
      user: collaboratorIdentity,
      activePath: selectedPath,
      updatedAt: Date.now()
    });
  }, [collaboratorIdentity, isEditing, selectedPath]);

  useEffect(() => {
    if (!isEditing || !isRealtimeActive || !canWrite || saveState === "saving" || saveState === "conflict") {
      if (wikiRealtimeAutosaveMarkerRef.current !== null) {
        window.clearTimeout(wikiRealtimeAutosaveMarkerRef.current);
        wikiRealtimeAutosaveMarkerRef.current = null;
      }
      return;
    }

    const snapshot = lastSavedSnapshotRef.current;
    if (snapshot && snapshot.title === draftTitle && snapshot.content === draftContent) {
      return;
    }

    setSaveState((current) => (current === "saved" ? "idle" : current));
    if (wikiRealtimeAutosaveMarkerRef.current !== null) {
      window.clearTimeout(wikiRealtimeAutosaveMarkerRef.current);
    }
    wikiRealtimeAutosaveMarkerRef.current = window.setTimeout(() => {
      lastSavedSnapshotRef.current = {
        title: draftTitle,
        content: draftContent
      };
      setSaveState("saved");
      setLastSavedAt(new Date().toISOString());
      wikiRealtimeAutosaveMarkerRef.current = null;
    }, WIKI_REALTIME_AUTOSAVE_MARK_MS);

    return () => {
      if (wikiRealtimeAutosaveMarkerRef.current !== null) {
        window.clearTimeout(wikiRealtimeAutosaveMarkerRef.current);
        wikiRealtimeAutosaveMarkerRef.current = null;
      }
    };
  }, [canWrite, draftContent, draftTitle, isEditing, isRealtimeActive, saveState]);

  useEffect(
    () => () => {
      destroyWikiPageCollaboration();
      destroyWikiPresenceCollaboration();
    },
    [destroyWikiPageCollaboration, destroyWikiPresenceCollaboration]
  );

  const saveDraftNow = useCallback(
    async (baseVersionOverride?: number): Promise<number | null> => {
      if (!token || !pageDetail || !canWrite) {
        return null;
      }

      setSaveState("saving");
      setError(null);

      try {
        const response = isRealtimeActive
          ? await flushWikiRealtimeDraft(pageDetail.page.id, token)
          : await (() => {
              const baseVersion = baseVersionOverride ?? draftVersionRef.current;
              if (!baseVersion) {
                throw new Error("Draft version is missing.");
              }
              return saveWikiDraft(pageDetail.page.id, token, {
                title: draftTitle,
                contentMarkdown: draftContent,
                baseDraftVersion: baseVersion
              });
            })();

        setDraftVersion(response.draftVersion);
        draftVersionRef.current = response.draftVersion;
        lastSavedSnapshotRef.current = {
          title: draftTitle,
          content: draftContent
        };
        setSaveState("saved");
        setLastSavedAt(response.updatedAt);
        setConflictDraft(null);
        setConflictLocalSnapshot(null);
        return response.draftVersion;
      } catch (saveError) {
        if (saveError instanceof WikiDraftConflictError) {
          setSaveState("conflict");
          setConflictDraft(saveError.currentDraft);
          setConflictLocalSnapshot({
            title: draftTitle,
            content: draftContent
          });
          setError("Draft conflict detected. Reload server draft or retry with your local content.");
          return null;
        }
        setSaveState("error");
        setError((saveError as Error).message);
        return null;
      }
    },
    [canWrite, draftContent, draftTitle, isRealtimeActive, pageDetail, token]
  );

  useEffect(() => {
    if (!isEditing || !canWrite || !token || !pageDetail || isRealtimeActive || !isDirty) {
      return;
    }
    if (saveState === "saving" || saveState === "conflict") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveDraftNow();
    }, 1500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canWrite, isDirty, isEditing, isRealtimeActive, pageDetail, saveDraftNow, saveState, token]);

  const onDraftBlur = (): void => {
    if (isRealtimeActive || !isDirty || saveState === "saving") {
      return;
    }
    void saveDraftNow();
  };

  const onPublish = async (): Promise<void> => {
    if (!token || !pageDetail || !canWrite) {
      return;
    }
    setPublishing(true);
    setError(null);
    setSuccess(null);

    try {
      let publishBaseVersion = draftVersionRef.current;

      if (isRealtimeActive) {
        const flushedVersion = await saveDraftNow();
        if (!flushedVersion) {
          return;
        }
        publishBaseVersion = flushedVersion;
      } else if (isDirty) {
        const savedVersion = await saveDraftNow();
        if (!savedVersion) {
          return;
        }
        publishBaseVersion = savedVersion;
      }

      if (!publishBaseVersion) {
        setError("Draft version is missing.");
        return;
      }

      const published = await publishWikiPage(pageDetail.page.id, token, {
        baseDraftVersion: publishBaseVersion,
        changeNote: publishNote.trim() || undefined
      });

      setSuccess(`Published revision #${published.revisionNumber}.`);
      setDraftVersion(published.draftVersion);
      draftVersionRef.current = published.draftVersion;
      setIsEditing(false);
      setHistoryOpen(false);
      await loadTree(token);
      if (selectedPath) {
        await loadPage(token, selectedPath);
      }
    } catch (publishError) {
      if (publishError instanceof WikiDraftConflictError) {
        setSaveState("conflict");
        setConflictDraft(publishError.currentDraft);
        setConflictLocalSnapshot({
          title: draftTitle,
          content: draftContent
        });
        setError("Publish blocked by draft conflict. Sync draft and retry.");
      } else {
        setError((publishError as Error).message);
      }
    } finally {
      setPublishing(false);
    }
  };

  const onCreatePage = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }
    if (!canWrite) {
      setError("You do not have write access to this project.");
      return;
    }

    const normalizedSlug = slugify(createSlug || createTitle);
    const trimmedTitle = createTitle.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!normalizedSlug) {
      setError("Slug is required and must be URL-safe.");
      return;
    }
    const normalizedFolder = normalizePath(createFolderPath) ?? "";

    setCreatingPage(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await createWikiPage(projectId, token, {
        title: trimmedTitle,
        slug: normalizedSlug,
        folderPath: normalizedFolder || undefined,
        templateType: createTemplateType.trim() || undefined,
        contentMarkdown: `# ${trimmedTitle}\n\n`
      });

      setShowCreateForm(false);
      setCreateTitle("");
      setCreateSlug("");
      setCreateFolderPath("");
      setCreateTemplateType("");
      setCreateSlugEdited(false);

      await loadTree(token);
      setSelectedPath(response.path);
      router.push(`/projects/${projectId}/wiki/${encodeWikiPath(response.path)}`);
      await loadPage(token, response.path);
      setSuccess("Wiki page created.");
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreatingPage(false);
    }
  };

  const resetImportState = useCallback((): void => {
    setImportEntries([]);
    setImportAssetFilesByPath(new Map());
    setImportWarnings([]);
  }, []);

  const onImportSelectionChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      event.target.value = "";
      if (files.length === 0) {
        return;
      }

      setError(null);
      setSuccess(null);
      setImportSummary(null);

      try {
        const selection = await buildWikiImportSelection(files, existingWikiPaths);
        setImportEntries(selection.entries);
        setImportAssetFilesByPath(selection.assetFilesByPath);
        setImportWarnings(selection.warnings);
        setShowImportPanel(true);
        if (selection.entries.length === 0) {
          setError(selection.warnings[0] ?? "No Markdown files found for import.");
        }
      } catch (importSelectionError) {
        setError((importSelectionError as Error).message);
      }
    },
    [existingWikiPaths]
  );

  const onImportEntryFieldChange = useCallback(
    (entryId: string, field: "title" | "slug" | "folderPath" | "templateType", value: string): void => {
      setImportEntries((current) =>
        current.map((entry) => {
          if (entry.id !== entryId) {
            return entry;
          }

          const nextEntry = {
            ...entry,
            [field]: value
          };
          const normalizedFolder = normalizePath(nextEntry.folderPath) ?? "";
          const nextPath = composeWikiPath(normalizedFolder, slugify(nextEntry.slug) || nextEntry.slug);
          return {
            ...nextEntry,
            folderPath: normalizedFolder,
            localConflict: existingWikiPaths.has(nextPath)
          };
        })
      );
    },
    [existingWikiPaths]
  );

  const onRunImport = useCallback(async (): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }
    if (!canWrite) {
      setError("You do not have write access to this project.");
      return;
    }
    if (importEntries.length === 0) {
      setError("Select Markdown files before importing.");
      return;
    }

    setImportingPages(true);
    setError(null);
    setSuccess(null);
    setImportSummary(null);

    try {
      const uploadedAssetUrls = new Map<string, string>();
      const payloadEntries = [];
      const warningSet = new Set(importWarnings);

      for (const entry of importEntries) {
        const normalizedSlug = slugify(entry.slug);
        const normalizedFolder = normalizePath(entry.folderPath) ?? "";
        if (!entry.title.trim()) {
          throw new Error(`Missing title for ${entry.sourcePath}.`);
        }
        if (!normalizedSlug) {
          throw new Error(`Invalid slug for ${entry.sourcePath}.`);
        }

        const rewritten = await rewriteImportedMarkdownAssets(
          projectId,
          token,
          {
            ...entry,
            slug: normalizedSlug,
            folderPath: normalizedFolder
          },
          importAssetFilesByPath,
          uploadedAssetUrls
        );

        for (const warning of rewritten.warnings) {
          warningSet.add(`${entry.sourcePath}: ${warning}`);
        }

        payloadEntries.push({
          title: entry.title.trim(),
          slug: normalizedSlug,
          folderPath: normalizedFolder || undefined,
          templateType: entry.templateType.trim() || undefined,
          contentMarkdown: rewritten.contentMarkdown,
          sourcePath: entry.sourcePath
        });
      }

      const result = await importWikiPages(projectId, token, {
        entries: payloadEntries
      });

      setImportSummary(result);
      setImportWarnings([...warningSet]);
      await loadTree(token);
      await refreshSearchResults(token);

      const firstCreatedPath = result.created[0]?.path ?? null;
      if (firstCreatedPath) {
        setSelectedPath(firstCreatedPath);
        router.push(`/projects/${projectId}/wiki/${encodeWikiPath(firstCreatedPath)}`);
        await loadPage(token, firstCreatedPath);
      }

      setSuccess(`Imported ${result.created.length} page(s); skipped ${result.skipped.length}.`);
      if (result.created.length > 0) {
        resetImportState();
      }
    } catch (importError) {
      setError((importError as Error).message);
    } finally {
      setImportingPages(false);
    }
  }, [
    canWrite,
    importAssetFilesByPath,
    importEntries,
    importWarnings,
    loadPage,
    loadTree,
    projectId,
    refreshSearchResults,
    resetImportState,
    router,
    token
  ]);

  const onDeletePage = async (): Promise<void> => {
    if (!token || !pageDetail || !canWrite) {
      return;
    }

    const targetPage = pageDetail.page;
    const confirmed = await confirm({
      title: "Delete wiki page",
      message: `Delete wiki page "/${targetPage.path}"?`,
      confirmLabel: "Delete page",
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    setDeletingPage(true);
    setError(null);
    setSuccess(null);

    try {
      await deleteWikiPage(targetPage.id, token);
      destroyWikiPageCollaboration();
      destroyWikiPresenceCollaboration();
      setIsEditing(false);
      setHistoryOpen(false);
      setRevisions([]);
      setSelectedRevisionId(null);
      setRevisionPreviewById({});
      setLoadingRevisionPreview(false);
      setHistoryError(null);
      setPageDetail(null);
      setSelectedPath(null);
      setDraftTitle("");
      setDraftContent("");
      setDraftVersion(null);
      draftVersionRef.current = null;
      setLastSavedAt(null);
      lastSavedSnapshotRef.current = null;
      setConflictDraft(null);
      setConflictLocalSnapshot(null);
      setPublishNote("");
      await loadTree(token);
      await refreshSearchResults(token);
      sessionStorage.setItem(WIKI_FLASH_SUCCESS_KEY, `Deleted wiki page "/${targetPage.path}".`);
      router.push(`/projects/${projectId}/wiki`);
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setDeletingPage(false);
    }
  };

  const onUploadImageClick = (): void => {
    fileInputRef.current?.click();
  };

  const applyMarkdownTransform = useCallback(
    (transformed: TextTransformResult): void => {
      updateDraftContent(transformed.nextValue);
      requestAnimationFrame(() => {
        const textarea = markdownRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(transformed.nextSelectionStart, transformed.nextSelectionEnd);
      });
    },
    [updateDraftContent]
  );

  const applyWikiMarkdownAction = useCallback(
    (action: WikiMarkdownAction): void => {
      const textarea = markdownRef.current;
      const selectionStart = textarea?.selectionStart ?? draftContent.length;
      const selectionEnd = textarea?.selectionEnd ?? draftContent.length;

      let transformed: TextTransformResult;
      switch (action) {
        case "heading1":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => applyHeadingToLine(line, 1));
          break;
        case "heading2":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => applyHeadingToLine(line, 2));
          break;
        case "heading3":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => applyHeadingToLine(line, 3));
          break;
        case "bold":
          transformed = wrapSelectionWith(draftContent, selectionStart, selectionEnd, "**", "**", "bold text");
          break;
        case "italic":
          transformed = wrapSelectionWith(draftContent, selectionStart, selectionEnd, "*", "*", "italic text");
          break;
        case "link":
          transformed = insertLinkMarkdown(draftContent, selectionStart, selectionEnd);
          break;
        case "inlineCode":
          transformed = wrapSelectionWith(draftContent, selectionStart, selectionEnd, "`", "`", "code");
          break;
        case "codeBlock":
          transformed = wrapWithCodeBlock(draftContent, selectionStart, selectionEnd);
          break;
        case "quote":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => `> ${line}`);
          break;
        case "bullets":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => `- ${line}`);
          break;
        case "numbered":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line, index) => `${index + 1}. ${line}`);
          break;
        case "checklist":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => `- [ ] ${line}`);
          break;
        case "horizontalRule":
          transformed = insertHorizontalRule(draftContent, selectionStart, selectionEnd);
          break;
        case "indent":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => indentLine(line));
          break;
        case "outdent":
          transformed = transformSelectedLines(draftContent, selectionStart, selectionEnd, (line) => outdentLine(line));
          break;
      }

      applyMarkdownTransform(transformed);
    },
    [applyMarkdownTransform, draftContent]
  );

  const onMarkdownKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.nativeEvent.isComposing) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        applyWikiMarkdownAction(event.shiftKey ? "outdent" : "indent");
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const lowerKey = event.key.toLowerCase();
        if (!event.shiftKey && lowerKey === "b") {
          event.preventDefault();
          applyWikiMarkdownAction("bold");
          return;
        }
        if (!event.shiftKey && lowerKey === "i") {
          event.preventDefault();
          applyWikiMarkdownAction("italic");
          return;
        }
        if (!event.shiftKey && lowerKey === "k") {
          event.preventDefault();
          applyWikiMarkdownAction("link");
          return;
        }
        if (event.shiftKey && event.code === "Digit8") {
          event.preventDefault();
          applyWikiMarkdownAction("bullets");
          return;
        }
        if (event.shiftKey && event.code === "Digit7") {
          event.preventDefault();
          applyWikiMarkdownAction("numbered");
          return;
        }
      }

      if (event.key !== "Enter") {
        return;
      }

      const textarea = markdownRef.current;
      if (!textarea) {
        return;
      }
      const transformed = buildListContinuationOnEnter(draftContent, textarea.selectionStart, textarea.selectionEnd);
      if (!transformed) {
        return;
      }
      event.preventDefault();
      applyMarkdownTransform(transformed);
    },
    [applyMarkdownTransform, applyWikiMarkdownAction, draftContent]
  );

  const insertImageMarkdown = useCallback(
    (snippet: string): void => {
      const textarea = markdownRef.current;
      if (!textarea) {
        updateDraftContent(`${draftContent.trimEnd()}\n\n${snippet}\n`);
        return;
      }

      const start = textarea.selectionStart ?? draftContent.length;
      const end = textarea.selectionEnd ?? draftContent.length;
      applyMarkdownTransform({
        nextValue: `${draftContent.slice(0, start)}${snippet}${draftContent.slice(end)}`,
        nextSelectionStart: start + snippet.length,
        nextSelectionEnd: start + snippet.length
      });
    },
    [applyMarkdownTransform, draftContent, updateDraftContent]
  );

  const renderMarkdownToolbar = useCallback(
    (): JSX.Element => (
      <div className="wiki-markdown-toolbar" role="toolbar" aria-label="Markdown formatting toolbar">
        {WIKI_MARKDOWN_TOOL_GROUPS.map((group, groupIndex) => (
          <div className="wiki-markdown-toolbar-group" key={`wiki-markdown-group-${groupIndex}`}>
            {group.map((tool) => (
              <button
                key={tool.action}
                type="button"
                className="wiki-markdown-tool"
                title={tool.title}
                aria-label={tool.title}
                onClick={() => applyWikiMarkdownAction(tool.action)}
              >
                {tool.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    ),
    [applyWikiMarkdownAction]
  );

  const onImageFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file || !token) {
      return;
    }
    event.target.value = "";

    setUploadingImage(true);
    setError(null);
    try {
      const uploaded = await uploadWikiAsset(projectId, token, file);
      const safeAlt = file.name.replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim() || "image";
      const snippet = `![${safeAlt}](${uploaded.url})`;
      insertImageMarkdown(snippet);
      setSuccess("Image uploaded and inserted into markdown.");
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingImage(false);
    }
  };

  const ensureRevisionPreview = useCallback(
    async (pageId: string, revisionId: string, authToken: string): Promise<void> => {
      if (revisionPreviewById[revisionId]) {
        return;
      }

      if (pageDetail?.published?.id === revisionId) {
        setRevisionPreviewById((current) =>
          current[revisionId]
            ? current
            : {
                ...current,
                [revisionId]: pageDetail.published as WikiRevisionView
              }
        );
        return;
      }

      setLoadingRevisionPreview(true);
      setHistoryError(null);
      try {
        const revision = await getWikiRevision(pageId, revisionId, authToken);
        setRevisionPreviewById((current) => ({
          ...current,
          [revisionId]: revision
        }));
      } catch (previewError) {
        setHistoryError((previewError as Error).message);
      } finally {
        setLoadingRevisionPreview(false);
      }
    },
    [pageDetail?.published, revisionPreviewById]
  );

  useEffect(() => {
    if (!historyOpen || !pageDetail || !token || !selectedRevisionId) {
      return;
    }

    void ensureRevisionPreview(pageDetail.page.id, selectedRevisionId, token);
    if (baseRevisionSummary) {
      void ensureRevisionPreview(pageDetail.page.id, baseRevisionSummary.id, token);
    }
  }, [baseRevisionSummary, ensureRevisionPreview, historyOpen, pageDetail, selectedRevisionId, token]);

  const onToggleHistory = async (): Promise<void> => {
    if (!pageDetail || !token) {
      return;
    }
    if (!pageDetail.published) {
      setHistoryOpen(false);
      setHistoryError("This page has not been published yet.");
      return;
    }
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    setHistoryError(null);
    if (!nextOpen) {
      return;
    }

    let nextRevisions = revisions;
    if (revisions.length === 0) {
      setLoadingHistory(true);
      try {
        nextRevisions = await listWikiRevisions(pageDetail.page.id, token);
        setRevisions(nextRevisions);
      } catch (nextHistoryError) {
        setHistoryError((nextHistoryError as Error).message);
        setLoadingHistory(false);
        return;
      } finally {
        setLoadingHistory(false);
      }
    }

    const defaultRevisionId = selectedRevisionId ?? nextRevisions[0]?.id ?? null;
    setSelectedRevisionId(defaultRevisionId);
    if (defaultRevisionId) {
      void ensureRevisionPreview(pageDetail.page.id, defaultRevisionId, token);
    }
  };

  const onReloadConflictDraft = (): void => {
    if (!conflictDraft) {
      return;
    }
    setDraftTitle(conflictDraft.title);
    setDraftContent(conflictDraft.contentMarkdown);
    setDraftVersion(conflictDraft.draftVersion);
    draftVersionRef.current = conflictDraft.draftVersion;
    lastSavedSnapshotRef.current = {
      title: conflictDraft.title,
      content: conflictDraft.contentMarkdown
    };
    setSaveState("idle");
    setConflictDraft(null);
    setConflictLocalSnapshot(null);
    setError(null);
    setSuccess("Loaded latest shared draft.");
  };

  const onCopyLocalConflict = async (): Promise<void> => {
    if (!conflictLocalSnapshot) {
      return;
    }
    try {
      await navigator.clipboard.writeText(conflictLocalSnapshot.content);
      setSuccess("Local draft copied to clipboard.");
    } catch {
      setError("Unable to copy local draft to clipboard.");
    }
  };

  const onRetryConflict = async (): Promise<void> => {
    if (!conflictDraft) {
      return;
    }
    setDraftVersion(conflictDraft.draftVersion);
    draftVersionRef.current = conflictDraft.draftVersion;
    setConflictDraft(null);
    setSaveState("idle");
    const savedVersion = await saveDraftNow(conflictDraft.draftVersion);
    if (savedVersion) {
      setSuccess("Draft saved after conflict retry.");
      setError(null);
    }
  };

  const nudgeSidebarSplitter = useCallback((deltaPx: number): void => {
    const containerWidth = getWikiLayoutWidth(wikiLayoutRef.current);
    if (!containerWidth) {
      return;
    }

    setSidebarWidthMode("manual");
    setSidebarWidthPx((current) => clampWikiSidebarWidth((current ?? 320) + deltaPx, containerWidth));
  }, []);

  const onSidebarSplitterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!showResizableWikiLayout) {
        return;
      }

      event.preventDefault();
      const containerWidth = getWikiLayoutWidth(wikiLayoutRef.current);
      if (!containerWidth) {
        return;
      }

      wikiSplitDragStartRef.current = {
        clientX: event.clientX,
        sidebarWidth: clampWikiSidebarWidth(sidebarWidthPx ?? 320, containerWidth)
      };
      setIsDraggingSidebarSplitter(true);
    },
    [showResizableWikiLayout, sidebarWidthPx]
  );

  const onSidebarDragScrimPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!isDraggingSidebarSplitter) {
        return;
      }

      const dragStart = wikiSplitDragStartRef.current;
      if (!dragStart) {
        return;
      }

      const containerWidth = getWikiLayoutWidth(wikiLayoutRef.current);
      if (!containerWidth) {
        return;
      }

      const deltaPx = event.clientX - dragStart.clientX;
      setSidebarWidthMode("manual");
      setSidebarWidthPx(clampWikiSidebarWidth(dragStart.sidebarWidth + deltaPx, containerWidth));
    },
    [isDraggingSidebarSplitter]
  );

  const onSidebarDragScrimPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      stopDraggingSidebarSplitter();
    },
    [stopDraggingSidebarSplitter]
  );

  const onSidebarSplitterKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (!showResizableWikiLayout) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeSidebarSplitter(-WIKI_SPLITTER_KEYBOARD_STEP_PX);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeSidebarSplitter(WIKI_SPLITTER_KEYBOARD_STEP_PX);
      }
    },
    [nudgeSidebarSplitter, showResizableWikiLayout]
  );

  const onSidebarSplitterDoubleClick = useCallback((): void => {
    setSidebarWidthMode("auto");
  }, []);

  const renderTreeNode = (node: WikiTreeNode, depth = 0): JSX.Element => {
    if (node.type === "folder") {
      const isExpanded = expandedFolders.has(node.path);
      return (
        <li key={`folder:${node.path}`} className="wiki-tree-item">
          <button
            type="button"
            className="wiki-tree-folder"
            data-wiki-sidebar-item="folder"
            style={{ paddingLeft: `${0.6 + depth * 0.8}rem` }}
            onClick={() => {
              setExpandedFolders((current) => {
                const next = new Set(current);
                if (next.has(node.path)) {
                  next.delete(node.path);
                } else {
                  next.add(node.path);
                }
                return next;
              });
            }}
            title={node.path || node.name || "root"}
          >
            <span className="wiki-tree-row-content" data-wiki-sidebar-measure>
              <span className="wiki-tree-chevron" aria-hidden>
                {isExpanded ? "▾" : "▸"}
              </span>
              <span className="wiki-tree-folder-name">{node.name || "root"}</span>
            </span>
          </button>
          {isExpanded ? <ul className="wiki-tree-list">{node.children.map((child) => renderTreeNode(child, depth + 1))}</ul> : null}
        </li>
      );
    }

    const isActive = selectedPath === node.path;
    return (
      <li key={`page:${node.path}`} className="wiki-tree-item">
        <button
          type="button"
          className={isActive ? "wiki-tree-page wiki-tree-page-active" : "wiki-tree-page"}
          data-wiki-sidebar-item="page"
          style={{ paddingLeft: `${0.8 + depth * 0.8}rem` }}
          onClick={() => void openPath(node.path)}
          title={`/${node.path}`}
        >
          <span className="wiki-tree-row-content" data-wiki-sidebar-measure>
            <span className="wiki-tree-page-title">{node.title ?? node.name}</span>
          </span>
          {node.isUnpublished ? <span className="badge">Unpublished</span> : null}
          {!node.isUnpublished && node.hasDraftChanges ? <span className="badge">Draft</span> : null}
        </button>
      </li>
    );
  };

  const renderSearchBadges = (result: WikiSearchResult): JSX.Element => (
    <div className="wiki-search-badges">
      {result.matches.title ? <span className="badge">Title</span> : null}
      {result.matches.path ? <span className="badge">Path</span> : null}
      {result.matches.published ? <span className="badge">Published</span> : null}
      {result.matches.draft ? <span className="badge">Draft</span> : null}
    </div>
  );

  return (
    <AppShell
      title="Wiki"
      subtitle={<ProjectSubtitle projectId={projectId} suffix="Knowledge hub." />}
      projectId={projectId}
      fullWidth
      onBeforeShellNavigate={requestShellNavigation}
    >
      <div
        ref={wikiLayoutRef}
        className={[
          "wiki-layout",
          showResizableWikiLayout ? "wiki-layout-resizable" : "",
          isDraggingSidebarSplitter ? "wiki-layout-dragging" : ""
        ]
          .join(" ")
          .trim()}
        style={wikiLayoutStyle}
      >
        <aside ref={wikiSidebarRef} className="wiki-sidebar panel">
          <div className="wiki-sidebar-toolbar">
            <h3 className="section-heading">Pages</h3>
            {canWrite ? (
              <div className="inline-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setShowImportPanel(false);
                    setShowCreateForm((current) => !current);
                  }}
                >
                  {showCreateForm ? "Close" : "New page"}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setShowCreateForm(false);
                    setShowImportPanel((current) => !current);
                  }}
                >
                  {showImportPanel ? "Close import" : "Import Markdown"}
                </button>
              </div>
            ) : null}
          </div>

          <label className="wiki-search-label">
            Search
            <input
              className="input"
              value={treeQuery}
              onChange={(event) => setTreeQuery(event.target.value)}
              placeholder="Search by words in wiki content"
            />
          </label>

          {showCreateForm ? (
            <form className="wiki-create-form" onSubmit={onCreatePage}>
              <label>
                Title
                <input
                  className="input"
                  value={createTitle}
                  maxLength={300}
                  onChange={(event) => {
                    const nextTitle = event.target.value;
                    setCreateTitle(nextTitle);
                    if (!createSlugEdited) {
                      setCreateSlug(slugify(nextTitle));
                    }
                  }}
                  required
                  disabled={creatingPage}
                />
              </label>
              <label>
                Slug
                <input
                  className="input"
                  value={createSlug}
                  maxLength={120}
                  onChange={(event) => {
                    setCreateSlug(event.target.value);
                    setCreateSlugEdited(true);
                  }}
                  placeholder="page-slug"
                  required
                  disabled={creatingPage}
                />
              </label>
              <label>
                Folder path (optional)
                <input
                  className="input"
                  value={createFolderPath}
                  maxLength={300}
                  onChange={(event) => setCreateFolderPath(event.target.value)}
                  placeholder="research/methods"
                  disabled={creatingPage}
                />
              </label>
              <label>
                Template type (optional)
                <input
                  className="input"
                  value={createTemplateType}
                  maxLength={120}
                  onChange={(event) => setCreateTemplateType(event.target.value)}
                  placeholder="paper-review"
                  disabled={creatingPage}
                />
              </label>
              <div className="inline-actions">
                <button className="button" type="submit" disabled={creatingPage}>
                  {creatingPage ? "Creating..." : "Create page"}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  disabled={creatingPage}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {showImportPanel ? (
            <section className="wiki-import-panel">
              <div className="wiki-import-toolbar">
                <button type="button" className="button button-secondary" onClick={() => importFolderInputRef.current?.click()}>
                  Import folder
                </button>
                <button type="button" className="button button-secondary" onClick={() => importFilesInputRef.current?.click()}>
                  Import files
                </button>
              </div>

              <p className="wiki-import-copy">
                Batch import creates draft-only pages. Review title, slug, folder path, and optional template before creating them.
              </p>

              {importWarnings.length > 0 ? (
                <div className="alert alert-info">
                  <ul className="list">
                    {importWarnings.map((warning) => (
                      <li key={warning} className="list-item">
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importSummary ? (
                <div className="wiki-import-summary">
                  <p className="alert alert-success">
                    Created {importSummary.created.length} page(s), skipped {importSummary.skipped.length}.
                  </p>
                  {importSummary.skipped.length > 0 ? (
                    <ul className="list">
                      {importSummary.skipped.map((entry) => (
                        <li key={`${entry.sourcePath}-${entry.path}`} className="list-item">
                          <strong>{entry.sourcePath}</strong>
                          <span className="wiki-page-path">/{entry.path}</span>
                          <span>Skipped: {entry.reason}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {importEntries.length > 0 ? (
                <div className="wiki-import-review-list">
                  {importEntries.map((entry) => (
                    <article key={entry.id} className="wiki-import-entry">
                      <div className="wiki-import-entry-header">
                        <strong>{entry.sourcePath}</strong>
                        {entry.localConflict ? <span className="badge">Path exists</span> : <span className="badge">Draft only</span>}
                      </div>
                      <label>
                        Title
                        <input
                          className="input"
                          value={entry.title}
                          maxLength={300}
                          onChange={(event) => onImportEntryFieldChange(entry.id, "title", event.target.value)}
                          disabled={importingPages}
                        />
                      </label>
                      <label>
                        Slug
                        <input
                          className="input"
                          value={entry.slug}
                          maxLength={120}
                          onChange={(event) => onImportEntryFieldChange(entry.id, "slug", event.target.value)}
                          disabled={importingPages}
                        />
                      </label>
                      <label>
                        Folder path
                        <input
                          className="input"
                          value={entry.folderPath}
                          maxLength={300}
                          onChange={(event) => onImportEntryFieldChange(entry.id, "folderPath", event.target.value)}
                          placeholder="research/methods"
                          disabled={importingPages}
                        />
                      </label>
                      <label>
                        Template type
                        <input
                          className="input"
                          value={entry.templateType}
                          maxLength={120}
                          onChange={(event) => onImportEntryFieldChange(entry.id, "templateType", event.target.value)}
                          placeholder="paper-review"
                          disabled={importingPages}
                        />
                      </label>
                      <p className="wiki-page-path">/{composeWikiPath(entry.folderPath, slugify(entry.slug) || entry.slug)}</p>
                      {entry.warnings.length > 0 ? (
                        <ul className="list">
                          {entry.warnings.map((warning) => (
                            <li key={`${entry.id}-${warning}`} className="list-item">
                              {warning}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="alert alert-info">Choose a folder or a group of Markdown files to prepare the import.</p>
              )}

              <div className="inline-actions">
                <button className="button" type="button" onClick={() => void onRunImport()} disabled={importingPages || importEntries.length === 0}>
                  {importingPages ? "Importing..." : "Create draft-only pages"}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    resetImportState();
                    setImportSummary(null);
                    setShowImportPanel(false);
                  }}
                  disabled={importingPages}
                >
                  Close
                </button>
              </div>
            </section>
          ) : null}

          <input
            ref={importFilesInputRef}
            type="file"
            accept=".md,.markdown,image/*"
            className="hidden-file-input"
            multiple
            onChange={(event) => {
              void onImportSelectionChange(event);
            }}
          />
          <input
            ref={importFolderInputRef}
            type="file"
            accept=".md,.markdown,image/*"
            className="hidden-file-input"
            multiple
            {...({ webkitdirectory: "", directory: "" } as {
              webkitdirectory: string;
              directory: string;
            })}
            onChange={(event) => {
              void onImportSelectionChange(event);
            }}
          />

          {loadingTree ? <LoadingState title="Loading page tree" detail="Preparing the wiki index." /> : null}

          {!loadingTree && searchModeActive ? (
            <section className="wiki-search-results">
              <h4 className="section-heading">Search results</h4>
              {searching ? <p className="alert alert-info">Searching...</p> : null}
              {searchError ? <p className="alert alert-error">{searchError}</p> : null}
              {!searching && !searchError && searchResults.length === 0 ? (
                <p className="alert alert-info">No results for "{normalizedSearchQuery}".</p>
              ) : null}
              {!searching && !searchError && searchResults.length > 0 ? (
                <ul className="list">
                  {searchResults.map((result) => (
                    <li key={`${result.pageId}-${result.path}`} className="list-item wiki-search-item" data-wiki-sidebar-item="search-result">
                      <button type="button" className="link-button" onClick={() => void openPath(result.path)} data-wiki-sidebar-measure>
                        <strong>{result.title}</strong>
                      </button>
                      <p className="wiki-page-path">/{result.path}</p>
                      <p className="wiki-search-snippet">{result.snippet}</p>
                      {renderSearchBadges(result)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {!loadingTree && !searchModeActive && treeNodes.length === 0 ? <p className="alert alert-info">{canWrite ? "No wiki pages yet." : "No published wiki pages available yet."}</p> : null}
          {!loadingTree && !searchModeActive && treeNodes.length > 0 ? (
            <ul className="wiki-tree-list">{treeNodes.map((node) => renderTreeNode(node))}</ul>
          ) : null}
        </aside>

        {showResizableWikiLayout ? (
          <div
            className="wiki-split-handle"
            role="separator"
            aria-label="Resize wiki pages and content panels"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={onSidebarSplitterPointerDown}
            onDoubleClick={onSidebarSplitterDoubleClick}
            onKeyDown={onSidebarSplitterKeyDown}
          >
            <span className="wiki-split-line" aria-hidden />
          </div>
        ) : null}

        <section className="wiki-main panel">
          <div className="wiki-main-header">
            <div>
              <h2 className="section-heading">{pageDetail?.page.title ?? "Wiki page"}</h2>
              {selectedPath ? <p className="wiki-page-path">/{selectedPath}</p> : null}
              {pageDetail && !pageDetail.published ? <p className="wiki-page-path">Unpublished draft-only page</p> : null}
            </div>
            {pageDetail ? (
              <div className="inline-actions">
                {canWrite && !historyOpen ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setIsEditing((current) => !current)}
                    disabled={deletingPage}
                  >
                    {isEditing ? "Close editor" : "Edit"}
                  </button>
                ) : null}
                {canWrite && !historyOpen ? (
                  <button type="button" className="button button-danger" onClick={() => void onDeletePage()} disabled={deletingPage}>
                    {deletingPage ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
                {pageDetail ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void onToggleHistory()}
                    disabled={deletingPage || !pageDetail.published}
                    title={!pageDetail.published ? "History becomes available after the first publish." : undefined}
                  >
                    {historyOpen ? "Hide history" : "History"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {success ? <p className="alert alert-success">{success}</p> : null}
          {error ? <p className="alert alert-error">{error}</p> : null}
          {!loadingPage && !pageDetail && allPagePaths.length === 0 ? (
            <p className="alert alert-info">{canWrite ? "Create your first wiki page from the left panel." : "No published wiki pages available yet."}</p>
          ) : null}
          {!loadingPage && !pageDetail && allPagePaths.length > 0 ? (
            <p className="alert alert-info">{canWrite ? "Select a page from the left tree to start reading or editing." : "Select a page from the left tree to start reading."}</p>
          ) : null}
          {loadingPage ? <LoadingState title="Loading wiki page" detail="Preparing content, links, and collaboration state." /> : null}

          {pageDetail && !isEditing && !historyOpen ? (
            <div className="wiki-read-view">
              <div className="wiki-read-meta">
                {pageDetail.published ? (
                  <>
                    <span className="badge">Published revision #{pageDetail.published.revisionNumber}</span>
                    <span>Published at {timeLabel(pageDetail.published.publishedAt)}</span>
                    {pageDetail.published.changeNote ? <span>Note: {pageDetail.published.changeNote}</span> : null}
                  </>
                ) : (
                  <>
                    <span className="badge">Unpublished</span>
                    {pageDetail.draft ? <span>Draft updated at {timeLabel(pageDetail.draft.updatedAt)}</span> : null}
                    {pageDetail.draft ? <span title={pageDetail.draft.updatedBy.email}>By {pageDetail.draft.updatedBy.name}</span> : null}
                  </>
                )}
              </div>
              <article className="wiki-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    img: ({ src, alt }) => (
                      <AuthenticatedWikiImage src={String(src ?? "")} alt={alt} token={token} />
                    )
                  }}
                >
                  {pageDetail.published ? renderedPublishedMarkdown : renderedUnpublishedMarkdown}
                </ReactMarkdown>
              </article>

              <div className="wiki-links-grid">
                <section className="status-card">
                  <h4>Outgoing links</h4>
                  {pageDetail.outgoingLinks.length === 0 ? (
                    <p>No internal links in this page.</p>
                  ) : (
                    <ul className="list">
                      {pageDetail.outgoingLinks.map((link) => (
                        <li key={`${link.toPath}-${link.toPageId ?? "broken"}`} className="list-item">
                          {link.toPageId && link.path ? (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => {
                                if (link.path) {
                                  void openPath(link.path);
                                }
                              }}
                            >
                              {link.title ?? link.path ?? link.toPath}
                            </button>
                          ) : (
                            <span className="wiki-broken-link">Broken link: [[{link.toPath}]]</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="status-card">
                  <h4>Backlinks</h4>
                  {pageDetail.backlinks.length === 0 ? (
                    <p>No backlinks yet.</p>
                  ) : (
                    <ul className="list">
                      {pageDetail.backlinks.map((backlink) => (
                        <li key={backlink.fromPageId} className="list-item">
                          <button type="button" className="link-button" onClick={() => void openPath(backlink.fromPath)}>
                            {backlink.fromTitle}
                          </button>
                          <p className="wiki-page-path">/{backlink.fromPath}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          ) : null}

          {pageDetail && isEditing && canWrite && !historyOpen ? (
            <div className="wiki-edit-view">
              <div className="wiki-edit-toolbar">
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      if (saveState !== "saving") {
                        void saveDraftNow();
                      }
                    }}
                    disabled={saveState === "saving"}
                  >
                    Save draft
                  </button>
                  <button type="button" className="button button-secondary" onClick={onUploadImageClick} disabled={uploadingImage}>
                    {uploadingImage ? "Uploading..." : "Upload image"}
                  </button>
                  <button type="button" className="button" onClick={() => void onPublish()} disabled={publishing || saveState === "saving"}>
                    {publishing ? "Publishing..." : "Publish"}
                  </button>
                </div>
                <div className="wiki-save-status">
                  <div className="wiki-collaborators" aria-live="polite" aria-label="Collaborators in this wiki page">
                    {visibleCollaborators.map((collaborator) => (
                      <span
                        key={`${collaborator.id}-${collaborator.clientId}`}
                        className={collaborator.isSelf ? "wiki-collaborator-pill wiki-collaborator-pill-self" : "wiki-collaborator-pill"}
                        style={{ backgroundColor: collaborator.color, borderColor: collaborator.color }}
                        title={collaborator.activePath ? `${collaborator.name} editing ${collaborator.activePath}` : `${collaborator.name} editing`}
                      >
                        {collaborator.initials}
                      </span>
                    ))}
                    {hiddenCollaboratorsCount > 0 ? (
                      <span className="wiki-collaborator-more" title={`${hiddenCollaboratorsCount} more collaborators`}>
                        +{hiddenCollaboratorsCount}
                      </span>
                    ) : null}
                    <span className={isRealtimeConnected ? "wiki-realtime-status wiki-realtime-status-live" : "wiki-realtime-status"}>
                      {isRealtimeConnected ? "Live" : isRealtimeActive ? "Connecting" : "Fallback"}
                    </span>
                    {realtimeStatusNote ? <span className="wiki-realtime-note">{realtimeStatusNote}</span> : null}
                  </div>
                  <span>Status: {saveState}</span>
                  {lastSavedAt ? <span>Last saved: {timeLabel(lastSavedAt)}</span> : null}
                </div>
              </div>

              {!isRealtimeActive && conflictDraft ? (
                <div className="alert alert-error">
                  <p>
                    Draft conflict with version {conflictDraft.draftVersion} updated by {conflictDraft.updatedBy.name}.
                  </p>
                  <div className="inline-actions">
                    <button type="button" className="button button-secondary" onClick={onReloadConflictDraft}>
                      Reload draft
                    </button>
                    <button type="button" className="button button-secondary" onClick={() => void onCopyLocalConflict()}>
                      Copy my local content
                    </button>
                    <button type="button" className="button button-secondary" onClick={() => void onRetryConflict()}>
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}

              <label>
                Title
                <input
                  className="input"
                  value={draftTitle}
                  onChange={(event) => {
                    const nextTitle = event.target.value;
                    if (isRealtimeActive) {
                      const yTitle = wikiRealtimeTitleRef.current;
                      if (yTitle) {
                        applyStringToYText(yTitle, nextTitle);
                      }
                    }
                    setDraftTitle(nextTitle);
                    setSaveState((current) => (current === "saved" ? "idle" : current));
                  }}
                  maxLength={300}
                  onBlur={onDraftBlur}
                />
              </label>

              <label>
                Change note (used on publish)
                <input
                  className="input"
                  value={publishNote}
                  onChange={(event) => setPublishNote(event.target.value)}
                  maxLength={500}
                />
              </label>

              <div className="wiki-editor-grid">
                <label>
                  Draft markdown
                  {renderMarkdownToolbar()}
                  <textarea
                    ref={markdownRef}
                    className="input wiki-editor-textarea"
                    value={draftContent}
                    onChange={(event) => {
                      updateDraftContent(event.target.value);
                    }}
                    onKeyDown={onMarkdownKeyDown}
                    onBlur={onDraftBlur}
                  />
                </label>
                <section className="wiki-preview-panel">
                  <h4>Live preview</h4>
                  <article className="wiki-markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        img: ({ src, alt }) => (
                          <AuthenticatedWikiImage src={String(src ?? "")} alt={alt} token={token} />
                        )
                      }}
                    >
                      {renderedDraftMarkdown}
                    </ReactMarkdown>
                  </article>
                </section>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="hidden-file-input"
                onChange={(event) => {
                  void onImageFileChange(event);
                }}
              />
            </div>
          ) : null}

          {historyOpen && pageDetail ? (
            <section className="wiki-history-mode">
              <div className="wiki-history-mode-header">
                <div>
                  <h4 className="section-heading">Revision history</h4>
                  <p className="wiki-page-path">Read-only line diff against the previous published revision.</p>
                </div>
                {selectedRevisionPreview ? (
                  <div className="wiki-history-preview-meta">
                    <span className="badge">Revision #{selectedRevisionPreview.revisionNumber}</span>
                    {pageDetail.published?.id === selectedRevisionPreview.id ? <span className="badge">Current</span> : null}
                    <span>{timeLabel(selectedRevisionPreview.publishedAt)}</span>
                    <span title={selectedRevisionPreview.createdBy.email}>By {selectedRevisionPreview.createdBy.name}</span>
                    {selectedRevisionPreview.changeNote ? <span>Note: {selectedRevisionPreview.changeNote}</span> : null}
                  </div>
                ) : null}
              </div>

              {loadingHistory ? <p className="alert alert-info">Loading revisions...</p> : null}
              {historyError ? <p className="alert alert-error">{historyError}</p> : null}
              {!loadingHistory && revisions.length === 0 ? <p className="alert alert-info">No revisions available.</p> : null}
              {!loadingHistory && revisions.length > 0 ? (
                <div className="wiki-history-layout">
                  <div className="wiki-history-timeline">
                    <ul className="wiki-history-list">
                      {revisions.map((revision) => {
                        const isActiveRevision = selectedRevisionId === revision.id;
                        const isCurrentRevision = pageDetail.published?.id === revision.id;
                        return (
                          <li key={revision.id}>
                            <button
                              type="button"
                              className={isActiveRevision ? "wiki-history-item wiki-history-item-active" : "wiki-history-item"}
                              onClick={() => setSelectedRevisionId(revision.id)}
                            >
                              <div className="wiki-history-item-top">
                                <strong>Revision #{revision.revisionNumber}</strong>
                                {isCurrentRevision ? <span className="badge">Current</span> : null}
                              </div>
                              <div className="wiki-history-item-meta">
                                <span>{timeLabel(revision.publishedAt)}</span>
                                <span title={revision.createdBy.email}>By {revision.createdBy.name}</span>
                                {revision.changeNote ? <span>Note: {revision.changeNote}</span> : null}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="wiki-history-preview">
                    {loadingRevisionPreview && (!selectedRevisionPreview || (baseRevisionSummary && !baseRevisionPreview)) ? (
                      <p className="alert alert-info">Loading revision diff...</p>
                    ) : null}
                    {!loadingRevisionPreview && !selectedRevisionPreview && selectedRevisionId ? (
                      <p className="alert alert-info">Select a revision to inspect its published changes.</p>
                    ) : null}
                    {selectedRevisionPreview && (!baseRevisionSummary || baseRevisionPreview) ? (
                      <>
                        <div className="wiki-history-diff-meta">
                          <span className="badge">
                            {baseRevisionSummary ? `Compared with revision #${baseRevisionSummary.revisionNumber}` : "Initial revision"}
                          </span>
                          {baseRevisionPreview ? <span>{timeLabel(baseRevisionPreview.publishedAt)}</span> : null}
                          {baseRevisionPreview ? (
                            <span title={baseRevisionPreview.createdBy.email}>Base by {baseRevisionPreview.createdBy.name}</span>
                          ) : null}
                        </div>
                        <WikiHistoryDiff
                          original={baseRevisionPreview?.contentMarkdown ?? ""}
                          modified={selectedRevisionPreview.contentMarkdown}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      </div>
      {isDraggingSidebarSplitter ? (
        <div className="wiki-drag-scrim" onPointerMove={onSidebarDragScrimPointerMove} onPointerUp={onSidebarDragScrimPointerUp} />
      ) : null}
      {confirmDialog}
    </AppShell>
  );
}
