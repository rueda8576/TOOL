"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ProjectSubtitle } from "../../../../components/project-subtitle";
import {
  createProjectRepository,
  createRepositoryBranch,
  createRepositoryMergeRequest,
  downloadRepositoryArchive,
  ensureProjectRepositoryAccess,
  getGitlabConnectionStatus,
  getProjectRepositoryStatus,
  getRepositoryFile,
  getRepositoryTree,
  GitlabConnectionStatus,
  listRepositoryBranches,
  listRepositoryCommits,
  listRepositoryMergeRequests,
  ProjectRepositoryStatus,
  RepositoryBranch,
  RepositoryCommit,
  RepositoryFile,
  RepositoryMergeRequest,
  RepositoryMergeRequestState,
  RepositoryTree
} from "../../../../lib/gitlab";
import { getProjectAccess, ProjectAccess } from "../../../../lib/project-access";

type CodeTab = "files" | "commits" | "branches" | "merge-requests";

function parentPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const segments = trimmed.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
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

export default function ProjectCodePage({ params }: { params: { projectId: string } }): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [connection, setConnection] = useState<GitlabConnectionStatus | null>(null);
  const [repository, setRepository] = useState<ProjectRepositoryStatus | null>(null);
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [tree, setTree] = useState<RepositoryTree | null>(null);
  const [selectedFile, setSelectedFile] = useState<RepositoryFile | null>(null);
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

  const canWrite = access?.canWrite ?? false;
  const isAdmin = access?.isAdmin ?? false;
  const repositoryConnected = repository?.connected === true;
  const gitlabConnected = connection?.connected === true && !connection.reconnectRequired;
  const connectedRepository = repositoryConnected ? repository : null;
  const currentBrowseRef = connectedRepository ? browserRef || connectedRepository.defaultBranch : "";
  const currentBranchSourceRef = newBranchSourceRef || currentBrowseRef;
  const currentMergeRequestTargetBranch = connectedRepository
    ? mergeRequestTargetBranch || connectedRepository.defaultBranch
    : "";
  const currentMergeRequestSourceBranch =
    mergeRequestSourceBranch || branches.find((branch) => !branch.default)?.name || currentBrowseRef;

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

  const loadRepository = useCallback(
    async (authToken: string): Promise<ProjectRepositoryStatus> => {
      const nextRepository = await getProjectRepositoryStatus(params.projectId, authToken);
      setRepository(nextRepository);
      return nextRepository;
    },
    [params.projectId]
  );

  const loadRepositoryContent = useCallback(
    async (
      authToken: string,
      nextRepository: Extract<ProjectRepositoryStatus, { connected: true }>,
      paramsOverride: { ref?: string; path?: string } = {}
    ): Promise<void> => {
      setContentLoading(true);
      try {
        const resolvedRef = paramsOverride.ref?.trim() || nextRepository.defaultBranch;
        const resolvedPath = paramsOverride.path?.trim() || "";
        const [nextBranches, nextCommits, nextTree] = await Promise.all([
          listRepositoryBranches(params.projectId, authToken),
          listRepositoryCommits(params.projectId, authToken, { ref: resolvedRef }),
          getRepositoryTree(params.projectId, authToken, { ref: resolvedRef, path: resolvedPath })
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
    async (authToken: string, state: RepositoryMergeRequestState): Promise<void> => {
      setMergeRequestsLoading(true);
      try {
        const nextMergeRequests = await listRepositoryMergeRequests(params.projectId, authToken, { state });
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
    setLoading(true);
    Promise.all([loadAccess(storedToken), loadConnection(storedToken), loadRepository(storedToken)])
      .then(() => { setError(null); })
      .catch((loadError) => { setError((loadError as Error).message || "Unable to load Code workspace."); })
      .finally(() => { setLoading(false); });
  }, [loadAccess, loadConnection, loadRepository, router]);

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
    void loadMergeRequests(token, mergeRequestFilter);
  }, [connectedRepository, gitlabConnected, loadMergeRequests, mergeRequestFilter, token]);

  useEffect(() => {
    setSelectedFile(null);
  }, [browserPath, currentBrowseRef]);

  const onCreateRepository = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    setCreatingRepository(true);
    setError(null);
    setSuccess(null);
    try {
      const nextRepository = await createProjectRepository(params.projectId, token);
      setRepository(nextRepository);
      setBrowserPath("");
      setBrowserRef(nextRepository.connected ? nextRepository.defaultBranch : "");
      setNewBranchSourceRef("");
      setMergeRequestSourceBranch("");
      setMergeRequestTargetBranch("");
      if (nextRepository.connected) {
        await Promise.all([
          loadRepositoryContent(token, nextRepository, { ref: nextRepository.defaultBranch, path: "" }),
          loadMergeRequests(token, mergeRequestFilter)
        ]);
      }
      setSuccess("Managed repository provisioned.");
    } catch (createError) {
      setError((createError as Error).message || "Unable to provision the repository.");
    } finally {
      setCreatingRepository(false);
    }
  };

  const onOpenEntry = async (entry: RepositoryTree["entries"][number]): Promise<void> => {
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    if (entry.type === "tree") {
      setBrowserPath(entry.path);
      return;
    }
    setContentLoading(true);
    setContentError(null);
    try {
      const file = await getRepositoryFile(params.projectId, token, {
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
      const archive = await downloadRepositoryArchive(params.projectId, token, {
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
      const nextRepository = await ensureProjectRepositoryAccess(params.projectId, token);
      setRepository(nextRepository);
      if (!nextRepository.connected) {
        setError("This project repository is not provisioned yet.");
        return;
      }
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
    setCreatingBranch(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createRepositoryBranch(params.projectId, token, {
        name: newBranchName.trim(),
        sourceRef: currentBranchSourceRef.trim()
      });
      setNewBranchName("");
      setBrowserRef(created.name);
      setNewBranchSourceRef(created.name);
      setMergeRequestSourceBranch(created.name);
      const nextRepository = await loadRepository(token);
      if (nextRepository.connected) {
        await loadRepositoryContent(token, nextRepository, { ref: created.name, path: browserPath });
      }
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
    setCreatingMergeRequest(true);
    setError(null);
    setSuccess(null);
    try {
      const mergeRequest = await createRepositoryMergeRequest(params.projectId, token, {
        sourceBranch: currentMergeRequestSourceBranch.trim(),
        targetBranch: currentMergeRequestTargetBranch.trim(),
        title: mergeRequestTitle.trim(),
        description: mergeRequestDescription.trim() || undefined
      });
      setMergeRequestTitle("");
      setMergeRequestDescription("");
      setShowMRModal(false);
      await loadMergeRequests(token, mergeRequestFilter);
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
    <AppShell title="Code" subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Code" />} projectId={params.projectId}>
      <div className="stack-lg">
        {loading ? <p className="alert alert-info">Loading Code workspace...</p> : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
        {success ? <p className="alert alert-success">{success}</p> : null}

        {/* Repository not provisioned */}
        {!loading && !repositoryConnected ? (
          <section className="panel stack-lg">
            <div className="stack-sm">
              <h2 className="section-heading">Managed repository not provisioned yet</h2>
              <p>
                {isAdmin
                  ? "Atlasium provisions one managed GitLab repository per project. Provision it here if the automatic setup did not complete."
                  : "An administrator has not provisioned the managed GitLab repository for this project yet."}
              </p>
            </div>
            {isAdmin ? (
              <section className="panel panel-subtle stack-md">
                <div className="stack-xs">
                  <h3 className="section-heading">Provision managed repository</h3>
                  <p>This will create the GitLab repository inside the Atlasium-managed group and register it with this project.</p>
                </div>
                <form className="form-grid" onSubmit={(event) => void onCreateRepository(event)}>
                  <button className="button" type="submit" disabled={creatingRepository}>
                    {creatingRepository ? "Provisioning..." : "Provision repository"}
                  </button>
                </form>
              </section>
            ) : null}
          </section>
        ) : null}

        {/* Connected repository */}
        {!loading && connectedRepository ? (
          <>
            {/* Compact overview card */}
            <section className="panel code-overview-card">
              <div className="stack-xs code-overview-info">
                <p className="eyebrow">{connectedRepository.pathWithNamespace}</p>
                <h2 className="section-heading">{connectedRepository.name}</h2>
                {connectedRepository.description ? (
                  <p>{connectedRepository.description}</p>
                ) : (
                  <p className="text-muted">No repository description.</p>
                )}
                <div className="button-row">
                  <span className="badge">{connectedRepository.visibility}</span>
                  {connectedRepository.managed ? <span className="badge">Managed</span> : null}
                  <span className="badge">Default: {connectedRepository.defaultBranch}</span>
                </div>
              </div>

              <div className="code-overview-side stack-md">
                <div className="stack-sm">
                  <div className="code-clone-row">
                    <span className="code-clone-label">SSH</span>
                    <input
                      className="input code-clone-input"
                      value={connectedRepository.sshCloneUrl}
                      readOnly
                      aria-label="SSH clone URL"
                    />
                    <button
                      className="button button-secondary code-clone-copy"
                      type="button"
                      onClick={() => void onCopyCloneUrl(connectedRepository.sshCloneUrl, "ssh")}
                    >
                      {copiedCloneType === "ssh" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="code-clone-row">
                    <span className="code-clone-label code-clone-label-secondary">HTTPS</span>
                    <input
                      className="input code-clone-input"
                      value={connectedRepository.httpCloneUrl}
                      readOnly
                      aria-label="HTTPS clone URL"
                    />
                    <button
                      className="button button-secondary code-clone-copy"
                      type="button"
                      onClick={() => void onCopyCloneUrl(connectedRepository.httpCloneUrl, "https")}
                    >
                      {copiedCloneType === "https" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-muted" style={{ fontSize: "0.78rem" }}>
                    SSH recommended. HTTPS can use Git Credential Manager browser login with Atlasium SSO; PAT remains the fallback.{" "}
                    <Link href="/account">Manage SSH keys →</Link>
                  </p>
                  <div className="code-https-help">
                    <p className="eyebrow">Windows HTTPS setup</p>
                    <code>git config --global credential.git.atlasium.info.provider gitlab</code>
                    <code>git config --global credential.gitLabAuthModes browser</code>
                  </div>
                </div>
                <div className="button-row">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void onOpenInGitlab()}
                    disabled={openingGitlab}
                  >
                    {openingGitlab ? "Opening..." : "Open in GitLab"}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void onDownloadArchive()}
                    disabled={downloadingArchive || !gitlabConnected}
                    title={!gitlabConnected ? "Connect GitLab API access to download ZIP archives" : undefined}
                  >
                    {downloadingArchive ? "Downloading..." : "Download ZIP"}
                  </button>
                </div>
              </div>
            </section>

            {/* GitLab not connected banner */}
            {!gitlabConnected ? (
              <p className="alert alert-info">
                {connectStateMessage}{" "}
                <Link href="/account">Connect account →</Link>
              </p>
            ) : (
              <>
                {/* Tab navigation */}
                <nav className="code-tabs" aria-label="Repository sections">
                  {(["files", "commits", "branches", "merge-requests"] as CodeTab[]).map((tab) => {
                    const labels: Record<CodeTab, string> = {
                      files: "Files",
                      commits: "Commits",
                      branches: "Branches",
                      "merge-requests": "Merge Requests",
                    };
                    const counts: Partial<Record<CodeTab, number>> = {
                      branches: branches.length || undefined,
                      "merge-requests": mergeRequests.length || undefined,
                    };
                    return (
                      <button
                        key={tab}
                        type="button"
                        className={`code-tab${activeTab === tab ? " active" : ""}`}
                        onClick={() => setActiveTab(tab)}
                      >
                        {labels[tab]}
                        {counts[tab] ? <span className="code-tab-count">{counts[tab]}</span> : null}
                      </button>
                    );
                  })}
                </nav>

                {/* Branch selector — shared for Files and Commits tabs */}
                {(activeTab === "files" || activeTab === "commits") && branches.length > 0 ? (
                  <div className="code-ref-bar">
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
                  </div>
                ) : null}

                {/* ── FILES TAB ── */}
                {activeTab === "files" ? (
                  <div className="code-files-layout">
                    {/* File tree panel */}
                    <div className="panel code-file-tree-panel stack-sm">
                      {/* Breadcrumb */}
                      <div className="code-breadcrumb">
                        <button
                          type="button"
                          className="code-breadcrumb-btn"
                          onClick={() => { setBrowserPath(""); setSelectedFile(null); }}
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
                              onClick={() => { setBrowserPath(path); setSelectedFile(null); }}
                            >
                              {label}
                            </button>
                          </span>
                        ))}
                      </div>

                      {contentLoading && !tree ? (
                        <p className="alert alert-info">Loading...</p>
                      ) : null}
                      {contentError ? <p className="alert alert-error">{contentError}</p> : null}

                      <div className="code-tree-list">
                        {tree?.entries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className={`code-tree-entry${entry.type === "tree" ? " is-dir" : ""}`}
                            onClick={() => void onOpenEntry(entry)}
                          >
                            <span className="code-entry-icon" aria-hidden="true">
                              {entry.type === "tree" ? "▸" : ""}
                            </span>
                            <span className="code-entry-name">{entry.name}</span>
                            {entry.type === "blob" ? (
                              <span className="code-entry-badge">{fileExtBadge(entry.name)}</span>
                            ) : null}
                          </button>
                        ))}
                        {tree && tree.entries.length === 0 ? (
                          <p className="text-muted" style={{ padding: "0.5rem 0" }}>This folder is empty.</p>
                        ) : null}
                      </div>
                    </div>

                    {/* File viewer panel */}
                    <div className="panel code-file-viewer-panel">
                      {contentLoading && selectedFile === null ? (
                        <p className="alert alert-info">Loading file...</p>
                      ) : selectedFile ? (
                        <>
                          <div className="code-viewer-header">
                            <code className="code-viewer-path">{selectedFile.filePath}</code>
                          </div>
                          {selectedFile.binary ? (
                            <p className="alert alert-info">Binary file — preview not supported.</p>
                          ) : (
                            <pre className="code-file-content">{selectedFile.content}</pre>
                          )}
                        </>
                      ) : (
                        <div className="code-viewer-empty">
                          <p className="text-muted">Select a file from the tree to view its contents.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* ── COMMITS TAB ── */}
                {activeTab === "commits" ? (
                  <section className="panel stack-md">
                    {contentLoading && commits.length === 0 ? (
                      <p className="alert alert-info">Loading commits...</p>
                    ) : null}
                    {commits.length === 0 && !contentLoading ? (
                      <p className="text-muted">No commits available for this branch.</p>
                    ) : null}
                    <div className="code-commit-list">
                      {commits.map((commit) => (
                        <article key={commit.id} className="code-commit-row">
                          <div className="code-commit-avatar" aria-hidden="true">
                            {authorInitials(commit.authorName)}
                          </div>
                          <div className="code-commit-body stack-xs">
                            <strong className="code-commit-title">{commit.title}</strong>
                            <p className="text-muted code-commit-meta">
                              {commit.authorName}
                              <span className="code-commit-dot">·</span>
                              {relativeDate(commit.authoredDate)}
                            </p>
                          </div>
                          <div className="code-commit-actions">
                            <code className="code-short-id">{commit.shortId}</code>
                            {commit.webUrl ? (
                              <a
                                className="button button-secondary"
                                href={commit.webUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open
                              </a>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {/* ── BRANCHES TAB ── */}
                {activeTab === "branches" ? (
                  <section className="panel stack-lg">
                    {contentLoading && branches.length === 0 ? (
                      <p className="alert alert-info">Loading branches...</p>
                    ) : null}

                    <div className="code-branch-list">
                      {branches.map((branch) => (
                        <div key={branch.name} className="code-branch-row">
                          <div className="stack-xs">
                            <strong>{branch.name}</strong>
                            <div className="button-row">
                              {branch.default ? <span className="badge">Default</span> : null}
                              {branch.protected ? <span className="badge">Protected</span> : null}
                            </div>
                          </div>
                          {branch.webUrl ? (
                            <a className="button button-secondary" href={branch.webUrl} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : null}
                        </div>
                      ))}
                      {branches.length === 0 && !contentLoading ? (
                        <p className="text-muted">No branches found.</p>
                      ) : null}
                    </div>

                    {canWrite ? (
                      <div className="panel panel-subtle stack-md">
                        <h3 className="section-heading">Create branch</h3>
                        <form className="form-grid" onSubmit={(event) => void onCreateBranch(event)}>
                          <label>
                            Branch name
                            <input
                              className="input"
                              value={newBranchName}
                              onChange={(event) => setNewBranchName(event.target.value)}
                              placeholder="feature/my-branch"
                              required
                            />
                          </label>
                          <label>
                            From ref
                            <select
                              className="input"
                              value={currentBranchSourceRef}
                              onChange={(event) => setNewBranchSourceRef(event.target.value)}
                            >
                              {branches.map((branch) => (
                                <option key={branch.name} value={branch.name}>
                                  {branch.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button className="button" type="submit" disabled={creatingBranch}>
                            {creatingBranch ? "Creating..." : "Create branch"}
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {/* ── MERGE REQUESTS TAB ── */}
                {activeTab === "merge-requests" ? (
                  <section className="stack-md">
                    <div className="code-mr-toolbar">
                      <label className="code-filter-label">
                        State
                        <select
                          className="input"
                          value={mergeRequestFilter}
                          onChange={(event) => setMergeRequestFilter(event.target.value as RepositoryMergeRequestState)}
                        >
                          <option value="opened">Opened</option>
                          <option value="merged">Merged</option>
                          <option value="closed">Closed</option>
                          <option value="all">All</option>
                        </select>
                      </label>
                      {canWrite ? (
                        <button
                          className="button"
                          type="button"
                          onClick={() => setShowMRModal(true)}
                        >
                          + Create MR
                        </button>
                      ) : null}
                    </div>

                    {mergeRequestsError ? <p className="alert alert-error">{mergeRequestsError}</p> : null}

                    <div className="panel stack-md">
                      {mergeRequestsLoading && mergeRequests.length === 0 ? (
                        <p className="alert alert-info">Loading merge requests...</p>
                      ) : null}

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
                                <span className="code-mr-branches">
                                  {mr.sourceBranch} → {mr.targetBranch}
                                </span>
                                <span className="code-commit-dot">·</span>
                                {mr.author ? mr.author.name : "Unknown"}
                                <span className="code-commit-dot">·</span>
                                {relativeDate(mr.updatedAt)}
                              </p>
                            </div>
                            <a className="button button-secondary" href={mr.webUrl} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          </article>
                        ))}
                        {!mergeRequestsLoading && mergeRequests.length === 0 ? (
                          <p className="text-muted">No merge requests for the selected state.</p>
                        ) : null}
                      </div>

                      {!canWrite ? (
                        <p className="alert alert-info">
                          Reader role can browse repository content but cannot create branches or merge requests.
                        </p>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {/* ── CREATE MR MODAL ── */}
                {showMRModal ? (
                  <div
                    className="code-mr-modal-backdrop"
                    onClick={() => setShowMRModal(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Create merge request"
                  >
                    <div className="panel code-mr-modal" onClick={(e) => e.stopPropagation()}>
                      <div className="code-mr-modal-header">
                        <h3 className="section-heading">Open merge request</h3>
                        <button
                          type="button"
                          className="button button-ghost code-mr-modal-close"
                          onClick={() => setShowMRModal(false)}
                          aria-label="Close"
                        >
                          ✕
                        </button>
                      </div>
                      <form className="form-grid" onSubmit={(event) => void onCreateMergeRequest(event)}>
                        <label>
                          Source branch
                          <select
                            className="input"
                            value={currentMergeRequestSourceBranch}
                            onChange={(event) => setMergeRequestSourceBranch(event.target.value)}
                          >
                            {branches.map((branch) => (
                              <option key={branch.name} value={branch.name}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Target branch
                          <select
                            className="input"
                            value={currentMergeRequestTargetBranch}
                            onChange={(event) => setMergeRequestTargetBranch(event.target.value)}
                          >
                            {branches.map((branch) => (
                              <option key={branch.name} value={branch.name}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Title
                          <input
                            className="input"
                            value={mergeRequestTitle}
                            onChange={(event) => setMergeRequestTitle(event.target.value)}
                            placeholder="Brief description of the changes"
                            required
                          />
                        </label>
                        <label>
                          Description
                          <textarea
                            className="textarea"
                            value={mergeRequestDescription}
                            onChange={(event) => setMergeRequestDescription(event.target.value)}
                            rows={4}
                            placeholder="Optional — explain what this MR does and why."
                          />
                        </label>
                        <div className="code-mr-modal-footer">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => setShowMRModal(false)}
                          >
                            Cancel
                          </button>
                          <button className="button" type="submit" disabled={creatingMergeRequest}>
                            {creatingMergeRequest ? "Creating..." : "Open merge request"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
