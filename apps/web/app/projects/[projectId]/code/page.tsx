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
  getGitlabConnectionStatus,
  getProjectRepositoryStatus,
  getRepositoryFile,
  getRepositoryTree,
  GitlabConnectionStatus,
  listRepositoryBranches,
  listRepositoryCommits,
  ProjectRepositoryStatus,
  RepositoryBranch,
  RepositoryCommit,
  RepositoryFile,
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
  const [browserRef, setBrowserRef] = useState<string>("");
  const [browserPath, setBrowserPath] = useState<string>("");
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
      if (nextRepository.connected) {
        await loadRepositoryContent(token, nextRepository);
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
      return "Connect your Atlasium-managed GitLab account from Account before browsing code, creating branches, or opening merge requests.";
    }
    if (connection.reconnectRequired) {
      return "Your GitLab API session must be reconnected before Atlasium can access the managed repository.";
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
                {repository.managed ? <span className="badge">Managed</span> : null}
                <span className="badge">Default: {repository.defaultBranch}</span>
                <a className="button button-secondary" href={repository.webUrl} target="_blank" rel="noreferrer">
                  Open in GitLab
                </a>
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
