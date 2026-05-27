"use client";

import {
  Code2,
  Copy,
  Download,
  ExternalLink,
  File,
  FileCode2,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Plus,
  WrapText,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell, openAccountSettings } from "../../../../components/app-shell";
import { EmptyState, IconButton, LoadingState, StatusLine } from "../../../../components/ui";
import { LoginResponse } from "../../../../lib/client-api";
import {
  createProjectRepository,
  createRepositoryBranch,
  createRepositoryMergeRequest,
  downloadRepositoryArchive,
  ensureProjectRepositoryAccess,
  getGitlabConnectionStatus,
  getRepositoryImageMimeType,
  getRepositoryFile,
  getRepositoryRawFile,
  getRepositoryTree,
  listProjectRepositories,
  GitlabConnectionStatus,
  listRepositoryBranches,
  listRepositoryCommits,
  listRepositoryMergeRequests,
  ProjectRepositoryStatus,
  ProjectRepositorySummary,
  RepositoryBranch,
  RepositoryCommit,
  RepositoryFile,
  RepositoryMergeRequest,
  RepositoryMergeRequestState,
  RepositoryTree
} from "../../../../lib/gitlab";
import { getProjectAccess, ProjectAccess } from "../../../../lib/project-access";

type CodeTab = "files" | "commits" | "branches" | "merge-requests";

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

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function fileExtBadge(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    tex: "TEX", bib: "BIB", pdf: "PDF",
    md: "MD", txt: "TXT",
    ts: "TS", tsx: "TSX", js: "JS", jsx: "JSX",
    py: "PY", sh: "SH", rb: "RB",
    json: "JSON", yml: "YML", yaml: "YML", toml: "TOML",
    css: "CSS", html: "HTML", svg: "SVG",
    png: "IMG", jpg: "IMG", jpeg: "IMG", gif: "IMG",
    csv: "CSV", xml: "XML",
  };
  return map[ext] ?? (ext.toUpperCase().slice(0, 4) || "FILE");
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function repositoryPathPreview(name: string, path: string): string {
  const raw = path.trim() || name.trim();
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const TAB_LABELS: Record<CodeTab, string> = {
  files: "Files",
  commits: "Commits",
  branches: "Branches",
  "merge-requests": "Merge Requests"
};

const CODE_FILE_WORD_WRAP_STORAGE_KEY = "atlasium_code_file_word_wrap";
const CODE_ACTIVE_REPOSITORY_STORAGE_PREFIX = "atlasium_code_active_repository";

export default function ProjectCodePage({ params }: { params: { projectId: string } }): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [connection, setConnection] = useState<GitlabConnectionStatus | null>(null);
  const [repositories, setRepositories] = useState<ProjectRepositorySummary[]>([]);
  const [activeRepositoryId, setActiveRepositoryId] = useState<string | null>(null);
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [tree, setTree] = useState<RepositoryTree | null>(null);
  const [selectedFile, setSelectedFile] = useState<RepositoryFile | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);
  const [mergeRequests, setMergeRequests] = useState<RepositoryMergeRequest[]>([]);
  const [browserRef, setBrowserRef] = useState("");
  const [browserPath, setBrowserPath] = useState("");
  const [mergeRequestFilter, setMergeRequestFilter] = useState<RepositoryMergeRequestState>("opened");
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchSourceRef, setNewBranchSourceRef] = useState("");
  const [mergeRequestSourceBranch, setMergeRequestSourceBranch] = useState("");
  const [mergeRequestTargetBranch, setMergeRequestTargetBranch] = useState("");
  const [mergeRequestTitle, setMergeRequestTitle] = useState("");
  const [mergeRequestDescription, setMergeRequestDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingRepository, setCreatingRepository] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [creatingMergeRequest, setCreatingMergeRequest] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [mergeRequestsLoading, setMergeRequestsLoading] = useState(false);
  const [downloadingArchive, setDownloadingArchive] = useState(false);
  const [openingGitlab, setOpeningGitlab] = useState(false);
  const [copiedCloneType, setCopiedCloneType] = useState<"ssh" | "https" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [mergeRequestsError, setMergeRequestsError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CodeTab>("files");
  const [showMRModal, setShowMRModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [cloneDrawerOpen, setCloneDrawerOpen] = useState(false);
  const [gitUsername, setGitUsername] = useState<string | null>(null);
  const [fileWordWrap, setFileWordWrap] = useState(false);
  const [fileWordWrapReady, setFileWordWrapReady] = useState(false);
  const [showRepositoryModal, setShowRepositoryModal] = useState(false);
  const [newRepositoryName, setNewRepositoryName] = useState("");
  const [newRepositoryPath, setNewRepositoryPath] = useState("");
  const [newRepositoryDescription, setNewRepositoryDescription] = useState("");

  const canWrite = access?.canWrite ?? false;
  const gitlabConnected = connection?.connected === true && !connection.reconnectRequired;
  const activeRepositoryStorageKey = `${CODE_ACTIVE_REPOSITORY_STORAGE_PREFIX}:${params.projectId}`;
  const connectedRepository = useMemo(
    () => repositories.find((repository) => repository.id === activeRepositoryId) ?? repositories[0] ?? null,
    [activeRepositoryId, repositories]
  );
  const repositoryConnected = connectedRepository !== null;
  const currentBrowseRef = connectedRepository ? browserRef || connectedRepository.defaultBranch : "";
  const currentBranchSourceRef = newBranchSourceRef || currentBrowseRef;
  const currentMergeRequestTargetBranch = connectedRepository
    ? mergeRequestTargetBranch || connectedRepository.defaultBranch
    : "";
  const currentMergeRequestSourceBranch =
    mergeRequestSourceBranch || branches.find((branch) => !branch.default)?.name || currentBrowseRef;
  const newRepositoryPathPreview = repositoryPathPreview(newRepositoryName, newRepositoryPath);
  const selectedFileImageMimeType =
    selectedFile && selectedFile.binary ? getRepositoryImageMimeType(selectedFile.fileName || selectedFile.filePath) : null;
  const selectedFileKindLabel = selectedFile ? (selectedFile.binary ? (selectedFileImageMimeType ? "Image" : "Binary") : "Text") : "";

  const resetRepositoryWorkspace = useCallback((): void => {
    setBranches([]);
    setCommits([]);
    setTree(null);
    setSelectedFile(null);
    setMergeRequests([]);
    setBrowserRef("");
    setBrowserPath("");
    setContentError(null);
    setMergeRequestsError(null);
  }, []);

  const loadAccess = useCallback(
    async (authToken: string): Promise<ProjectAccess> => {
      const nextAccess = await getProjectAccess(params.projectId, authToken);
      setAccess(nextAccess);
      return nextAccess;
    },
    [params.projectId]
  );

  const loadConnection = useCallback(async (authToken: string): Promise<GitlabConnectionStatus> => {
    const nextConnection = await getGitlabConnectionStatus(authToken);
    setConnection(nextConnection);
    return nextConnection;
  }, []);

  const loadRepositories = useCallback(
    async (authToken: string): Promise<ProjectRepositorySummary[]> => {
      const nextRepositories = await listProjectRepositories(params.projectId, authToken);
      setRepositories(nextRepositories);
      setActiveRepositoryId((currentId) => {
        if (currentId && nextRepositories.some((repository) => repository.id === currentId)) {
          return currentId;
        }
        const storedId = localStorage.getItem(activeRepositoryStorageKey);
        if (storedId && nextRepositories.some((repository) => repository.id === storedId)) {
          return storedId;
        }
        return nextRepositories[0]?.id ?? null;
      });
      return nextRepositories;
    },
    [activeRepositoryStorageKey, params.projectId]
  );

  const loadRepositoryContent = useCallback(
    async (
      authToken: string,
      nextRepository: ProjectRepositorySummary,
      paramsOverride: { ref?: string; path?: string } = {}
    ): Promise<void> => {
      setContentLoading(true);
      try {
        const resolvedRef = paramsOverride.ref?.trim() || nextRepository.defaultBranch;
        const resolvedPath = paramsOverride.path?.trim() || "";
        const [nextBranches, nextCommits, nextTree] = await Promise.all([
          listRepositoryBranches(params.projectId, nextRepository.id, authToken),
          listRepositoryCommits(params.projectId, nextRepository.id, authToken, { ref: resolvedRef }),
          getRepositoryTree(params.projectId, nextRepository.id, authToken, { ref: resolvedRef, path: resolvedPath })
        ]);
        setBranches(nextBranches);
        setCommits(nextCommits);
        setTree(nextTree);
        setContentError(null);
      } catch (loadError) {
        setContentError((loadError as Error).message || "Unable to load repository content.");
      } finally {
        setContentLoading(false);
      }
    },
    [params.projectId]
  );

  const loadMergeRequests = useCallback(
    async (authToken: string, repositoryId: string, state: RepositoryMergeRequestState): Promise<void> => {
      setMergeRequestsLoading(true);
      try {
        const nextMergeRequests = await listRepositoryMergeRequests(params.projectId, repositoryId, authToken, { state });
        setMergeRequests(nextMergeRequests);
        setMergeRequestsError(null);
      } catch (loadError) {
        setMergeRequestsError((loadError as Error).message || "Unable to load merge requests.");
      } finally {
        setMergeRequestsLoading(false);
      }
    },
    [params.projectId]
  );

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }
    setToken(storedToken);
    setGitUsername(parseStoredUser(localStorage.getItem("doctoral_user"))?.username ?? null);
    setLoading(true);
    Promise.all([loadAccess(storedToken), loadConnection(storedToken), loadRepositories(storedToken)])
      .then(() => { setError(null); })
      .catch((loadError) => { setError((loadError as Error).message || "Unable to load Code workspace."); })
      .finally(() => { setLoading(false); });
  }, [loadAccess, loadConnection, loadRepositories, router]);

  useEffect(() => {
    setFileWordWrap(localStorage.getItem(CODE_FILE_WORD_WRAP_STORAGE_KEY) === "true");
    setFileWordWrapReady(true);
  }, []);

  useEffect(() => {
    if (!fileWordWrapReady) {
      return;
    }
    localStorage.setItem(CODE_FILE_WORD_WRAP_STORAGE_KEY, String(fileWordWrap));
  }, [fileWordWrap, fileWordWrapReady]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "z" ||
        activeTab !== "files" ||
        !selectedFile ||
        selectedFile.binary
      ) {
        return;
      }

      if (event.target instanceof HTMLElement) {
        const tagName = event.target.tagName.toLowerCase();
        if (event.target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select") {
          return;
        }
      }

      event.preventDefault();
      setFileWordWrap((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTab, selectedFile]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setImagePreviewUrl(null);
    setImagePreviewError(null);

    if (!selectedFile || !selectedFile.binary || !selectedFileImageMimeType) {
      setImagePreviewLoading(false);
      return () => undefined;
    }

    if (!token || !connectedRepository) {
      setImagePreviewLoading(false);
      setImagePreviewError("Image preview requires an active repository session.");
      return () => undefined;
    }

    setImagePreviewLoading(true);
    void getRepositoryRawFile(params.projectId, connectedRepository.id, token, {
      filePath: selectedFile.filePath,
      ref: selectedFile.ref || undefined
    })
      .then(({ blob }) => {
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImagePreviewUrl(objectUrl);
      })
      .catch((previewError) => {
        if (!cancelled) {
          setImagePreviewError((previewError as Error).message || "Unable to load image preview.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setImagePreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [connectedRepository, params.projectId, selectedFile, selectedFileImageMimeType, token]);

  useEffect(() => {
    if (!token || !connectedRepository || !gitlabConnected) {
      if (!connectedRepository || !gitlabConnected) resetRepositoryWorkspace();
      return;
    }
    void loadRepositoryContent(token, connectedRepository, { ref: currentBrowseRef, path: browserPath });
  }, [browserPath, connectedRepository, currentBrowseRef, gitlabConnected, loadRepositoryContent, resetRepositoryWorkspace, token]);

  useEffect(() => {
    if (!token || !connectedRepository || !gitlabConnected) {
      setMergeRequests([]);
      setMergeRequestsError(null);
      return;
    }
    void loadMergeRequests(token, connectedRepository.id, mergeRequestFilter);
  }, [connectedRepository, gitlabConnected, loadMergeRequests, mergeRequestFilter, token]);

  useEffect(() => {
    if (activeRepositoryId) {
      localStorage.setItem(activeRepositoryStorageKey, activeRepositoryId);
    } else {
      localStorage.removeItem(activeRepositoryStorageKey);
    }
  }, [activeRepositoryId, activeRepositoryStorageKey]);

  useEffect(() => {
    setSelectedFile(null);
  }, [browserPath, currentBrowseRef]);

  const onCreateRepository = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    const repositoryName = newRepositoryName.trim();
    if (!repositoryName) {
      setError("Repository name is required.");
      return;
    }
    setCreatingRepository(true);
    setError(null);
    setSuccess(null);
    try {
      const nextRepository = await createProjectRepository(params.projectId, token, {
        name: repositoryName,
        path: newRepositoryPath.trim() || undefined,
        description: newRepositoryDescription.trim() || undefined
      });
      const nextRepositories = await loadRepositories(token);
      if (nextRepository.connected) {
        setActiveRepositoryId(nextRepository.id);
      } else {
        setActiveRepositoryId(nextRepositories[0]?.id ?? null);
      }
      setBrowserPath("");
      setBrowserRef(nextRepository.connected ? nextRepository.defaultBranch : "");
      setNewBranchSourceRef("");
      setMergeRequestSourceBranch("");
      setMergeRequestTargetBranch("");
      if (nextRepository.connected) {
        await Promise.all([
          loadRepositoryContent(token, nextRepository, { ref: nextRepository.defaultBranch, path: "" }),
          loadMergeRequests(token, nextRepository.id, mergeRequestFilter)
        ]);
      }
      setNewRepositoryName("");
      setNewRepositoryPath("");
      setNewRepositoryDescription("");
      setShowRepositoryModal(false);
      setSuccess("Managed repository created.");
    } catch (createError) {
      setError((createError as Error).message || "Unable to create the repository.");
    } finally {
      setCreatingRepository(false);
    }
  };

  const onOpenEntry = async (entry: RepositoryTree["entries"][number]): Promise<void> => {
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    if (!connectedRepository) { setContentError("Select a repository before opening files."); return; }
    if (entry.type === "tree") {
      setBrowserPath(entry.path);
      return;
    }
    setContentLoading(true);
    setContentError(null);
    try {
      const file = await getRepositoryFile(params.projectId, connectedRepository.id, token, {
        filePath: entry.path,
        ref: currentBrowseRef || undefined
      });
      setSelectedFile(file);
    } catch (fileError) {
      setContentError((fileError as Error).message || "Unable to load file content.");
    } finally {
      setContentLoading(false);
    }
  };

  const onCopyCloneUrl = async (value: string, kind: "ssh" | "https"): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCloneType(kind);
      window.setTimeout(() => setCopiedCloneType((current) => (current === kind ? null : current)), 2000);
    } catch {
      setError("Unable to copy the clone URL.");
    }
  };

  const onDownloadArchive = async (): Promise<void> => {
    if (!connectedRepository) return;
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    if (!gitlabConnected) {
      setError("Connect your GitLab API access from Account before downloading repository archives.");
      return;
    }
    setDownloadingArchive(true);
    setError(null);
    try {
      const archive = await downloadRepositoryArchive(params.projectId, connectedRepository.id, token, {
        ref: currentBrowseRef || connectedRepository.defaultBranch
      });
      const objectUrl = URL.createObjectURL(archive.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = archive.fileName;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError((downloadError as Error).message || "Unable to download the repository archive.");
    } finally {
      setDownloadingArchive(false);
    }
  };

  const onOpenInGitlab = async (): Promise<void> => {
    if (!connectedRepository) return;
    if (!token) { setError("Missing session token. Please sign in again."); return; }

    setOpeningGitlab(true);
    setError(null);
    try {
      const nextRepository = await ensureProjectRepositoryAccess(params.projectId, connectedRepository.id, token);
      if (!nextRepository.connected) {
        setError("This project repository is not provisioned yet.");
        return;
      }
      setRepositories((current) => current.map((repository) => (repository.id === nextRepository.id ? nextRepository : repository)));
      window.open(nextRepository.webUrl, "_blank", "noopener,noreferrer");
    } catch (openError) {
      setError((openError as Error).message || "Unable to prepare GitLab repository access.");
    } finally {
      setOpeningGitlab(false);
    }
  };

  const onCreateBranch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    if (!connectedRepository) { setError("Select a repository before creating branches."); return; }
    setCreatingBranch(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createRepositoryBranch(params.projectId, connectedRepository.id, token, {
        name: newBranchName.trim(),
        sourceRef: currentBranchSourceRef.trim()
      });
      setNewBranchName("");
      setBrowserRef(created.name);
      setNewBranchSourceRef(created.name);
      setMergeRequestSourceBranch(created.name);
      await loadRepositoryContent(token, connectedRepository, { ref: created.name, path: browserPath });
      setShowBranchModal(false);
      setSuccess(`Branch ${created.name} created.`);
    } catch (branchError) {
      setError((branchError as Error).message || "Unable to create the branch.");
    } finally {
      setCreatingBranch(false);
    }
  };

  const onCreateMergeRequest = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    if (!connectedRepository) { setError("Select a repository before creating merge requests."); return; }
    setCreatingMergeRequest(true);
    setError(null);
    setSuccess(null);
    try {
      const mergeRequest = await createRepositoryMergeRequest(params.projectId, connectedRepository.id, token, {
        sourceBranch: currentMergeRequestSourceBranch.trim(),
        targetBranch: currentMergeRequestTargetBranch.trim(),
        title: mergeRequestTitle.trim(),
        description: mergeRequestDescription.trim() || undefined
      });
      setMergeRequestTitle("");
      setMergeRequestDescription("");
      setShowMRModal(false);
      await loadMergeRequests(token, connectedRepository.id, mergeRequestFilter);
      setSuccess(`Merge request !${mergeRequest.iid} created.`);
    } catch (mergeRequestError) {
      setError((mergeRequestError as Error).message || "Unable to create the merge request.");
    } finally {
      setCreatingMergeRequest(false);
    }
  };

  const connectStateMessage = useMemo(() => {
    if (!connection?.connected) {
      return "Connect your GitLab account to browse files, download archives, and manage branches and merge requests.";
    }
    if (connection.reconnectRequired) {
      return "Your GitLab session needs to be reconnected before Atlasium can access repository content.";
    }
    return null;
  }, [connection]);

  // Breadcrumb segments from the current browser path
  const breadcrumbSegments = browserPath
    ? browserPath.split("/").filter(Boolean).map((seg, i, arr) => ({
        label: seg,
        path: arr.slice(0, i + 1).join("/")
      }))
    : [];

  return (
    <AppShell projectId={params.projectId}>
      <div className="code-page">
        {loading ? <LoadingState title="Loading Code workspace" detail="Checking repository and GitLab connection state." /> : null}
        {error ? <StatusLine tone="error">{error}</StatusLine> : null}
        {success ? <StatusLine tone="success">{success}</StatusLine> : null}

        {!loading && !repositoryConnected ? (
          <section className="panel module-entry-panel code-provision-panel">
            <div className="stack-xs">
              <p className="eyebrow">Repository cockpit</p>
              <h2 className="section-heading">No repositories yet</h2>
              <p>
                {canWrite
                  ? "Create a managed GitLab repository for this project to start browsing code, branches, and merge requests."
                  : "This project does not have managed GitLab repositories yet."}
              </p>
            </div>
            {canWrite ? (
              <button className="button" type="button" onClick={() => setShowRepositoryModal(true)}>
                <Plus size={16} aria-hidden="true" />
                New repository
              </button>
            ) : null}
          </section>
        ) : null}

        {!loading && connectedRepository ? (
          <>
            <section className="panel module-entry-panel code-cockpit">
              <div className="code-cockpit-row code-cockpit-summary">
                <div className="code-cockpit-title">
                  <p className="eyebrow">
                    <Code2 size={15} aria-hidden="true" />
                    Repository cockpit
                  </p>
                  <div className="code-cockpit-heading">
                    <h2>{connectedRepository.name}</h2>
                    <code>{connectedRepository.pathWithNamespace}</code>
                  </div>
                  <label className="code-repository-switcher">
                    Repository
                    <select
                      className="input"
                      value={connectedRepository.id}
                      onChange={(event) => {
                        setActiveRepositoryId(event.target.value);
                        setBrowserRef("");
                        setBrowserPath("");
                        setSelectedFile(null);
                        setContentError(null);
                        setMergeRequestsError(null);
                      }}
                    >
                      {repositories.map((repository) => (
                        <option key={repository.id} value={repository.id}>
                          {repository.name} - {repository.pathWithNamespace}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="code-cockpit-state" aria-label="Repository state">
                  <span className={gitlabConnected ? "code-state-pill code-state-live" : "code-state-pill code-state-warning"}>
                    {gitlabConnected ? "GitLab API connected" : connection?.reconnectRequired ? "GitLab reconnect required" : "GitLab API disconnected"}
                  </span>
                  <span className="badge">{connectedRepository.visibility}</span>
                  {connectedRepository.managed ? <span className="badge">Managed</span> : null}
                  <span className="badge">{repositories.length} repositor{repositories.length === 1 ? "y" : "ies"}</span>
                  <span className="badge">Default {connectedRepository.defaultBranch}</span>
                </div>
              </div>

              <div className="code-cockpit-row code-cockpit-controls">
                <nav className="code-tabs" aria-label="Repository sections">
                  {(["files", "commits", "branches", "merge-requests"] as CodeTab[]).map((tab) => {
                    const icons: Record<CodeTab, JSX.Element> = {
                      files: <FileCode2 size={16} aria-hidden="true" />,
                      commits: <GitCommitHorizontal size={16} aria-hidden="true" />,
                      branches: <GitBranch size={16} aria-hidden="true" />,
                      "merge-requests": <GitPullRequest size={16} aria-hidden="true" />
                    };
                    const counts: Partial<Record<CodeTab, number>> = {
                      branches: branches.length || undefined,
                      "merge-requests": mergeRequests.length || undefined
                    };
                    return (
                      <button
                        key={tab}
                        type="button"
                        className={`code-tab${activeTab === tab ? " active" : ""}`}
                        onClick={() => setActiveTab(tab)}
                      >
                        {icons[tab]}
                        {TAB_LABELS[tab]}
                        {counts[tab] ? <span className="code-tab-count">{counts[tab]}</span> : null}
                      </button>
                    );
                  })}
                </nav>

                <div className="code-cockpit-context">
                  {(activeTab === "files" || activeTab === "commits") && branches.length > 0 ? (
                    <label className="code-ref-label">
                      Branch
                      <select
                        className="input code-ref-select"
                        value={currentBrowseRef}
                        onChange={(event) => {
                          setBrowserRef(event.target.value);
                          setBrowserPath("");
                        }}
                      >
                        {branches.map((branch) => (
                          <option key={branch.name} value={branch.name}>
                            {branch.name}
                            {branch.default ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {activeTab === "files" ? <code className="code-current-path">/{browserPath || ""}</code> : null}
                  {activeTab === "merge-requests" ? (
                    <label className="code-filter-label">
                      State
                      <select
                        className="input code-ref-select"
                        value={mergeRequestFilter}
                        onChange={(event) => setMergeRequestFilter(event.target.value as RepositoryMergeRequestState)}
                      >
                        <option value="opened">Opened</option>
                        <option value="merged">Merged</option>
                        <option value="closed">Closed</option>
                        <option value="all">All</option>
                      </select>
                    </label>
                  ) : null}
                </div>

                <div className="code-cockpit-actions">
                  {canWrite ? (
                    <button className="button button-secondary" type="button" onClick={() => setShowRepositoryModal(true)}>
                      <Plus size={16} aria-hidden="true" />
                      New repo
                    </button>
                  ) : null}
                  <button className="button button-secondary" type="button" onClick={() => setCloneDrawerOpen(true)}>
                    <Copy size={16} aria-hidden="true" />
                    Clone
                  </button>
                  <button className="button button-secondary" type="button" onClick={() => void onOpenInGitlab()} disabled={openingGitlab}>
                    <ExternalLink size={16} aria-hidden="true" />
                    {openingGitlab ? "Opening..." : "Open GitLab"}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void onDownloadArchive()}
                    disabled={downloadingArchive || !gitlabConnected}
                    title={!gitlabConnected ? "Connect GitLab API access to download ZIP archives" : undefined}
                  >
                    <Download size={16} aria-hidden="true" />
                    {downloadingArchive ? "Downloading..." : "ZIP"}
                  </button>
                  {activeTab === "branches" && canWrite ? (
                    <button className="button" type="button" onClick={() => setShowBranchModal(true)}>
                      <Plus size={16} aria-hidden="true" />
                      New branch
                    </button>
                  ) : null}
                  {activeTab === "merge-requests" && canWrite ? (
                    <button className="button" type="button" onClick={() => setShowMRModal(true)}>
                      <Plus size={16} aria-hidden="true" />
                      Create MR
                    </button>
                  ) : null}
                </div>
              </div>

              {connectedRepository.description ? <p className="code-cockpit-description">{connectedRepository.description}</p> : null}
            </section>

            {!gitlabConnected ? (
              <section className="panel code-connect-required">
                <EmptyState
                  title="GitLab API access required"
                  detail={connectStateMessage ?? "Connect GitLab API access before browsing repository content."}
                  action={
                    <button type="button" className="button" onClick={() => openAccountSettings("git")}>
                      Connect account
                    </button>
                  }
                />
              </section>
            ) : (
              <>
                {activeTab === "files" ? (
                  <div className="code-workbench-layout">
                    <aside className="panel code-workbench-tree">
                      <div className="code-workbench-tree-header">
                        <div>
                          <p className="eyebrow">Files</p>
                          <strong>{tree?.ref ?? currentBrowseRef}</strong>
                        </div>
                        {contentLoading ? <span className="code-inline-status">Loading</span> : null}
                      </div>
                      <div className="code-breadcrumb">
                        <button
                          type="button"
                          className="code-breadcrumb-btn"
                          onClick={() => {
                            setBrowserPath("");
                            setSelectedFile(null);
                          }}
                          aria-label="Repository root"
                        >
                          /
                        </button>
                        {breadcrumbSegments.map(({ label, path }, i) => (
                          <span key={path} className="code-breadcrumb-segment">
                            <span className="code-breadcrumb-sep">/</span>
                            <button
                              type="button"
                              className={`code-breadcrumb-btn${i === breadcrumbSegments.length - 1 ? " active" : ""}`}
                              onClick={() => {
                                setBrowserPath(path);
                                setSelectedFile(null);
                              }}
                            >
                              {label}
                            </button>
                          </span>
                        ))}
                      </div>
                      {contentError ? <StatusLine tone="error">{contentError}</StatusLine> : null}
                      <div className="code-tree-list">
                        {tree?.entries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className={[
                              "code-tree-entry",
                              entry.type === "tree" ? "is-dir" : "",
                              selectedFile?.filePath === entry.path ? "is-selected" : ""
                            ].filter(Boolean).join(" ")}
                            onClick={() => void onOpenEntry(entry)}
                          >
                            <span className="code-entry-icon" aria-hidden="true">
                              {entry.type === "tree" ? <Folder size={15} /> : <File size={15} />}
                            </span>
                            <span className="code-entry-name">{entry.name}</span>
                            {entry.type === "blob" ? <span className="code-entry-badge">{fileExtBadge(entry.name)}</span> : null}
                          </button>
                        ))}
                        {tree && tree.entries.length === 0 ? <EmptyState title="Empty folder" detail="This repository folder does not contain files." /> : null}
                      </div>
                    </aside>

                    <section className="panel code-workbench-viewer">
                      {selectedFile ? (
                        <>
                          <div className="code-viewer-header">
                            <div className="code-viewer-title">
                              <code className="code-viewer-path">{selectedFile.filePath}</code>
                              <span>
                                {selectedFileKindLabel} file - {formatBytes(selectedFile.size)} - {selectedFile.ref}
                              </span>
                            </div>
                            <div className="code-viewer-actions">
                              {!selectedFile.binary ? (
                                <button
                                  className={`button button-secondary icon-button code-wrap-toggle${fileWordWrap ? " is-active" : ""}`}
                                  type="button"
                                  onClick={() => setFileWordWrap((current) => !current)}
                                  aria-label="Toggle word wrap"
                                  aria-pressed={fileWordWrap}
                                  title="Toggle word wrap (Alt+Z)"
                                >
                                  <WrapText size={16} aria-hidden="true" />
                                </button>
                              ) : null}
                              <span className="code-entry-badge">{fileExtBadge(selectedFile.fileName)}</span>
                            </div>
                          </div>
                          {selectedFile.binary ? (
                            selectedFileImageMimeType ? (
                              imagePreviewLoading ? (
                                <LoadingState title="Loading image preview" detail="Fetching the repository image through authenticated GitLab access." />
                              ) : imagePreviewUrl ? (
                                <div className="code-image-preview">
                                  <img src={imagePreviewUrl} alt={selectedFile.fileName} />
                                </div>
                              ) : (
                                <EmptyState
                                  title="Image preview unavailable"
                                  detail={imagePreviewError ?? "Open the repository in GitLab to inspect this image."}
                                />
                              )
                            ) : (
                              <EmptyState title="Binary preview unavailable" detail="Open the repository in GitLab to inspect this file." />
                            )
                          ) : (
                            <pre className={`code-file-content${fileWordWrap ? " code-file-content-wrap" : ""}`}>{selectedFile.content}</pre>
                          )}
                        </>
                      ) : contentLoading ? (
                        <LoadingState title="Loading repository files" detail="Preparing the file tree and preview surface." />
                      ) : (
                        <EmptyState title="Select a file" detail="Choose a file from the tree to inspect its contents in this workspace." />
                      )}
                    </section>
                  </div>
                ) : null}

                {activeTab === "commits" ? (
                  <section className="panel code-mode-panel">
                    <div className="code-mode-header">
                      <div>
                        <p className="eyebrow">Commits</p>
                        <h3 className="section-heading">Recent history</h3>
                      </div>
                      {contentLoading ? <span className="code-inline-status">Loading</span> : null}
                    </div>
                    {commits.length === 0 && !contentLoading ? <EmptyState title="No commits available" detail="This branch does not expose commits through GitLab yet." /> : null}
                    <div className="code-commit-list">
                      {commits.map((commit) => (
                        <article key={commit.id} className="code-commit-row">
                          <div className="code-commit-avatar" aria-hidden="true">{authorInitials(commit.authorName)}</div>
                          <div className="code-commit-body stack-xs">
                            <strong className="code-commit-title">{commit.title}</strong>
                            <p className="text-muted code-commit-meta">
                              {commit.authorName}
                              <span className="code-commit-dot">-</span>
                              {relativeDate(commit.authoredDate)}
                            </p>
                          </div>
                          <div className="code-commit-actions">
                            <code className="code-short-id">{commit.shortId}</code>
                            {commit.webUrl ? <a className="button button-secondary" href={commit.webUrl} target="_blank" rel="noreferrer">Open</a> : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeTab === "branches" ? (
                  <section className="panel code-mode-panel">
                    <div className="code-mode-header">
                      <div>
                        <p className="eyebrow">Branches</p>
                        <h3 className="section-heading">Repository refs</h3>
                      </div>
                      {contentLoading ? <span className="code-inline-status">Loading</span> : null}
                    </div>
                    <div className="code-branch-list">
                      {branches.map((branch) => (
                        <div key={branch.name} className="code-branch-row">
                          <div className="stack-xs">
                            <strong>{branch.name}</strong>
                            <div className="button-row">
                              {branch.default ? <span className="badge">Default</span> : null}
                              {branch.protected ? <span className="badge">Protected</span> : null}
                              {branch.canPush ? <span className="badge">Writable</span> : null}
                            </div>
                          </div>
                          {branch.webUrl ? <a className="button button-secondary" href={branch.webUrl} target="_blank" rel="noreferrer">Open</a> : null}
                        </div>
                      ))}
                      {branches.length === 0 && !contentLoading ? <EmptyState title="No branches found" detail="GitLab did not return repository branches for this project." /> : null}
                    </div>
                    {!canWrite ? <StatusLine tone="info">Reader role can browse repository content but cannot create branches.</StatusLine> : null}
                  </section>
                ) : null}

                {activeTab === "merge-requests" ? (
                  <section className="panel code-mode-panel">
                    <div className="code-mode-header">
                      <div>
                        <p className="eyebrow">Merge requests</p>
                        <h3 className="section-heading">Review queue</h3>
                      </div>
                      {mergeRequestsLoading ? <span className="code-inline-status">Loading</span> : null}
                    </div>
                    {mergeRequestsError ? <StatusLine tone="error">{mergeRequestsError}</StatusLine> : null}
                    <div className="code-mr-list">
                      {mergeRequests.map((mr) => (
                        <article key={mr.id} className="code-mr-row">
                          <div className="code-mr-number text-muted">!{mr.iid}</div>
                          <div className="code-mr-body stack-xs">
                            <strong>{mr.title}</strong>
                            <div className="button-row">
                              <span className={`badge code-mr-state-${mr.state}`}>{mr.state}</span>
                              {mr.draft ? <span className="badge">Draft</span> : null}
                            </div>
                            <p className="text-muted code-mr-meta">
                              <span className="code-mr-branches">{mr.sourceBranch} - {mr.targetBranch}</span>
                              <span className="code-commit-dot">-</span>
                              {mr.author ? mr.author.name : "Unknown"}
                              <span className="code-commit-dot">-</span>
                              {relativeDate(mr.updatedAt)}
                            </p>
                          </div>
                          <a className="button button-secondary" href={mr.webUrl} target="_blank" rel="noreferrer">Open</a>
                        </article>
                      ))}
                      {!mergeRequestsLoading && mergeRequests.length === 0 ? <EmptyState title="No merge requests" detail="No merge requests match the selected state." /> : null}
                    </div>
                    {!canWrite ? <StatusLine tone="info">Reader role can browse repository content but cannot create merge requests.</StatusLine> : null}
                  </section>
                ) : null}
              </>
            )}

            {cloneDrawerOpen ? (
              <div className="code-clone-drawer-backdrop" role="presentation" onClick={() => setCloneDrawerOpen(false)}>
                <aside className="code-clone-drawer" role="dialog" aria-modal="true" aria-label="Clone repository" onClick={(event) => event.stopPropagation()}>
                  <div className="code-clone-drawer-header">
                    <div>
                      <p className="eyebrow">Repository access</p>
                      <h2 className="section-heading">Clone</h2>
                    </div>
                    <IconButton label="Close clone drawer" onClick={() => setCloneDrawerOpen(false)}>
                      <X size={16} aria-hidden="true" />
                    </IconButton>
                  </div>
                  <div className="code-clone-drawer-body">
                    <div className="code-clone-row">
                      <span className="code-clone-label">SSH</span>
                      <input className="input code-clone-input" value={connectedRepository.sshCloneUrl} readOnly aria-label="SSH clone URL" />
                      <button className="button button-secondary code-clone-copy" type="button" onClick={() => void onCopyCloneUrl(connectedRepository.sshCloneUrl, "ssh")}>
                        {copiedCloneType === "ssh" ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="code-clone-row">
                      <span className="code-clone-label code-clone-label-secondary">HTTPS</span>
                      <input className="input code-clone-input" value={connectedRepository.httpCloneUrl} readOnly aria-label="HTTPS clone URL" />
                      <button className="button button-secondary code-clone-copy" type="button" onClick={() => void onCopyCloneUrl(connectedRepository.httpCloneUrl, "https")}>
                        {copiedCloneType === "https" ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <StatusLine tone="info">
                      SSH is recommended. HTTPS can use your GitLab username and Atlasium password after enablement; PAT remains the fallback.
                    </StatusLine>
                    <div className="code-https-help">
                      <p className="eyebrow">Windows HTTPS login</p>
                      <code>{`git clone ${connectedRepository.httpCloneUrl.replace("https://", `https://${gitUsername || "<gitlab-username>"}@`)}`}</code>
                      <code>Enter your Atlasium password in Git Credential Manager</code>
                    </div>
                    <button type="button" className="button button-secondary" onClick={() => openAccountSettings("git")}>
                      Manage Git access
                    </button>
                  </div>
                </aside>
              </div>
            ) : null}

            {showBranchModal ? (
              <div className="code-mr-modal-backdrop" onClick={() => setShowBranchModal(false)} role="dialog" aria-modal="true" aria-label="Create branch">
                <div className="panel code-mr-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="code-mr-modal-header">
                    <h3 className="section-heading">Create branch</h3>
                    <IconButton label="Close create branch" onClick={() => setShowBranchModal(false)}>
                      <X size={16} aria-hidden="true" />
                    </IconButton>
                  </div>
                  <form className="form-grid" onSubmit={(event) => void onCreateBranch(event)}>
                    <label>
                      Branch name
                      <input className="input" value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} placeholder="feature/my-branch" required />
                    </label>
                    <label>
                      From ref
                      <select className="input" value={currentBranchSourceRef} onChange={(event) => setNewBranchSourceRef(event.target.value)}>
                        {branches.map((branch) => (
                          <option key={branch.name} value={branch.name}>{branch.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="code-mr-modal-footer">
                      <button type="button" className="button button-secondary" onClick={() => setShowBranchModal(false)}>Cancel</button>
                      <button className="button" type="submit" disabled={creatingBranch}>{creatingBranch ? "Creating..." : "Create branch"}</button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {showMRModal ? (
              <div className="code-mr-modal-backdrop" onClick={() => setShowMRModal(false)} role="dialog" aria-modal="true" aria-label="Create merge request">
                <div className="panel code-mr-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="code-mr-modal-header">
                    <h3 className="section-heading">Open merge request</h3>
                    <IconButton label="Close merge request" onClick={() => setShowMRModal(false)}>
                      <X size={16} aria-hidden="true" />
                    </IconButton>
                  </div>
                  <form className="form-grid" onSubmit={(event) => void onCreateMergeRequest(event)}>
                    <label>
                      Source branch
                      <select className="input" value={currentMergeRequestSourceBranch} onChange={(event) => setMergeRequestSourceBranch(event.target.value)}>
                        {branches.map((branch) => (
                          <option key={branch.name} value={branch.name}>{branch.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Target branch
                      <select className="input" value={currentMergeRequestTargetBranch} onChange={(event) => setMergeRequestTargetBranch(event.target.value)}>
                        {branches.map((branch) => (
                          <option key={branch.name} value={branch.name}>{branch.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Title
                      <input className="input" value={mergeRequestTitle} onChange={(event) => setMergeRequestTitle(event.target.value)} placeholder="Brief description of the changes" required />
                    </label>
                    <label>
                      Description
                      <textarea
                        className="input textarea-sm"
                        value={mergeRequestDescription}
                        onChange={(event) => setMergeRequestDescription(event.target.value)}
                        rows={4}
                        placeholder="Optional - explain what this MR does and why."
                      />
                    </label>
                    <div className="code-mr-modal-footer">
                      <button type="button" className="button button-secondary" onClick={() => setShowMRModal(false)}>Cancel</button>
                      <button className="button" type="submit" disabled={creatingMergeRequest}>{creatingMergeRequest ? "Creating..." : "Open merge request"}</button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {showRepositoryModal ? (
          <div className="code-mr-modal-backdrop" onClick={() => setShowRepositoryModal(false)} role="dialog" aria-modal="true" aria-label="Create repository">
            <div className="panel code-mr-modal" onClick={(event) => event.stopPropagation()}>
              <div className="code-mr-modal-header">
                <div>
                  <p className="eyebrow">Managed GitLab repository</p>
                  <h3 className="section-heading">New repository</h3>
                </div>
                <IconButton label="Close new repository" onClick={() => setShowRepositoryModal(false)}>
                  <X size={16} aria-hidden="true" />
                </IconButton>
              </div>
              <form className="form-grid" onSubmit={(event) => void onCreateRepository(event)}>
                <label>
                  Name
                  <input className="input" value={newRepositoryName} onChange={(event) => setNewRepositoryName(event.target.value)} placeholder="Analysis pipeline" required />
                </label>
                <label>
                  Path
                  <input className="input" value={newRepositoryPath} onChange={(event) => setNewRepositoryPath(event.target.value)} placeholder="analysis-pipeline" />
                </label>
                <label>
                  Description
                  <textarea
                    className="input textarea-sm"
                    value={newRepositoryDescription}
                    onChange={(event) => setNewRepositoryDescription(event.target.value)}
                    rows={3}
                    placeholder="Optional repository purpose."
                  />
                </label>
                <StatusLine tone="info">
                  GitLab path suffix: {newRepositoryPathPreview || "repository-name"}. Atlasium will prefix it with the project key.
                </StatusLine>
                <div className="code-mr-modal-footer">
                  <button type="button" className="button button-secondary" onClick={() => setShowRepositoryModal(false)}>Cancel</button>
                  <button className="button" type="submit" disabled={creatingRepository}>{creatingRepository ? "Creating..." : "Create repository"}</button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
