"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ProjectSubtitle } from "../../../../components/project-subtitle";
import {
  createProjectRepository,
  createRepositoryBranch,
  createRepositoryMergeRequest,
  disconnectProjectRepository,
  getGitlabConnectionStatus,
  getProjectRepositoryStatus,
  getRepositoryFile,
  getRepositoryTree,
  GitlabConnectionStatus,
  GitlabSearchProject,
  linkProjectRepository,
  listRepositoryBranches,
  listRepositoryCommits,
  ProjectRepositoryStatus,
  RepositoryBranch,
  RepositoryCommit,
  RepositoryFile,
  RepositoryTree,
  searchGitlabProjects
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
  const [browserRef, setBrowserRef] = useState<string>("");
  const [browserPath, setBrowserPath] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GitlabSearchProject[]>([]);
  const [createRepoName, setCreateRepoName] = useState("");
  const [createRepoPath, setCreateRepoPath] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchSourceRef, setNewBranchSourceRef] = useState("");
  const [mergeRequestSourceBranch, setMergeRequestSourceBranch] = useState("");
  const [mergeRequestTargetBranch, setMergeRequestTargetBranch] = useState("");
  const [mergeRequestTitle, setMergeRequestTitle] = useState("");
  const [mergeRequestDescription, setMergeRequestDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [linkingProjectId, setLinkingProjectId] = useState<string | null>(null);
  const [creatingRepository, setCreatingRepository] = useState(false);
  const [disconnectingRepository, setDisconnectingRepository] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [creatingMergeRequest, setCreatingMergeRequest] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = access?.canWrite ?? false;
  const isAdmin = access?.isAdmin ?? false;
  const repositoryConnected = repository?.connected === true;
  const gitlabConnected = connection?.connected === true && !connection.reconnectRequired;

  const loadAccess = useCallback(async (authToken: string): Promise<ProjectAccess> => {
    const nextAccess = await getProjectAccess(params.projectId, authToken);
    setAccess(nextAccess);
    return nextAccess;
  }, [params.projectId]);

  const loadConnection = useCallback(async (authToken: string): Promise<GitlabConnectionStatus> => {
    const nextConnection = await getGitlabConnectionStatus(authToken);
    setConnection(nextConnection);
    return nextConnection;
  }, []);

  const loadRepository = useCallback(async (authToken: string): Promise<ProjectRepositoryStatus> => {
    const nextRepository = await getProjectRepositoryStatus(params.projectId, authToken);
    setRepository(nextRepository);
    return nextRepository;
  }, [params.projectId]);

  const loadRepositoryContent = useCallback(async (authToken: string, nextRepository: ProjectRepositoryStatus): Promise<void> => {
    if (!nextRepository.connected) {
      setBranches([]);
      setCommits([]);
      setTree(null);
      setSelectedFile(null);
      setBrowserRef("");
      setBrowserPath("");
      return;
    }

    setContentLoading(true);
    try {
      const resolvedRef = browserRef || nextRepository.defaultBranch;
      const [nextBranches, nextCommits, nextTree] = await Promise.all([
        listRepositoryBranches(params.projectId, authToken),
        listRepositoryCommits(params.projectId, authToken, { ref: resolvedRef }),
        getRepositoryTree(params.projectId, authToken, { ref: resolvedRef, path: browserPath })
      ]);
      setBranches(nextBranches);
      setCommits(nextCommits);
      setTree(nextTree);
      setContentError(null);

      if (!browserRef) {
        setBrowserRef(resolvedRef);
      }
      if (!newBranchSourceRef) {
        setNewBranchSourceRef(resolvedRef);
      }
      if (!mergeRequestTargetBranch) {
        setMergeRequestTargetBranch(nextRepository.defaultBranch);
      }
      const candidateSourceBranch = nextBranches.find((branch) => !branch.default)?.name ?? resolvedRef;
      if (!mergeRequestSourceBranch) {
        setMergeRequestSourceBranch(candidateSourceBranch);
      }
    } catch (loadError) {
      setContentError((loadError as Error).message || "Unable to load repository content.");
    } finally {
      setContentLoading(false);
    }
  }, [browserPath, browserRef, mergeRequestSourceBranch, mergeRequestTargetBranch, newBranchSourceRef, params.projectId]);

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    setLoading(true);
    Promise.all([loadAccess(storedToken), loadConnection(storedToken), loadRepository(storedToken)])
      .then(async ([, nextConnection, nextRepository]) => {
        setError(null);
        if (nextRepository.connected && nextConnection.connected && !nextConnection.reconnectRequired) {
          await loadRepositoryContent(storedToken, nextRepository);
        }
      })
      .catch((loadError) => {
        setError((loadError as Error).message || "Unable to load Code workspace.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadAccess, loadConnection, loadRepository, loadRepositoryContent, router]);

  useEffect(() => {
    if (!token || !repositoryConnected || !gitlabConnected) {
      return;
    }

    void loadRepositoryContent(token, repository as Extract<ProjectRepositoryStatus, { connected: true }>);
  }, [browserPath, browserRef, gitlabConnected, loadRepositoryContent, repository, repositoryConnected, token]);

  const onSearchProjects = async (): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const results = await searchGitlabProjects(token, searchQuery);
      setSearchResults(results);
    } catch (searchError) {
      setError((searchError as Error).message || "Unable to search GitLab projects.");
    } finally {
      setSearching(false);
    }
  };

  const onLinkRepository = async (gitlabProjectId: string): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    setLinkingProjectId(gitlabProjectId);
    setError(null);
    setSuccess(null);
    try {
      const nextRepository = await linkProjectRepository(params.projectId, token, { gitlabProjectId });
      setRepository(nextRepository);
      setBrowserPath("");
      setBrowserRef(nextRepository.connected ? nextRepository.defaultBranch : "");
      if (nextRepository.connected) {
        await loadRepositoryContent(token, nextRepository);
      }
      setSuccess("GitLab repository connected.");
    } catch (linkError) {
      setError((linkError as Error).message || "Unable to connect the repository.");
    } finally {
      setLinkingProjectId(null);
    }
  };

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
      const nextRepository = await createProjectRepository(params.projectId, token, {
        name: createRepoName.trim() || undefined,
        path: createRepoPath.trim() || undefined
      });
      setRepository(nextRepository);
      setCreateRepoName("");
      setCreateRepoPath("");
      setBrowserPath("");
      setBrowserRef(nextRepository.connected ? nextRepository.defaultBranch : "");
      if (nextRepository.connected) {
        await loadRepositoryContent(token, nextRepository);
      }
      setSuccess("GitLab repository created and connected.");
    } catch (createError) {
      setError((createError as Error).message || "Unable to create the repository.");
    } finally {
      setCreatingRepository(false);
    }
  };

  const onDisconnectRepository = async (): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (!window.confirm("Disconnect the GitLab repository from this project?")) {
      return;
    }

    setDisconnectingRepository(true);
    setError(null);
    setSuccess(null);
    try {
      await disconnectProjectRepository(params.projectId, token);
      setRepository({ connected: false });
      setBranches([]);
      setCommits([]);
      setTree(null);
      setSelectedFile(null);
      setBrowserPath("");
      setBrowserRef("");
      setSuccess("GitLab repository disconnected.");
    } catch (disconnectError) {
      setError((disconnectError as Error).message || "Unable to disconnect the repository.");
    } finally {
      setDisconnectingRepository(false);
    }
  };

  const onOpenEntry = async (entry: RepositoryTree["entries"][number]): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (entry.type === "tree") {
      setBrowserPath(entry.path);
      setSelectedFile(null);
      return;
    }

    setContentLoading(true);
    setContentError(null);
    try {
      const file = await getRepositoryFile(params.projectId, token, {
        filePath: entry.path,
        ref: browserRef || (repositoryConnected ? repository.defaultBranch : undefined)
      });
      setSelectedFile(file);
    } catch (fileError) {
      setContentError((fileError as Error).message || "Unable to load file content.");
    } finally {
      setContentLoading(false);
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
        sourceRef: newBranchSourceRef.trim()
      });
      setNewBranchName("");
      setMergeRequestSourceBranch(created.name);
      const nextRepository = await loadRepository(token);
      if (nextRepository.connected) {
        await loadRepositoryContent(token, nextRepository);
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
        sourceBranch: mergeRequestSourceBranch.trim(),
        targetBranch: mergeRequestTargetBranch.trim(),
        title: mergeRequestTitle.trim(),
        description: mergeRequestDescription.trim() || undefined
      });
      setMergeRequestTitle("");
      setMergeRequestDescription("");
      setSuccess(`Merge request !${mergeRequest.iid} created.`);
    } catch (mergeRequestError) {
      setError((mergeRequestError as Error).message || "Unable to create the merge request.");
    } finally {
      setCreatingMergeRequest(false);
    }
  };

  useEffect(() => {
    setSelectedFile(null);
  }, [browserPath, browserRef]);

  const connectStateMessage = useMemo(() => {
    if (!connection?.connected) {
      return "Connect your GitLab account from Account before using Code.";
    }
    if (connection.reconnectRequired) {
      return "Your GitLab session must be reconnected before Atlasium can access repositories.";
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

        {!loading && repositoryConnected && connectStateMessage ? (
          <section className="panel stack-md">
            <h2 className="section-heading">GitLab account required</h2>
            <p>{connectStateMessage}</p>
            <div className="button-row">
              <Link className="button" href="/account">
                Open Account
              </Link>
            </div>
          </section>
        ) : null}

        {!loading && !repositoryConnected ? (
          <section className="panel stack-lg">
            <div className="stack-sm">
              <h2 className="section-heading">No GitLab repository connected</h2>
              <p>
                {isAdmin
                  ? "Connect an existing GitLab project or create a new empty repository for this Atlasium project."
                  : "An administrator has not connected a GitLab repository for this project yet."}
              </p>
            </div>

            {isAdmin && !gitlabConnected ? (
              <div className="panel panel-subtle stack-sm">
                <p>You need a connected GitLab account before Atlasium can search or create repositories for this project.</p>
                <div className="button-row">
                  <Link className="button" href="/account">
                    Open Account
                  </Link>
                </div>
              </div>
            ) : null}

            {isAdmin && gitlabConnected ? (
              <div className="code-setup-grid">
                <section className="panel panel-subtle stack-md">
                  <div className="stack-xs">
                    <h3 className="section-heading">Connect existing repository</h3>
                    <p>Search the GitLab projects visible to your connected account.</p>
                  </div>
                  <div className="toolbar-row">
                    <input
                      className="input"
                      type="search"
                      value={searchQuery}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
                      placeholder="Search GitLab projects"
                    />
                    <button className="button button-secondary" type="button" onClick={() => void onSearchProjects()} disabled={searching}>
                      {searching ? "Searching..." : "Search"}
                    </button>
                  </div>
                  <div className="code-results-list">
                    {searchResults.length === 0 ? <p className="text-muted">No search results loaded yet.</p> : null}
                    {searchResults.map((project) => (
                      <article key={project.gitlabProjectId} className="code-result-card">
                        <div className="stack-xs">
                          <p className="eyebrow">{project.pathWithNamespace}</p>
                          <h4 className="section-heading">{project.name}</h4>
                          {project.description ? <p>{project.description}</p> : <p className="text-muted">No description</p>}
                        </div>
                        <div className="button-row">
                          <a className="button button-secondary" href={project.webUrl} target="_blank" rel="noreferrer">
                            Open in GitLab
                          </a>
                          <button
                            className="button"
                            type="button"
                            onClick={() => void onLinkRepository(project.gitlabProjectId)}
                            disabled={linkingProjectId === project.gitlabProjectId}
                          >
                            {linkingProjectId === project.gitlabProjectId ? "Connecting..." : "Connect"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="panel panel-subtle stack-md">
                  <div className="stack-xs">
                    <h3 className="section-heading">Create repository</h3>
                    <p>Create a new empty GitLab repository in the configured namespace.</p>
                  </div>
                  <form className="form-grid" onSubmit={(event) => void onCreateRepository(event)}>
                    <label>
                      Repository name
                      <input className="input" value={createRepoName} onChange={(event) => setCreateRepoName(event.target.value)} />
                    </label>
                    <label>
                      Repository path
                      <input className="input" value={createRepoPath} onChange={(event) => setCreateRepoPath(event.target.value)} />
                    </label>
                    <button className="button" type="submit" disabled={creatingRepository}>
                      {creatingRepository ? "Creating..." : "Create repository"}
                    </button>
                  </form>
                </section>
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && repositoryConnected && gitlabConnected ? (
          <>
            <section className="panel code-overview-card">
              <div className="stack-xs">
                <p className="eyebrow">{repository.pathWithNamespace}</p>
                <h2 className="section-heading">{repository.name}</h2>
                {repository.description ? <p>{repository.description}</p> : <p className="text-muted">No repository description.</p>}
              </div>
              <div className="button-row">
                <span className="badge">{repository.visibility}</span>
                <span className="badge">Default: {repository.defaultBranch}</span>
                <a className="button button-secondary" href={repository.webUrl} target="_blank" rel="noreferrer">
                  Open in GitLab
                </a>
                {isAdmin ? (
                  <button className="button button-danger" type="button" onClick={() => void onDisconnectRepository()} disabled={disconnectingRepository}>
                    {disconnectingRepository ? "Disconnecting..." : "Disconnect repo"}
                  </button>
                ) : null}
              </div>
            </section>

            <div className="code-actions-grid">
              <section className="panel stack-md">
                <div className="stack-xs">
                  <h3 className="section-heading">Branches</h3>
                  <p>Current branch view and branch management.</p>
                </div>
                <label>
                  Browse ref
                  <select className="input" value={browserRef} onChange={(event) => setBrowserRef(event.target.value)}>
                    {branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}{branch.default ? " (default)" : ""}
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
                      <select className="input" value={newBranchSourceRef} onChange={(event) => setNewBranchSourceRef(event.target.value)}>
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
                      <select className="input" value={mergeRequestSourceBranch} onChange={(event) => setMergeRequestSourceBranch(event.target.value)}>
                        {branches.map((branch) => (
                          <option key={branch.name} value={branch.name}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Target branch
                      <select className="input" value={mergeRequestTargetBranch} onChange={(event) => setMergeRequestTargetBranch(event.target.value)}>
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

            <section className="code-workspace-grid">
              <div className="panel stack-md code-file-browser">
                <div className="toolbar-row">
                  <div className="stack-xs">
                    <h3 className="section-heading">Files</h3>
                    <p className="text-muted">{tree?.path || "/"}</p>
                  </div>
                  {tree?.path ? (
                    <button className="button button-secondary" type="button" onClick={() => { setBrowserPath(parentPath(tree.path)); setSelectedFile(null); }}>
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
                  <p className="text-muted">Latest activity for {browserRef || repository.defaultBranch}.</p>
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
        ) : null}
      </div>
    </AppShell>
  );
}
