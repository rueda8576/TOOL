"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { AppShell } from "./app-shell";
import { ProjectSubtitle } from "./project-subtitle";
import { API_BASE_URL, LoginResponse } from "../lib/client-api";
import { useUnsavedChangesGuard } from "../lib/use-unsaved-changes-guard";
import {
  createWikiPage,
  DraftConflictPayload,
  getWikiPageByPath,
  listWikiRevisions,
  listWikiTree,
  publishWikiPage,
  saveWikiDraft,
  searchWikiPages,
  uploadWikiAsset,
  WikiDraftConflictError,
  WikiPageDetail,
  WikiRevisionSummary,
  WikiSearchResult,
  WikiTreeNode
} from "../lib/wiki";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

const WIKI_PATH_SEGMENT_PATTERN = /^[a-z0-9-]+$/;
const INDENT_SIZE = 2;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef<HTMLTextAreaElement>(null);
  const lastSavedSnapshotRef = useRef<{ title: string; content: string } | null>(null);
  const draftVersionRef = useRef<number | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
  const [treeNodes, setTreeNodes] = useState<WikiTreeNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [treeQuery, setTreeQuery] = useState("");
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pageDetail, setPageDetail] = useState<WikiPageDetail | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
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
  const [uploadingImage, setUploadingImage] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<WikiSearchResult[]>([]);
  const [conflictDraft, setConflictDraft] = useState<DraftConflictPayload | null>(null);
  const [conflictLocalSnapshot, setConflictLocalSnapshot] = useState<{ title: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const initialPathNormalized = useMemo(() => normalizePath(initialPath ?? null), [initialPath]);
  const normalizedSearchQuery = useMemo(() => treeQuery.trim(), [treeQuery]);
  const searchModeActive = normalizedSearchQuery.length >= 2;
  const isReader = userRole === "reader";

  const allPagePaths = useMemo(() => flattenPagePaths(treeNodes), [treeNodes]);

  const updateDraftContent = useCallback((nextContent: string): void => {
    setDraftContent(nextContent);
    setSaveState((current) => (current === "saved" ? "idle" : current));
  }, []);

  const isDirty = useMemo(() => {
    if (!isEditing) {
      return false;
    }
    if (!lastSavedSnapshotRef.current) {
      return false;
    }
    return draftTitle !== lastSavedSnapshotRef.current.title || draftContent !== lastSavedSnapshotRef.current.content;
  }, [draftContent, draftTitle, isEditing]);
  const { requestExitProject } = useUnsavedChangesGuard({
    isDirty,
    confirmMessage: "You have unsaved wiki draft changes. Exit project anyway?"
  });

  useEffect(() => {
    draftVersionRef.current = draftVersion;
  }, [draftVersion]);

  const hydrateDraftFromDetail = useCallback((detail: WikiPageDetail): void => {
    const sourceTitle = detail.draft?.title ?? detail.page.title;
    const sourceContent = detail.draft?.contentMarkdown ?? detail.published.contentMarkdown;
    const sourceVersion = detail.draft?.draftVersion ?? 1;
    setDraftTitle(sourceTitle);
    setDraftContent(sourceContent);
    setDraftVersion(sourceVersion);
    draftVersionRef.current = sourceVersion;
    setLastSavedAt(detail.draft?.updatedAt ?? detail.published.publishedAt);
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

  const openPath = useCallback(
    (path: string, updateUrl = true): void => {
      const normalized = normalizePath(path);
      if (!normalized) {
        return;
      }
      setSelectedPath(normalized);
      setIsEditing(false);
      setHistoryOpen(false);
      setRevisions([]);
      setSuccess(null);
      setError(null);
      if (updateUrl) {
        router.push(`/projects/${projectId}/wiki/${encodeWikiPath(normalized)}`);
      }
    },
    [projectId, router]
  );

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    setUserRole(parseStoredUser(localStorage.getItem("doctoral_user"))?.globalRole ?? null);

    void (async () => {
      const nodes = await loadTree(storedToken);
      const paths = flattenPagePaths(nodes);
      const candidatePath =
        (initialPathNormalized && paths.includes(initialPathNormalized) ? initialPathNormalized : null) ??
        paths[0] ??
        null;
      setSelectedPath(candidatePath);
    })();
  }, [initialPathNormalized, loadTree, router]);

  useEffect(() => {
    if (!token || !selectedPath) {
      return;
    }
    void loadPage(token, selectedPath);
  }, [loadPage, selectedPath, token]);

  useEffect(() => {
    setHistoryOpen(false);
    setRevisions([]);
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

  const saveDraftNow = useCallback(
    async (baseVersionOverride?: number): Promise<number | null> => {
      if (!token || !pageDetail || isReader) {
        return null;
      }
      const baseVersion = baseVersionOverride ?? draftVersionRef.current;
      if (!baseVersion) {
        return null;
      }

      setSaveState("saving");
      setError(null);

      try {
        const response = await saveWikiDraft(pageDetail.page.id, token, {
          title: draftTitle,
          contentMarkdown: draftContent,
          baseDraftVersion: baseVersion
        });
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
    [draftContent, draftTitle, isReader, pageDetail, token]
  );

  useEffect(() => {
    if (!isEditing || isReader || !token || !pageDetail || !isDirty) {
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
  }, [isDirty, isEditing, isReader, pageDetail, saveDraftNow, saveState, token]);

  const onDraftBlur = (): void => {
    if (!isDirty || saveState === "saving") {
      return;
    }
    void saveDraftNow();
  };

  const onPublish = async (): Promise<void> => {
    if (!token || !pageDetail || isReader) {
      return;
    }
    setPublishing(true);
    setError(null);
    setSuccess(null);

    try {
      if (isDirty) {
        const savedVersion = await saveDraftNow();
        if (!savedVersion) {
          return;
        }
      }

      const baseVersion = draftVersionRef.current;
      if (!baseVersion) {
        setError("Draft version is missing.");
        return;
      }

      const published = await publishWikiPage(pageDetail.page.id, token, {
        baseDraftVersion: baseVersion,
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
    if (isReader) {
      setError("Reader role cannot create wiki pages.");
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
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
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

  const onToggleHistory = async (): Promise<void> => {
    if (!pageDetail || !token) {
      return;
    }
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (!nextOpen || revisions.length > 0) {
      return;
    }

    setLoadingHistory(true);
    try {
      const nextRevisions = await listWikiRevisions(pageDetail.page.id, token);
      setRevisions(nextRevisions);
    } catch (historyError) {
      setError((historyError as Error).message);
    } finally {
      setLoadingHistory(false);
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

  const renderTreeNode = (node: WikiTreeNode, depth = 0): JSX.Element => {
    if (node.type === "folder") {
      const isExpanded = expandedFolders.has(node.path);
      return (
        <li key={`folder:${node.path}`} className="wiki-tree-item">
          <button
            type="button"
            className="wiki-tree-folder"
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
          >
            <span>{isExpanded ? "▾" : "▸"}</span>
            <span>{node.name || "root"}</span>
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
          style={{ paddingLeft: `${0.8 + depth * 0.8}rem` }}
          onClick={() => openPath(node.path)}
        >
          <span className="wiki-tree-page-title">{node.title ?? node.name}</span>
          {node.hasDraftChanges ? <span className="badge">Draft</span> : null}
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
      onExitProjectRequest={requestExitProject}
    >
      <div className="wiki-layout">
        <aside className="wiki-sidebar panel">
          <div className="wiki-sidebar-toolbar">
            <h3 className="section-heading">Pages</h3>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                if (isReader) {
                  setError("Reader role cannot create wiki pages.");
                  return;
                }
                setShowCreateForm((current) => !current);
              }}
              disabled={isReader}
            >
              {showCreateForm ? "Close" : "New page"}
            </button>
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

          {loadingTree ? <p className="alert alert-info">Loading page tree...</p> : null}

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
                    <li key={`${result.pageId}-${result.path}`} className="list-item wiki-search-item">
                      <button type="button" className="link-button" onClick={() => openPath(result.path)}>
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

          {!loadingTree && !searchModeActive && treeNodes.length === 0 ? (
            <p className="alert alert-info">No wiki pages yet.</p>
          ) : null}
          {!loadingTree && !searchModeActive && treeNodes.length > 0 ? (
            <ul className="wiki-tree-list">{treeNodes.map((node) => renderTreeNode(node))}</ul>
          ) : null}
        </aside>

        <section className="wiki-main panel">
          <div className="wiki-main-header">
            <div>
              <h2 className="section-heading">{pageDetail?.page.title ?? "Wiki page"}</h2>
              {selectedPath ? <p className="wiki-page-path">/{selectedPath}</p> : null}
            </div>
            {pageDetail ? (
              <div className="inline-actions">
                {!isReader ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setIsEditing((current) => !current)}
                  >
                    {isEditing ? "Close editor" : "Edit"}
                  </button>
                ) : null}
                {pageDetail ? (
                  <button type="button" className="button button-secondary" onClick={() => void onToggleHistory()}>
                    {historyOpen ? "Hide history" : "History"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {success ? <p className="alert alert-success">{success}</p> : null}
          {error ? <p className="alert alert-error">{error}</p> : null}
          {isReader ? <p className="alert alert-info">Reader role can view published wiki pages.</p> : null}

          {!loadingPage && !pageDetail && allPagePaths.length === 0 ? (
            <p className="alert alert-info">Create your first wiki page from the left panel.</p>
          ) : null}
          {!loadingPage && !pageDetail && allPagePaths.length > 0 ? (
            <p className="alert alert-info">Select a page from the left tree to start reading or editing.</p>
          ) : null}
          {loadingPage ? <p className="alert alert-info">Loading wiki page...</p> : null}

          {pageDetail && !isEditing ? (
            <div className="wiki-read-view">
              <div className="wiki-read-meta">
                <span className="badge">Published revision #{pageDetail.published.revisionNumber}</span>
                <span>Published at {timeLabel(pageDetail.published.publishedAt)}</span>
                {pageDetail.published.changeNote ? <span>Note: {pageDetail.published.changeNote}</span> : null}
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
                  {pageDetail.published.contentMarkdown}
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
                                  openPath(link.path);
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
                          <button type="button" className="link-button" onClick={() => openPath(backlink.fromPath)}>
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

          {pageDetail && isEditing && !isReader ? (
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
                    {saveState === "saving" ? "Saving..." : "Save draft"}
                  </button>
                  <button type="button" className="button button-secondary" onClick={onUploadImageClick} disabled={uploadingImage}>
                    {uploadingImage ? "Uploading..." : "Upload image"}
                  </button>
                  <button type="button" className="button" onClick={() => void onPublish()} disabled={publishing || saveState === "saving"}>
                    {publishing ? "Publishing..." : "Publish"}
                  </button>
                </div>
                <div className="wiki-save-status">
                  <span>Status: {saveState}</span>
                  {lastSavedAt ? <span>Last saved: {timeLabel(lastSavedAt)}</span> : null}
                </div>
              </div>

              {conflictDraft ? (
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
                    setDraftTitle(event.target.value);
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
                      {draftContent}
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
            <section className="wiki-history panel">
              <h4 className="section-heading">Revision history</h4>
              {loadingHistory ? <p className="alert alert-info">Loading revisions...</p> : null}
              {!loadingHistory && revisions.length === 0 ? <p className="alert alert-info">No revisions available.</p> : null}
              {!loadingHistory && revisions.length > 0 ? (
                <ul className="list">
                  {revisions.map((revision) => (
                    <li className="list-item" key={revision.id}>
                      <strong>Revision #{revision.revisionNumber}</strong>
                      <p>Published: {timeLabel(revision.publishedAt)}</p>
                      <p>By: {revision.createdBy.name}</p>
                      {revision.changeNote ? <p>Note: {revision.changeNote}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
