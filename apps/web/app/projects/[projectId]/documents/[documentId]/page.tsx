"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../../components/app-shell";
import {
  LatexMonacoEditor,
  LatexMonacoEditorHandle
} from "../../../../../components/latex-monaco-editor";
import { LoginResponse } from "../../../../../lib/client-api";
import {
  compileDocumentVersion,
  createDocumentVersionUpload,
  DocumentDetail,
  DocumentVersionSummary,
  getCompileLog,
  getLatexFile,
  getLatexTree,
  getProjectDocument,
  loadDocumentPdfBlobUrl,
  updateLatexFile
} from "../../../../../lib/documents";
import { inferMonacoDocumentLanguage } from "../../../../../lib/monaco-languages";
import { useUnsavedChangesGuard } from "../../../../../lib/use-unsaved-changes-guard";

type LatexTreeEntry = { path: string; isDirectory: boolean };
type LatexTreeNode = { name: string; path: string; isDirectory: boolean; children: LatexTreeNode[] };

const TREE_COLLAPSED_STORAGE_KEY = "documents_tree_collapsed";
const SPLIT_WIDTH_STORAGE_KEY = "documents_split_left_px";
const SPLITTER_SIZE_PX = 20;
const MIN_DOCUMENT_PANE_WIDTH_PX = 380;
const SPLITTER_KEYBOARD_STEP_PX = 24;
const DOCUMENT_SPLIT_MIN_VIEWPORT_PX = 768;
const DOCUMENT_PDF_HIGHLIGHT_EVENT = "doctoral:pdf-highlight-word";
const DOCUMENT_PDF_WORD_PICKED_EVENT = "doctoral:pdf-word-picked";
const DOCUMENT_WORD_HIGHLIGHT_DURATION_MS = 1500;

function clampLeftPaneWidth(nextWidth: number, containerWidth: number, fixedColumnsWidth: number): number {
  const availableWidth = containerWidth - fixedColumnsWidth;
  if (availableWidth <= MIN_DOCUMENT_PANE_WIDTH_PX * 2) {
    return Math.max(0, Math.round(availableWidth / 2));
  }

  const maxLeftWidth = availableWidth - MIN_DOCUMENT_PANE_WIDTH_PX;
  return Math.min(Math.max(nextWidth, MIN_DOCUMENT_PANE_WIDTH_PX), maxLeftWidth);
}

function getResizableWorkspaceMetrics(workspace: HTMLElement | null): { containerWidth: number; fixedColumnsWidth: number } | null {
  if (!workspace) {
    return null;
  }

  const containerWidth = workspace.clientWidth;
  if (containerWidth <= 0) {
    return null;
  }

  const computed = window.getComputedStyle(workspace);
  const columnGap = Number.parseFloat(computed.columnGap || computed.gap || "0");
  const resolvedGap = Number.isFinite(columnGap) ? columnGap : 0;
  const fixedColumnsWidth = SPLITTER_SIZE_PX + resolvedGap * 2;
  return { containerWidth, fixedColumnsWidth };
}

function sanitizePdfFilename(title?: string): string {
  const normalized = (title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${normalized.length > 0 ? normalized : "document"}-latest.pdf`;
}

function normalizeWordToken(rawValue: string): string {
  return rawValue.trim().replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, "");
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

function inferLatexEntryFile(latexPaths: string[]): string | undefined {
  if (latexPaths.length === 0) {
    return undefined;
  }

  const mainTexAtRoot = latexPaths.find((path) => path.toLowerCase() === "main.tex");
  if (mainTexAtRoot) {
    return mainTexAtRoot;
  }

  const mainTexNested = latexPaths.find((path) => path.toLowerCase().endsWith("/main.tex"));
  if (mainTexNested) {
    return mainTexNested;
  }

  return latexPaths.find((path) => path.toLowerCase().endsWith(".tex")) ?? undefined;
}

function buildLatexTree(entries: LatexTreeEntry[]): LatexTreeNode[] {
  const root: LatexTreeNode = { name: "", path: "", isDirectory: true, children: [] };
  const nodesByPath = new Map<string, LatexTreeNode>([["", root]]);

  const ensureDirectory = (directoryPath: string): LatexTreeNode => {
    if (!directoryPath) {
      return root;
    }

    const existing = nodesByPath.get(directoryPath);
    if (existing) {
      return existing;
    }

    const segments = directoryPath.split("/").filter(Boolean);
    const parentPath = segments.slice(0, -1).join("/");
    const parent = ensureDirectory(parentPath);
    const created: LatexTreeNode = {
      name: segments[segments.length - 1] ?? directoryPath,
      path: directoryPath,
      isDirectory: true,
      children: []
    };
    parent.children.push(created);
    nodesByPath.set(directoryPath, created);
    return created;
  };

  for (const entry of entries) {
    const normalizedPath = entry.path.split("/").filter(Boolean).join("/");
    if (!normalizedPath) {
      continue;
    }

    const segments = normalizedPath.split("/");
    const parentPath = segments.slice(0, -1).join("/");
    const parent = ensureDirectory(parentPath);
    const current = nodesByPath.get(normalizedPath);

    if (current) {
      current.isDirectory = current.isDirectory || entry.isDirectory;
      continue;
    }

    const node: LatexTreeNode = {
      name: segments[segments.length - 1] ?? normalizedPath,
      path: normalizedPath,
      isDirectory: entry.isDirectory,
      children: []
    };
    parent.children.push(node);
    nodesByPath.set(normalizedPath, node);

    if (entry.isDirectory) {
      ensureDirectory(normalizedPath);
    }
  }

  const sortNodes = (nodes: LatexTreeNode[]): LatexTreeNode[] =>
    [...nodes]
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map((node) =>
        node.isDirectory
          ? {
              ...node,
              children: sortNodes(node.children)
            }
          : node
      );

  return sortNodes(root.children);
}

function collectDirectoryPaths(entries: LatexTreeEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    if (entry.isDirectory && segments.length > 0) {
      paths.add(segments.join("/"));
    }
    for (let depth = 1; depth < segments.length; depth += 1) {
      paths.add(segments.slice(0, depth).join("/"));
    }
  }

  return [...paths].sort((left, right) => left.length - right.length || left.localeCompare(right));
}

function terminalCompileStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "timeout";
}

function compileStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Compiling";
    case "succeeded":
      return "Compiled";
    case "failed":
      return "Compile failed";
    case "timeout":
      return "Compile timeout";
    case "pending":
    default:
      return "Pending compile";
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

export default function DocumentDetailPage({
  params
}: {
  params: { projectId: string; documentId: string };
}): JSX.Element {
  const router = useRouter();
  const firstVersionFolderInputRef = useRef<HTMLInputElement>(null);
  const pdfPreviewFrameRef = useRef<HTMLIFrameElement>(null);
  const monacoEditorRef = useRef<LatexMonacoEditorHandle | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const editorPaneRef = useRef<HTMLElement>(null);
  const splitDragStartRef = useRef<{ clientX: number; leftWidth: number } | null>(null);
  const autoCompileVersionRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
  const [documentDetail, setDocumentDetail] = useState<DocumentDetail | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [latexTree, setLatexTree] = useState<LatexTreeEntry[]>([]);
  const [selectedLatexPath, setSelectedLatexPath] = useState<string>("");
  const [latexContent, setLatexContent] = useState("");
  const [savedLatexContent, setSavedLatexContent] = useState("");
  const [loadingLatexFile, setLoadingLatexFile] = useState(false);
  const [savingLatexFile, setSavingLatexFile] = useState(false);
  const [compileStatus, setCompileStatus] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState<string | null>(null);
  const [isCompileLogOpen, setIsCompileLogOpen] = useState(false);
  const [compileBusy, setCompileBusy] = useState(false);
  const [firstVersionPdfFile, setFirstVersionPdfFile] = useState<File | null>(null);
  const [firstVersionLatexFiles, setFirstVersionLatexFiles] = useState<File[]>([]);
  const [firstVersionLatexPaths, setFirstVersionLatexPaths] = useState<string[]>([]);
  const [submittingFirstVersion, setSubmittingFirstVersion] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [treePreferenceLoaded, setTreePreferenceLoaded] = useState(false);
  const [isDesktopWorkspace, setIsDesktopWorkspace] = useState(false);
  const [leftPaneWidthPx, setLeftPaneWidthPx] = useState<number | null>(null);
  const [splitPreferenceLoaded, setSplitPreferenceLoaded] = useState(false);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  const isReader = userRole === "reader";

  const updatePdfUrl = useCallback((nextUrl: string | null): void => {
    setPdfUrl((currentUrl) => {
      if (currentUrl && currentUrl !== nextUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return nextUrl;
    });
  }, []);

  const loadPdfPreview = useCallback(
    async (version: DocumentVersionSummary, authToken: string): Promise<void> => {
      if (!version.hasPdf) {
        updatePdfUrl(null);
        setPdfError(null);
        return;
      }

      setLoadingPdf(true);
      try {
        const nextUrl = await loadDocumentPdfBlobUrl(version.id, authToken);
        updatePdfUrl(nextUrl);
        setPdfError(null);
      } catch (previewError) {
        updatePdfUrl(null);
        setPdfError((previewError as Error).message);
      } finally {
        setLoadingPdf(false);
      }
    },
    [updatePdfUrl]
  );

  const loadLatexFileContent = useCallback(
    async (versionId: string, filePath: string, authToken: string): Promise<void> => {
      setLoadingLatexFile(true);
      try {
        const file = await getLatexFile(versionId, filePath, authToken);
        setSelectedLatexPath(file.path);
        setLatexContent(file.content);
        setSavedLatexContent(file.content);
        setError(null);
      } catch (fileError) {
        setError((fileError as Error).message);
      } finally {
        setLoadingLatexFile(false);
      }
    },
    []
  );

  const loadLatexWorkspace = useCallback(
    async (version: DocumentVersionSummary, authToken: string): Promise<void> => {
      if (!version.hasLatex) {
        setLatexTree([]);
        setSelectedLatexPath("");
        setLatexContent("");
        setSavedLatexContent("");
        return;
      }

      try {
        const treeResponse = await getLatexTree(version.id, authToken);
        const sortedTree = [...treeResponse.files].sort((a, b) => a.path.localeCompare(b.path));
        setLatexTree(sortedTree);

        const defaultPath = version.latexEntryFile && sortedTree.some((entry) => !entry.isDirectory && entry.path === version.latexEntryFile)
          ? version.latexEntryFile
          : sortedTree.find((entry) => !entry.isDirectory)?.path;

        if (defaultPath) {
          await loadLatexFileContent(version.id, defaultPath, authToken);
        } else {
          setSelectedLatexPath("");
          setLatexContent("");
          setSavedLatexContent("");
        }
      } catch (workspaceError) {
        setError((workspaceError as Error).message);
      }
    },
    [loadLatexFileContent]
  );

  const loadDocumentDetail = useCallback(
    async (authToken: string): Promise<void> => {
      setLoadingDocument(true);
      try {
        const detail = await getProjectDocument(params.projectId, params.documentId, authToken);
        setDocumentDetail(detail);
        setCompileStatus(detail.latestMainVersion?.compileStatus ?? null);
        setError(null);

        if (detail.latestMainVersion) {
          await loadPdfPreview(detail.latestMainVersion, authToken);
          await loadLatexWorkspace(detail.latestMainVersion, authToken);
        } else {
          updatePdfUrl(null);
          setLatexTree([]);
          setSelectedLatexPath("");
          setLatexContent("");
          setSavedLatexContent("");
          setCompileLog(null);
        }
      } catch (detailError) {
        setError((detailError as Error).message);
      } finally {
        setLoadingDocument(false);
      }
    },
    [loadLatexWorkspace, loadPdfPreview, params.documentId, params.projectId, updatePdfUrl]
  );

  const refreshDocumentAfterCompile = useCallback(
    async (authToken: string, previousVersionId: string): Promise<void> => {
      try {
        const detail = await getProjectDocument(params.projectId, params.documentId, authToken);
        setDocumentDetail(detail);
        setCompileStatus(detail.latestMainVersion?.compileStatus ?? null);

        if (!detail.latestMainVersion) {
          updatePdfUrl(null);
          setLatexTree([]);
          setSelectedLatexPath("");
          setLatexContent("");
          setSavedLatexContent("");
          setCompileLog(null);
          return;
        }

        await loadPdfPreview(detail.latestMainVersion, authToken);

        if (detail.latestMainVersion.id !== previousVersionId) {
          await loadLatexWorkspace(detail.latestMainVersion, authToken);
        }
      } catch (detailError) {
        setError((detailError as Error).message);
      }
    },
    [loadLatexWorkspace, loadPdfPreview, params.documentId, params.projectId, updatePdfUrl]
  );

  useEffect(() => {
    const folderInput = firstVersionFolderInputRef.current;
    if (!folderInput) {
      return;
    }
    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const storedValue = localStorage.getItem(TREE_COLLAPSED_STORAGE_KEY);
    if (storedValue === null) {
      const shouldCollapseByDefault = window.matchMedia("(max-width: 1199px)").matches;
      setIsTreeCollapsed(shouldCollapseByDefault);
      setTreePreferenceLoaded(true);
      return;
    }

    setIsTreeCollapsed(storedValue === "true");
    setTreePreferenceLoaded(true);
  }, []);

  useEffect(() => {
    const storedWidth = localStorage.getItem(SPLIT_WIDTH_STORAGE_KEY);
    if (storedWidth) {
      const parsedWidth = Number.parseInt(storedWidth, 10);
      if (Number.isFinite(parsedWidth) && parsedWidth > 0) {
        setLeftPaneWidthPx(parsedWidth);
      }
    }
    setSplitPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!treePreferenceLoaded) {
      return;
    }
    localStorage.setItem(TREE_COLLAPSED_STORAGE_KEY, String(isTreeCollapsed));
  }, [isTreeCollapsed, treePreferenceLoaded]);

  useEffect(() => {
    if (!splitPreferenceLoaded || leftPaneWidthPx === null) {
      return;
    }
    localStorage.setItem(SPLIT_WIDTH_STORAGE_KEY, String(Math.round(leftPaneWidthPx)));
  }, [leftPaneWidthPx, splitPreferenceLoaded]);

  useEffect(() => {
    const desktopMedia = window.matchMedia(`(min-width: ${DOCUMENT_SPLIT_MIN_VIEWPORT_PX}px)`);
    const updateDesktopFlag = (): void => {
      setIsDesktopWorkspace(desktopMedia.matches);
    };

    updateDesktopFlag();
    desktopMedia.addEventListener("change", updateDesktopFlag);
    return () => {
      desktopMedia.removeEventListener("change", updateDesktopFlag);
    };
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    setUserRole(parseStoredUser(localStorage.getItem("doctoral_user"))?.globalRole ?? null);
    void loadDocumentDetail(storedToken);
  }, [loadDocumentDetail, router]);

  useEffect(() => {
    setIsEditorOpen(false);
    autoCompileVersionRef.current = null;
  }, [params.documentId]);

  useEffect(
    () => () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    },
    [pdfUrl]
  );

  const currentVersion = documentDetail?.latestMainVersion ?? null;
  const hasLatex = Boolean(currentVersion?.hasLatex);
  const hasPdf = Boolean(currentVersion?.hasPdf);
  const hasEditableLatex = hasLatex && !isReader;
  const showLatexWorkspace = hasLatex && isEditorOpen;
  const downloadFileName = useMemo(() => sanitizePdfFilename(documentDetail?.title), [documentDetail?.title]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(latexTree), [latexTree]);
  const latexTreeNodes = useMemo(() => buildLatexTree(latexTree), [latexTree]);
  const monacoLanguage = useMemo(() => inferMonacoDocumentLanguage(selectedLatexPath), [selectedLatexPath]);
  const pdfViewerSrc = useMemo(
    () =>
      pdfUrl
        ? `/pdfjs/web/viewer.html?file=${encodeURIComponent(pdfUrl)}&filename=${encodeURIComponent(downloadFileName)}#zoom=${
            showLatexWorkspace ? "page-width" : "page-fit"
          }`
        : null,
    [downloadFileName, pdfUrl, showLatexWorkspace]
  );
  const showResizableWorkspace = isDesktopWorkspace && showLatexWorkspace && leftPaneWidthPx !== null;
  const workspaceStyle = useMemo(
    () => (showResizableWorkspace ? { gridTemplateColumns: `${leftPaneWidthPx}px ${SPLITTER_SIZE_PX}px minmax(0, 1fr)` } : undefined),
    [leftPaneWidthPx, showResizableWorkspace]
  );
  const hasUnsavedLatexChanges = useMemo(
    () =>
      showLatexWorkspace &&
      hasEditableLatex &&
      selectedLatexPath.length > 0 &&
      latexContent !== savedLatexContent,
    [hasEditableLatex, latexContent, savedLatexContent, selectedLatexPath, showLatexWorkspace]
  );
  const { requestExitProject } = useUnsavedChangesGuard({
    isDirty: hasUnsavedLatexChanges,
    confirmMessage: "You have unsaved LaTeX changes. Exit project anyway?"
  });

  useEffect(() => {
    if ((compileStatus === "failed" || compileStatus === "timeout") && compileLog) {
      setIsCompileLogOpen(true);
    }
  }, [compileLog, compileStatus]);

  useEffect(() => {
    if (!isDesktopWorkspace || !showLatexWorkspace) {
      return;
    }

    const syncSplitWidth = (): void => {
      const metrics = getResizableWorkspaceMetrics(workspaceRef.current);
      if (!metrics) {
        return;
      }

      setLeftPaneWidthPx((current) => {
        const baseWidth = current ?? Math.round((metrics.containerWidth - metrics.fixedColumnsWidth) / 2);
        return clampLeftPaneWidth(baseWidth, metrics.containerWidth, metrics.fixedColumnsWidth);
      });
    };

    syncSplitWidth();
    window.addEventListener("resize", syncSplitWidth);
    return () => {
      window.removeEventListener("resize", syncSplitWidth);
    };
  }, [isDesktopWorkspace, showLatexWorkspace]);

  useEffect(() => {
    if (directoryPaths.length === 0) {
      return;
    }

    setExpandedFolders((current) => {
      const next = { ...current };
      for (const path of directoryPaths) {
        if (!(path in next)) {
          next[path] = true;
        }
      }
      return next;
    });
  }, [directoryPaths]);

  const toggleFolder = useCallback((path: string): void => {
    setExpandedFolders((current) => ({
      ...current,
      [path]: !(current[path] ?? true)
    }));
  }, []);

  const onFirstVersionFolderChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setFirstVersionLatexFiles(selectedFiles);
    setFirstVersionLatexPaths(
      selectedFiles.map((file) => {
        const extendedFile = file as File & { webkitRelativePath?: string };
        return extendedFile.webkitRelativePath && extendedFile.webkitRelativePath.length > 0
          ? extendedFile.webkitRelativePath
          : file.name;
      })
    );
  };

  const saveLatexChanges = useCallback(async (): Promise<boolean> => {
    if (!token || !currentVersion || !selectedLatexPath) {
      setError("No LaTeX file selected.");
      return false;
    }

    if (isReader) {
      setError("Reader role cannot edit LaTeX files.");
      return false;
    }

    setSavingLatexFile(true);
    setError(null);
    setSuccess(null);
    try {
      await updateLatexFile(currentVersion.id, selectedLatexPath, latexContent, token);
      setSavedLatexContent(latexContent);
      setCompileStatus("pending");
      setSuccess("LaTeX file saved.");
      return true;
    } catch (saveError) {
      setError((saveError as Error).message);
      return false;
    } finally {
      setSavingLatexFile(false);
    }
  }, [currentVersion, isReader, latexContent, selectedLatexPath, token]);

  const compileLatex = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!token || !currentVersion) {
      setError("Missing document version.");
      return false;
    }

    if (isReader) {
      setError("Reader role cannot compile documents.");
      return false;
    }

    setCompileBusy(true);
    setError(null);
    setSuccess(null);

    try {
      await compileDocumentVersion(currentVersion.id, token);
      setCompileStatus("pending");
      setCompileLog("Compile queued...");
      if (!options?.silent) {
        setSuccess("Compile queued successfully.");
      }

      let finalLog: { compileStatus: string; compileLog: string | null } | null = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await wait(2000);
        const log = await getCompileLog(currentVersion.id, token);
        setCompileStatus(log.compileStatus);
        setCompileLog(log.compileLog);
        finalLog = { compileStatus: log.compileStatus, compileLog: log.compileLog };
        if (terminalCompileStatus(log.compileStatus)) {
          break;
        }
      }

      await refreshDocumentAfterCompile(token, currentVersion.id);
      if (finalLog) {
        setCompileStatus(finalLog.compileStatus);
        setCompileLog(finalLog.compileLog);
      }
      return true;
    } catch (compileError) {
      setError((compileError as Error).message);
      return false;
    } finally {
      setCompileBusy(false);
    }
  }, [currentVersion, isReader, refreshDocumentAfterCompile, token]);

  const runSaveThenCompile = useCallback(async (): Promise<void> => {
    if (savingLatexFile || compileBusy) {
      return;
    }

    const saved = await saveLatexChanges();
    if (!saved) {
      return;
    }
    await compileLatex();
  }, [compileBusy, compileLatex, saveLatexChanges, savingLatexFile]);

  useEffect(() => {
    if (!token || !currentVersion || !hasLatex || isReader) {
      return;
    }

    if (autoCompileVersionRef.current === currentVersion.id) {
      return;
    }

    autoCompileVersionRef.current = currentVersion.id;
    void compileLatex({ silent: true });
  }, [compileLatex, currentVersion, hasLatex, isReader, token]);

  const toggleTreeCollapsed = useCallback((): void => {
    setIsTreeCollapsed((current) => !current);
  }, []);

  const downloadCurrentPdf = useCallback((): void => {
    if (!pdfUrl) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = pdfUrl;
    anchor.download = downloadFileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [downloadFileName, pdfUrl]);

  const highlightWordInPdf = useCallback((rawWord: string): void => {
    const word = normalizeWordToken(rawWord);
    if (!word) {
      return;
    }

    const targetWindow = pdfPreviewFrameRef.current?.contentWindow;
    if (!targetWindow) {
      return;
    }

    targetWindow.postMessage(
      {
        type: DOCUMENT_PDF_HIGHLIGHT_EVENT,
        payload: {
          word,
          durationMs: DOCUMENT_WORD_HIGHLIGHT_DURATION_MS
        }
      },
      window.location.origin
    );
  }, []);

  const nudgeSplitter = useCallback((deltaPx: number): void => {
    const metrics = getResizableWorkspaceMetrics(workspaceRef.current);
    if (!metrics) {
      return;
    }

    setLeftPaneWidthPx((current) => {
      const baseWidth = current ?? Math.round((metrics.containerWidth - metrics.fixedColumnsWidth) / 2);
      return clampLeftPaneWidth(baseWidth + deltaPx, metrics.containerWidth, metrics.fixedColumnsWidth);
    });
  }, []);

  const onSplitterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!showResizableWorkspace) {
        return;
      }

      event.preventDefault();
      const metrics = getResizableWorkspaceMetrics(workspaceRef.current);
      if (!metrics) {
        return;
      }

      const startingWidth =
        editorPaneRef.current?.getBoundingClientRect().width ??
        leftPaneWidthPx ??
        clampLeftPaneWidth((metrics.containerWidth - metrics.fixedColumnsWidth) / 2, metrics.containerWidth, metrics.fixedColumnsWidth);

      splitDragStartRef.current = {
        clientX: event.clientX,
        leftWidth: clampLeftPaneWidth(startingWidth, metrics.containerWidth, metrics.fixedColumnsWidth)
      };
      setIsDraggingSplitter(true);
    },
    [leftPaneWidthPx, showResizableWorkspace]
  );

  const stopDraggingSplitter = useCallback((): void => {
    splitDragStartRef.current = null;
    setIsDraggingSplitter(false);
  }, []);

  const onDragScrimPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!isDraggingSplitter) {
        return;
      }

      const dragStart = splitDragStartRef.current;
      if (!dragStart) {
        return;
      }

      const metrics = getResizableWorkspaceMetrics(workspaceRef.current);
      if (!metrics) {
        return;
      }

      const deltaPx = event.clientX - dragStart.clientX;
      const nextWidth = clampLeftPaneWidth(dragStart.leftWidth + deltaPx, metrics.containerWidth, metrics.fixedColumnsWidth);
      setLeftPaneWidthPx(nextWidth);
    },
    [isDraggingSplitter]
  );

  const onDragScrimPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      stopDraggingSplitter();
    },
    [stopDraggingSplitter]
  );

  useEffect(() => {
    if (!isDraggingSplitter) {
      return;
    }

    document.body.classList.add("documents-workspace-dragging");

    const onPointerUp = (): void => {
      stopDraggingSplitter();
    };

    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onPointerUp);

    return () => {
      document.body.classList.remove("documents-workspace-dragging");
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onPointerUp);
    };
  }, [isDraggingSplitter, stopDraggingSplitter]);

  const onSplitterKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (!showResizableWorkspace) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeSplitter(-SPLITTER_KEYBOARD_STEP_PX);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeSplitter(SPLITTER_KEYBOARD_STEP_PX);
      }
    },
    [nudgeSplitter, showResizableWorkspace]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) {
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const pressedKey = event.key.toLowerCase();
      if (pressedKey === "b") {
        if (!hasEditableLatex || !currentVersion || !showLatexWorkspace) {
          return;
        }
        event.preventDefault();
        toggleTreeCollapsed();
        return;
      }

      if (pressedKey === "s") {
        event.preventDefault();
        if (showLatexWorkspace && hasEditableLatex && currentVersion) {
          void runSaveThenCompile();
          return;
        }

        if (hasPdf && pdfUrl) {
          downloadCurrentPdf();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentVersion, downloadCurrentPdf, hasEditableLatex, hasPdf, pdfUrl, runSaveThenCompile, showLatexWorkspace, toggleTreeCollapsed]);

  useEffect(() => {
    const handlePdfMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const message = event.data;
      if (!message || typeof message !== "object") {
        return;
      }

      const messageType = (message as { type?: unknown }).type;
      if (messageType !== DOCUMENT_PDF_WORD_PICKED_EVENT) {
        return;
      }

      const payload = (message as { payload?: unknown }).payload;
      const rawWord = typeof payload === "object" && payload !== null ? (payload as { word?: unknown }).word : undefined;
      if (typeof rawWord !== "string") {
        return;
      }

      const word = normalizeWordToken(rawWord);
      if (!word) {
        return;
      }

      monacoEditorRef.current?.highlightWord(word, DOCUMENT_WORD_HIGHLIGHT_DURATION_MS);
    };

    window.addEventListener("message", handlePdfMessage);
    return () => {
      window.removeEventListener("message", handlePdfMessage);
    };
  }, []);

  const renderTreeNodes = useCallback(
    (nodes: LatexTreeNode[], depth = 0): JSX.Element[] =>
      nodes.map((node) => {
        if (node.isDirectory) {
          const expanded = expandedFolders[node.path] ?? true;
          return (
            <div key={node.path} className="documents-tree-node-wrap">
              <button
                className="documents-tree-node documents-tree-node-directory"
                style={{ paddingLeft: `${0.55 + depth * 0.8}rem` }}
                type="button"
                onClick={() => toggleFolder(node.path)}
              >
                <span className="documents-tree-caret" aria-hidden>
                  {expanded ? "▾" : "▸"}
                </span>
                <span>{node.name}</span>
              </button>
              {expanded ? renderTreeNodes(node.children, depth + 1) : null}
            </div>
          );
        }

        const isActive = selectedLatexPath === node.path;
        return (
          <button
            key={node.path}
            className={isActive ? "documents-tree-node documents-tree-node-file documents-tree-node-active" : "documents-tree-node documents-tree-node-file"}
            style={{ paddingLeft: `${0.55 + depth * 0.8}rem` }}
            type="button"
            onClick={() => {
              if (!token || !currentVersion) {
                return;
              }
              void loadLatexFileContent(currentVersion.id, node.path, token);
            }}
          >
            <span className="documents-tree-file-dot" aria-hidden>
              •
            </span>
            <span>{node.name}</span>
          </button>
        );
      }),
    [currentVersion, expandedFolders, loadLatexFileContent, selectedLatexPath, toggleFolder, token]
  );

  const createFirstVersion = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!token || !documentDetail) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (isReader) {
      setError("Reader role cannot upload document versions.");
      return;
    }

    setSubmittingFirstVersion(true);
    setError(null);
    setSuccess(null);

    try {
      await createDocumentVersionUpload(documentDetail.id, token, {
        branchName: "main",
        pdf: firstVersionPdfFile ?? undefined,
        latexFiles: firstVersionLatexFiles.length > 0 ? firstVersionLatexFiles : undefined,
        latexPaths: firstVersionLatexFiles.length > 0 ? firstVersionLatexPaths : undefined,
        latexEntryFile: inferLatexEntryFile(firstVersionLatexPaths)
      });
      setFirstVersionPdfFile(null);
      setFirstVersionLatexFiles([]);
      setFirstVersionLatexPaths([]);
      setSuccess("First version uploaded successfully.");
      await loadDocumentDetail(token);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setSubmittingFirstVersion(false);
    }
  };

  return (
    <AppShell
      title="Documents"
      projectId={params.projectId}
      hideHeader
      fullWidth
      onExitProjectRequest={requestExitProject}
    >
      <section className="documents-detail-topbar">
        <div className="documents-detail-meta">
          <h2>{documentDetail?.title ?? "Loading document..."}</h2>
          {documentDetail ? (
            <p>
              Type: {documentDetail.type}
              {documentDetail.authors.length > 0 ? ` | Authors: ${documentDetail.authors.join(", ")}` : ""}
            </p>
          ) : null}
          {compileStatus ? (
            <p className="documents-detail-status">Status: {compileStatusLabel(compileStatus)}</p>
          ) : (
            <p className="documents-detail-status">Status: Not compiled yet</p>
          )}
        </div>
        <div className="documents-detail-actions">
          {hasLatex ? (
            <button
              className={showLatexWorkspace ? "button button-secondary" : "button"}
              type="button"
              onClick={() => {
                setIsEditorOpen((current) => !current);
              }}
            >
              {showLatexWorkspace ? "Close editor" : "Edit"}
            </button>
          ) : null}
          {hasLatex && !isReader && !showLatexWorkspace ? (
            <button className="button button-secondary" type="button" onClick={() => void compileLatex()} disabled={compileBusy}>
              {compileBusy ? "Compiling..." : "Compile"}
            </button>
          ) : null}
          {hasPdf ? (
            <button className="button button-secondary" type="button" onClick={downloadCurrentPdf} disabled={loadingPdf || !pdfUrl}>
              Download PDF
            </button>
          ) : null}
          <Link className="button button-secondary" href={`/projects/${params.projectId}/documents`}>
            Back to documents
          </Link>
        </div>
      </section>

      {success ? <p className="alert alert-success">{success}</p> : null}
      {error ? <p className="alert alert-error">{error}</p> : null}

      {loadingDocument ? <p className="alert alert-info">Loading document...</p> : null}

      {!loadingDocument && documentDetail && !currentVersion ? (
        <section className="panel">
          <h3 className="section-heading">Upload initial version</h3>
          <form className="form-grid" onSubmit={createFirstVersion}>
            <div className="grid cols-2 grid-tight">
              <label>
                PDF file (optional)
                <input
                  className="input"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => setFirstVersionPdfFile(event.target.files?.[0] ?? null)}
                  disabled={isReader || submittingFirstVersion}
                />
              </label>
              <label>
                LaTeX folder (optional)
                <input
                  ref={firstVersionFolderInputRef}
                  className="input"
                  type="file"
                  multiple
                  onChange={onFirstVersionFolderChange}
                  disabled={isReader || submittingFirstVersion}
                />
              </label>
            </div>
            {firstVersionLatexFiles.length > 0 ? (
              <p className="alert alert-info">Selected {firstVersionLatexFiles.length} LaTeX files for first version.</p>
            ) : null}
            <p className="documents-list-meta">
              If you upload nothing, Atlasium creates a blank LaTeX workspace with <code>main.tex</code>, <code>references.bib</code>,
              and a <code>Figures/</code> folder.
            </p>
            <button className="button" type="submit" disabled={isReader || submittingFirstVersion}>
              {submittingFirstVersion ? "Uploading..." : "Upload first version"}
            </button>
          </form>
        </section>
      ) : null}

      {!loadingDocument && documentDetail && currentVersion ? (
        showLatexWorkspace ? (
          <section
            ref={workspaceRef}
            className={[
              "documents-workspace",
              showResizableWorkspace ? "documents-workspace-resizable" : "",
              isDraggingSplitter ? "documents-workspace-dragging" : ""
            ]
              .join(" ")
              .trim()}
            style={workspaceStyle}
          >
            <article ref={editorPaneRef} className="panel documents-editor-pane documents-editor-pane-full">
              <div className={isTreeCollapsed ? "documents-editor-layout documents-editor-layout-collapsed" : "documents-editor-layout"}>
                <aside className={isTreeCollapsed ? "documents-tree-pane documents-tree-pane-collapsed" : "documents-tree-pane"}>
                  <div className="documents-tree-pane-header">Files</div>
                  <div className="documents-tree-scroll">
                    {latexTreeNodes.length === 0 ? <p className="alert alert-info">No editable files were found.</p> : renderTreeNodes(latexTreeNodes)}
                  </div>
                </aside>
                <div className="documents-editor-main">
                  <div className="code-toolbar">
                    <span>Editing: {selectedLatexPath || "No file selected"}</span>
                    <div className="inline-actions">
                      <button className="button button-secondary" type="button" onClick={toggleTreeCollapsed}>
                        {isTreeCollapsed ? "Show tree" : "Hide tree"}
                      </button>
                      {compileLog ? (
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() => setIsCompileLogOpen((current) => !current)}
                        >
                          {isCompileLogOpen ? "Hide log" : "Show log"}
                        </button>
                      ) : null}
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => {
                          void saveLatexChanges();
                        }}
                        disabled={isReader || savingLatexFile}
                      >
                        {savingLatexFile ? "Saving..." : "Save"}
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          void compileLatex();
                        }}
                        disabled={isReader || compileBusy}
                      >
                        {compileBusy ? "Compiling..." : "Compile"}
                      </button>
                    </div>
                  </div>
                  <LatexMonacoEditor
                    ref={monacoEditorRef}
                    className="documents-code-editor"
                    value={latexContent}
                    language={monacoLanguage}
                    readOnly={!selectedLatexPath || loadingLatexFile || savingLatexFile || isReader}
                    onChange={(nextContent) => {
                      setLatexContent(nextContent);
                    }}
                    onWordDoubleClick={(word) => {
                      highlightWordInPdf(word);
                    }}
                    onSaveShortcut={() => {
                      if (!hasEditableLatex || !currentVersion) {
                        return;
                      }
                      void runSaveThenCompile();
                    }}
                    onToggleTreeShortcut={() => {
                      if (!hasEditableLatex || !currentVersion) {
                        return;
                      }
                      toggleTreeCollapsed();
                    }}
                  />
                  {compileLog && isCompileLogOpen ? (
                    <div className="documents-compile-log">
                      <p className="documents-compile-log-title">Compile log</p>
                      <pre className="code-block">{compileLog}</pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>

            {showResizableWorkspace ? (
              <div
                className="documents-split-handle"
                role="separator"
                aria-label="Resize editor and preview panels"
                aria-orientation="vertical"
                tabIndex={0}
                onPointerDown={onSplitterPointerDown}
                onKeyDown={onSplitterKeyDown}
              >
                <span className="documents-split-line" aria-hidden />
              </div>
            ) : null}

            <article className="panel documents-preview-pane documents-preview-pane-full">
              <div className="documents-preview-body">
                {loadingPdf ? <p className="alert alert-info">Loading PDF preview...</p> : null}
                {pdfError ? <p className="alert alert-error">{pdfError}</p> : null}
                {!loadingPdf && !hasPdf ? <p className="alert alert-info">No PDF available yet. Compile to generate preview.</p> : null}
                {!loadingPdf && hasPdf && pdfViewerSrc ? (
                  <iframe ref={pdfPreviewFrameRef} key={pdfViewerSrc} className="pdf-frame" src={pdfViewerSrc} title="Compiled PDF preview" />
                ) : null}
              </div>
            </article>
            {isDraggingSplitter ? (
              <div
                className="documents-drag-scrim"
                aria-hidden
                onPointerMove={onDragScrimPointerMove}
                onPointerUp={onDragScrimPointerUp}
                onPointerCancel={onDragScrimPointerUp}
              />
            ) : null}
          </section>
        ) : (
          <div className="documents-preview-only-wrap">
            <section className="panel documents-preview-pane documents-preview-pane-full documents-preview-only">
              <div className="documents-preview-body">
                {loadingPdf ? <p className="alert alert-info">Loading PDF preview...</p> : null}
                {pdfError ? <p className="alert alert-error">{pdfError}</p> : null}
                {!loadingPdf && !hasPdf ? (
                  <p className="alert alert-info">
                    {hasLatex ? "No PDF available yet. Compile to generate preview." : "No PDF available for this document version."}
                  </p>
                ) : null}
                {!loadingPdf && hasPdf && pdfViewerSrc ? (
                  <iframe ref={pdfPreviewFrameRef} key={pdfViewerSrc} className="pdf-frame" src={pdfViewerSrc} title="Document PDF preview" />
                ) : null}
              </div>
            </section>
          </div>
        )
      ) : null}
    </AppShell>
  );
}
