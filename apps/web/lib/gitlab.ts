import { authFetch } from "./client-api";

export type GitlabConnectionStatus = {
  connected: boolean;
  reconnectRequired: boolean;
  username?: string;
  name?: string;
  email?: string | null;
  avatarUrl?: string | null;
  webUrl?: string | null;
};

export type GitlabSearchProject = {
  gitlabProjectId: string;
  name: string;
  description: string | null;
  pathWithNamespace: string;
  webUrl: string;
  defaultBranch: string | null;
  visibility: string;
  lastActivityAt: string;
};

export type ProjectRepositoryStatus =
  | { connected: false }
  | {
      connected: true;
      gitlabProjectId: string;
      name: string;
      description: string | null;
      webUrl: string;
      pathWithNamespace: string;
      defaultBranch: string;
      visibility: string;
      lastActivityAt: string;
      connectedAt: string;
      connectedByUserId: string;
    };

export type RepositoryBranch = {
  name: string;
  default: boolean;
  merged: boolean;
  canPush: boolean;
  protected: boolean;
  webUrl: string | null;
};

export type RepositoryCommit = {
  id: string;
  shortId: string;
  title: string;
  message: string;
  authoredDate: string;
  authorName: string;
  webUrl: string | null;
};

export type RepositoryTree = {
  ref: string;
  path: string;
  entries: Array<{
    id: string;
    name: string;
    path: string;
    type: "tree" | "blob";
  }>;
};

export type RepositoryFile = {
  filePath: string;
  fileName: string;
  ref: string;
  size: number;
  binary: boolean;
  content: string | null;
};

export type RepositoryMergeRequest = {
  id: number;
  iid: number;
  title: string;
  state: string;
  webUrl: string;
};

export async function getGitlabConnectionStatus(token: string): Promise<GitlabConnectionStatus> {
  return authFetch<GitlabConnectionStatus>("/auth/gitlab/connection", { token });
}

export async function beginGitlabConnection(token: string): Promise<{ authorizationUrl: string }> {
  return authFetch<{ authorizationUrl: string }>("/auth/gitlab/connect", {
    token,
    init: {
      method: "POST"
    }
  });
}

export async function disconnectGitlabConnection(token: string): Promise<{ disconnected: true }> {
  return authFetch<{ disconnected: true }>("/auth/gitlab/connection", {
    token,
    init: {
      method: "DELETE"
    }
  });
}

export async function searchGitlabProjects(token: string, query: string): Promise<GitlabSearchProject[]> {
  const search = new URLSearchParams();
  if (query.trim()) {
    search.set("q", query.trim());
  }
  const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
  return authFetch<GitlabSearchProject[]>(`/gitlab/projects/search${suffix}`, { token });
}

export async function getProjectRepositoryStatus(projectId: string, token: string): Promise<ProjectRepositoryStatus> {
  return authFetch<ProjectRepositoryStatus>(`/projects/${projectId}/repository`, { token });
}

export async function linkProjectRepository(
  projectId: string,
  token: string,
  payload: { gitlabProjectId: string }
): Promise<ProjectRepositoryStatus> {
  return authFetch<ProjectRepositoryStatus>(`/projects/${projectId}/repository/link`, {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function createProjectRepository(
  projectId: string,
  token: string,
  payload: { name?: string; path?: string }
): Promise<ProjectRepositoryStatus> {
  return authFetch<ProjectRepositoryStatus>(`/projects/${projectId}/repository/create`, {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function disconnectProjectRepository(projectId: string, token: string): Promise<{ disconnected: true }> {
  return authFetch<{ disconnected: true }>(`/projects/${projectId}/repository`, {
    token,
    init: {
      method: "DELETE"
    }
  });
}

export async function listRepositoryBranches(projectId: string, token: string): Promise<RepositoryBranch[]> {
  return authFetch<RepositoryBranch[]>(`/projects/${projectId}/repository/branches`, { token });
}

export async function listRepositoryCommits(
  projectId: string,
  token: string,
  params?: { ref?: string }
): Promise<RepositoryCommit[]> {
  const search = new URLSearchParams();
  if (params?.ref?.trim()) {
    search.set("ref", params.ref.trim());
  }
  const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
  return authFetch<RepositoryCommit[]>(`/projects/${projectId}/repository/commits${suffix}`, { token });
}

export async function getRepositoryTree(
  projectId: string,
  token: string,
  params?: { ref?: string; path?: string }
): Promise<RepositoryTree> {
  const search = new URLSearchParams();
  if (params?.ref?.trim()) {
    search.set("ref", params.ref.trim());
  }
  if (params?.path?.trim()) {
    search.set("path", params.path.trim());
  }
  const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
  return authFetch<RepositoryTree>(`/projects/${projectId}/repository/tree${suffix}`, { token });
}

export async function getRepositoryFile(
  projectId: string,
  token: string,
  params: { ref?: string; filePath: string }
): Promise<RepositoryFile> {
  const search = new URLSearchParams({ filePath: params.filePath });
  if (params.ref?.trim()) {
    search.set("ref", params.ref.trim());
  }
  return authFetch<RepositoryFile>(`/projects/${projectId}/repository/file?${search.toString()}`, { token });
}

export async function createRepositoryBranch(
  projectId: string,
  token: string,
  payload: { name: string; sourceRef: string }
): Promise<{ name: string; webUrl: string | null; default: boolean }> {
  return authFetch<{ name: string; webUrl: string | null; default: boolean }>(
    `/projects/${projectId}/repository/branches`,
    {
      token,
      init: {
        method: "POST",
        body: JSON.stringify(payload)
      }
    }
  );
}

export async function createRepositoryMergeRequest(
  projectId: string,
  token: string,
  payload: { sourceBranch: string; targetBranch: string; title: string; description?: string }
): Promise<RepositoryMergeRequest> {
  return authFetch<RepositoryMergeRequest>(`/projects/${projectId}/repository/merge-requests`, {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}
