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

function parentPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }

  const segments = trimmed.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
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
  const [copiedCloneType, setCopiedCloneType] = useState<"ssh" | "https" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [mergeRequestsError, setMergeRequestsError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      .then(() => {
        setError(null);
      })
      .catch((loadError) => {
        setError((loadError as Error).message || "Unable to load Code workspace.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadAccess, loadConnection, loadRepository, router]);

  useEffect(() => {
    if (!token || !connectedRepository || !gitlabConnected) {
      if (!connectedRepository || !gitlabConnected) {
        resetRepositoryWorkspace();
      }
      return;
    }

    void loadRepositoryContent(token, connectedRepository, {
      ref: currentBrowseRef,
      path: browserPath
    });
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
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

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
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

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
    if (!connectedRepository) {
      return;
    }
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }
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

  const onCreateBranch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

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
        await loadRepositoryContent(token, nextRepository, {
          ref: created.name,
          path: browserPath
        });
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
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

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
      return "Connect your GitLab API access from Account before browsing repository content, downloading ZIP archives, or working with merge requests. SSH clone remains available once your GitLab account has an SSH key configured.";
    }
    if (connection.reconnectRequired) {
      return "Your GitLab API session must be reconnected before Atlasium can browse the managed repository, download archives, or manage merge requests.";
    }
    return null;
  }, [connection]);

  return (
    <AppShell title="Code" subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Code" />} projectId={params.projectId}>
      <div className="stack-lg">
        {loading ? <p className="alert alert-info">Loading Code workspace...</p> : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
        {success ? <p className="alert alert-success">{success}</p> : null}
        {contentError ? <p className="alert alert-error">{contentError}</p> : null}

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

        {!loading && connectedRepository ? (
          <>
            <section className="panel code-overview-card">
              <div className="stack-xs">
                <p className="eyebrow">{connectedRepository.pathWithNamespace}</p>
                <h2 className="section-heading">{connectedRepository.name}</h2>
                {connectedRepository.description ? (
                  <p>{connectedRepository.description}</p>
                ) : (
                  <p className="text-muted">No repository description.</p>
                )}
              </div>

              <div className="stack-md code-overview-side">
                <div className="button-row code-overview-actions">
                  <span className="badge">{connectedRepository.visibility}</span>
                  {connectedRepository.managed ? <span className="badge">Managed</span> : null}
                  <span className="badge">Default: {connectedRepository.defaultBranch}</span>
                  <a className="button button-secondary" href={connectedRepository.webUrl} target="_blank" rel="noreferrer">
                    Open in GitLab
                  </a>
                </div>

                <section className="panel panel-subtle stack-sm code-clone-panel">
                  <div className="stack-xs">
                    <h3 className="section-heading">Clone &amp; Download</h3>
                    <p className="text-muted">
                      GitLab web uses Atlasium SSO. CLI clone uses SSH keys.
                    </p>
                    <p className="text-muted">
                      Manage your SSH keys from <Link href="/account">Account</Link>. Use HTTPS only as a fallback with a GitLab personal access token.
                    </p>
                  </div>
                  <div className="code-clone-method-grid">
                    <section className="panel stack-sm code-clone-method code-clone-method-primary">
                      <div className="stack-xs">
                        <p className="eyebrow">Primary</p>
                        <h4 className="section-heading">SSH clone</h4>
                        <p className="text-muted">Recommended for daily `git clone`, `pull`, and `push` from your local machine.</p>
                      </div>
                      <label>
                        SSH clone URL
                        <input className="input code-clone-input" value={connectedRepository.sshCloneUrl} readOnly />
                      </label>
                      <button
                        className="button"
                        type="button"
                        onClick={() => void onCopyCloneUrl(connectedRepository.sshCloneUrl, "ssh")}
                      >
                        {copiedCloneType === "ssh" ? "Copied" : "Copy SSH clone URL"}
                      </button>
                    </section>

                    <section className="panel stack-sm code-clone-method">
                      <div className="stack-xs">
                        <p className="eyebrow">Fallback</p>
                        <h4 className="section-heading">HTTPS (PAT required)</h4>
                        <p className="text-muted">Use this only if SSH is unavailable. GitLab will ask for a personal access token, not your Atlasium password.</p>
                      </div>
                      <label>
                        HTTPS clone URL
                        <input className="input code-clone-input" value={connectedRepository.httpCloneUrl} readOnly />
                      </label>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => void onCopyCloneUrl(connectedRepository.httpCloneUrl, "https")}
                      >
                        {copiedCloneType === "https" ? "Copied" : "Copy HTTPS clone URL"}
                      </button>
                    </section>
                  </div>
                  <div className="button-row">
                    <button
                      className="button"
                      type="button"
                      onClick={() => void onDownloadArchive()}
                      disabled={downloadingArchive || !gitlabConnected}
                    >
                      {downloadingArchive ? "Downloading..." : "Download ZIP"}
                    </button>
                    {!gitlabConnected ? <span className="text-muted">Connect GitLab API access to enable ZIP downloads.</span> : null}
                  </div>
                </section>
              </div>
            </section>

            {!gitlabConnected ? (
              <section className="panel stack-md">
                <h2 className="section-heading">GitLab API access required</h2>
                <p>{connectStateMessage}</p>
                <div className="button-row">
                  <Link className="button" href="/account">
                    Open Account
                  </Link>
                </div>
              </section>
            ) : (
              <>
                <div className="code-actions-grid">
                  <section className="panel stack-md">
                    <div className="stack-xs">
                      <h3 className="section-heading">Branches</h3>
                      <p>Current branch view and branch management.</p>
                    </div>
                    <label>
                      Browse ref
                      <select className="input" value={currentBrowseRef} onChange={(event) => setBrowserRef(event.target.value)}>
                        {branches.map((branch) => (
                          <option key={branch.name} value={branch.name}>
                            {branch.name}
                            {branch.default ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
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
                    </div>
                    {canWrite ? (
                      <form className="form-grid" onSubmit={(event) => void onCreateBranch(event)}>
                        <label>
                          New branch name
                          <input className="input" value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} required />
                        </label>
                        <label>
                          Source ref
                          <select className="input" value={currentBranchSourceRef} onChange={(event) => setNewBranchSourceRef(event.target.value)}>
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
                    ) : null}
                  </section>

                  <section className="panel stack-md">
                    <div className="stack-xs">
                      <h3 className="section-heading">Open merge request</h3>
                      <p>Create a merge request in GitLab from the connected project.</p>
                    </div>
                    {canWrite ? (
                      <form className="form-grid" onSubmit={(event) => void onCreateMergeRequest(event)}>
                        <label>
                          Source branch
                          <select className="input" value={currentMergeRequestSourceBranch} onChange={(event) => setMergeRequestSourceBranch(event.target.value)}>
                            {branches.map((branch) => (
                              <option key={branch.name} value={branch.name}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Target branch
                          <select className="input" value={currentMergeRequestTargetBranch} onChange={(event) => setMergeRequestTargetBranch(event.target.value)}>
                            {branches.map((branch) => (
                              <option key={branch.name} value={branch.name}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Title
                          <input className="input" value={mergeRequestTitle} onChange={(event) => setMergeRequestTitle(event.target.value)} required />
                        </label>
                        <label>
                          Description
                          <textarea className="textarea" value={mergeRequestDescription} onChange={(event) => setMergeRequestDescription(event.target.value)} rows={4} />
                        </label>
                        <button className="button" type="submit" disabled={creatingMergeRequest}>
                          {creatingMergeRequest ? "Creating..." : "Open merge request"}
                        </button>
                      </form>
                    ) : (
                      <p className="alert alert-info">Reader role can browse repository content but cannot create branches or merge requests.</p>
                    )}
                  </section>
                </div>

                <section className="panel stack-md">
                  <div className="toolbar-row code-section-toolbar">
                    <div className="stack-xs">
                      <h3 className="section-heading">Merge requests</h3>
                      <p className="text-muted">Track GitLab merge requests for this managed repository.</p>
                    </div>
                    <label className="code-filter-control">
                      State
                      <select className="input" value={mergeRequestFilter} onChange={(event) => setMergeRequestFilter(event.target.value as RepositoryMergeRequestState)}>
                        <option value="opened">Opened</option>
                        <option value="merged">Merged</option>
                        <option value="closed">Closed</option>
                        <option value="all">All</option>
                      </select>
                    </label>
                  </div>

                  {mergeRequestsError ? <p className="alert alert-error">{mergeRequestsError}</p> : null}
                  {mergeRequestsLoading && mergeRequests.length === 0 ? <p className="alert alert-info">Loading merge requests...</p> : null}

                  <div className="code-results-list">
                    {mergeRequests.map((mergeRequest) => (
                      <article key={mergeRequest.id} className="code-result-card code-merge-request-card">
                        <div className="stack-xs">
                          <p className="eyebrow">!{mergeRequest.iid}</p>
                          <strong>{mergeRequest.title}</strong>
                          <div className="button-row">
                            <span className="badge">{mergeRequest.state}</span>
                            {mergeRequest.draft ? <span className="badge">Draft</span> : null}
                          </div>
                          <div className="stack-xs code-merge-request-meta">
                            <p>
                              {mergeRequest.sourceBranch} → {mergeRequest.targetBranch}
                            </p>
                            <p className="text-muted">
                              {mergeRequest.author ? `${mergeRequest.author.name} (@${mergeRequest.author.username})` : "Unknown author"} · {new Date(mergeRequest.updatedAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <a className="button button-secondary" href={mergeRequest.webUrl} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </article>
                    ))}
                    {!mergeRequestsLoading && mergeRequests.length === 0 ? (
                      <p className="text-muted">No merge requests available for the selected state.</p>
                    ) : null}
                  </div>
                </section>

                <section className="code-workspace-grid">
                  <div className="panel stack-md code-file-browser">
                    <div className="toolbar-row">
                      <div className="stack-xs">
                        <h3 className="section-heading">Files</h3>
                        <p className="text-muted">{tree?.path || "/"}</p>
                      </div>
                      {tree?.path ? (
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() => {
                            setBrowserPath(parentPath(tree.path));
                            setSelectedFile(null);
                          }}
                        >
                          Up
                        </button>
                      ) : null}
                    </div>
                    {contentLoading && !tree ? <p className="alert alert-info">Loading repository tree...</p> : null}
                    <div className="code-tree-list">
                      {tree?.entries.map((entry) => (
                        <button key={entry.id} type="button" className="code-tree-entry" onClick={() => void onOpenEntry(entry)}>
                          <span className="badge">{entry.type === "tree" ? "Dir" : "File"}</span>
                          <span>{entry.name}</span>
                        </button>
                      ))}
                      {tree && tree.entries.length === 0 ? <p className="text-muted">This folder is empty.</p> : null}
                    </div>
                  </div>

                  <div className="panel stack-md code-file-viewer">
                    <div className="stack-xs">
                      <h3 className="section-heading">Viewer</h3>
                      <p className="text-muted">{selectedFile?.filePath || "Select a file to inspect its contents."}</p>
                    </div>
                    {contentLoading && selectedFile === null ? <p className="alert alert-info">Loading file content...</p> : null}
                    {!selectedFile ? <p className="text-muted">No file selected.</p> : null}
                    {selectedFile?.binary ? <p className="alert alert-info">Binary file preview is not supported in Atlasium Code v1.</p> : null}
                    {selectedFile && !selectedFile.binary ? <pre className="code-file-content">{selectedFile.content}</pre> : null}
                  </div>

                  <div className="panel stack-md code-commit-list">
                    <div className="stack-xs">
                      <h3 className="section-heading">Recent commits</h3>
                      <p className="text-muted">Latest activity for {currentBrowseRef || connectedRepository.defaultBranch}.</p>
                    </div>
                    <div className="stack-sm">
                      {commits.map((commit) => (
                        <article key={commit.id} className="code-commit-card">
                          <div className="stack-xs">
                            <p className="eyebrow">{commit.shortId}</p>
                            <strong>{commit.title}</strong>
                            <p>{commit.authorName}</p>
                            <p className="text-muted">{new Date(commit.authoredDate).toLocaleString()}</p>
                          </div>
                          {commit.webUrl ? (
                            <a className="button button-secondary" href={commit.webUrl} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : null}
                        </article>
                      ))}
                      {commits.length === 0 ? <p className="text-muted">No commits available for this ref.</p> : null}
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
