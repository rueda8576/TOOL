import { authFetch, authFetchResponse } from "./client-api";

const REPOSITORY_ARCHIVE_ACCEPT_HEADER = "application/zip, application/octet-stream, */*";

export type GitlabConnectionStatus = {
  connected: boolean;
  reconnectRequired: boolean;
  username?: string;
  name?: string;
  email?: string | null;
  avatarUrl?: string | null;
  webUrl?: string | null;
};

export type ProjectRepositorySummary = {
  id: string;
  gitlabProjectId: string;
  name: string;
  description: string | null;
  webUrl: string;
  sshCloneUrl: string;
  httpCloneUrl: string;
  pathWithNamespace: string;
  defaultBranch: string;
  visibility: string;
  lastActivityAt: string;
  connectedAt: string;
  connectedByUserId: string;
  managed: true;
};

export type ProjectRepositoryStatus =
  | { connected: false }
  | ({ connected: true } & ProjectRepositorySummary);

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
  sourceBranch: string;
  targetBranch: string;
  updatedAt: string;
  draft: boolean;
  author: {
    name: string;
    username: string;
    avatarUrl: string | null;
  } | null;
};

export type RepositoryMergeRequestState = "opened" | "merged" | "closed" | "all";

export type GitlabSshKey = {
  id: number;
  title: string;
  key: string;
  createdAt: string;
  expiresAt: string | null;
  usageType: string | null;
};

export type CreatedRepositoryMergeRequest = {
  id: number;
  iid: number;
  title: string;
  state: string;
  webUrl: string;
};

function parseFileNameFromContentDisposition(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = headerValue.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] ?? null;
}

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

export async function listGitlabSshKeys(token: string): Promise<GitlabSshKey[]> {
  return authFetch<GitlabSshKey[]>("/auth/gitlab/ssh-keys", { token });
}

export async function createGitlabSshKey(
  token: string,
  payload: { title: string; key: string; expiresAt?: string }
): Promise<GitlabSshKey> {
  return authFetch<GitlabSshKey>("/auth/gitlab/ssh-keys", {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function deleteGitlabSshKey(token: string, keyId: number): Promise<{ deleted: true }> {
  return authFetch<{ deleted: true }>(`/auth/gitlab/ssh-keys/${keyId}`, {
    token,
    init: {
      method: "DELETE"
    }
  });
}

export async function getProjectRepositoryStatus(projectId: string, token: string): Promise<ProjectRepositoryStatus> {
  return authFetch<ProjectRepositoryStatus>(`/projects/${projectId}/repository`, { token });
}

export async function listProjectRepositories(projectId: string, token: string): Promise<ProjectRepositorySummary[]> {
  return authFetch<ProjectRepositorySummary[]>(`/projects/${projectId}/repositories`, { token });
}

export async function ensureProjectRepositoryAccess(projectId: string, repositoryId: string, token: string): Promise<ProjectRepositoryStatus> {
  return authFetch<ProjectRepositoryStatus>(`/projects/${projectId}/repositories/${repositoryId}/access/ensure`, {
    token,
    init: {
      method: "POST"
    }
  });
}

export async function createProjectRepository(
  projectId: string,
  token: string,
  payload: { name: string; path?: string; description?: string }
): Promise<ProjectRepositoryStatus> {
  return authFetch<ProjectRepositoryStatus>(`/projects/${projectId}/repositories`, {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function listRepositoryBranches(projectId: string, repositoryId: string, token: string): Promise<RepositoryBranch[]> {
  return authFetch<RepositoryBranch[]>(`/projects/${projectId}/repositories/${repositoryId}/branches`, { token });
}

export async function listRepositoryCommits(
  projectId: string,
  repositoryId: string,
  token: string,
  params?: { ref?: string }
): Promise<RepositoryCommit[]> {
  const search = new URLSearchParams();
  if (params?.ref?.trim()) {
    search.set("ref", params.ref.trim());
  }
  const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
  return authFetch<RepositoryCommit[]>(`/projects/${projectId}/repositories/${repositoryId}/commits${suffix}`, { token });
}

export async function getRepositoryTree(
  projectId: string,
  repositoryId: string,
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
  return authFetch<RepositoryTree>(`/projects/${projectId}/repositories/${repositoryId}/tree${suffix}`, { token });
}

export async function getRepositoryFile(
  projectId: string,
  repositoryId: string,
  token: string,
  params: { ref?: string; filePath: string }
): Promise<RepositoryFile> {
  const search = new URLSearchParams({ filePath: params.filePath });
  if (params.ref?.trim()) {
    search.set("ref", params.ref.trim());
  }
  return authFetch<RepositoryFile>(`/projects/${projectId}/repositories/${repositoryId}/file?${search.toString()}`, { token });
}

export async function createRepositoryBranch(
  projectId: string,
  repositoryId: string,
  token: string,
  payload: { name: string; sourceRef: string }
): Promise<{ name: string; webUrl: string | null; default: boolean }> {
  return authFetch<{ name: string; webUrl: string | null; default: boolean }>(
    `/projects/${projectId}/repositories/${repositoryId}/branches`,
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
  repositoryId: string,
  token: string,
  payload: { sourceBranch: string; targetBranch: string; title: string; description?: string }
): Promise<CreatedRepositoryMergeRequest> {
  return authFetch<CreatedRepositoryMergeRequest>(`/projects/${projectId}/repositories/${repositoryId}/merge-requests`, {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function listRepositoryMergeRequests(
  projectId: string,
  repositoryId: string,
  token: string,
  params?: { state?: RepositoryMergeRequestState }
): Promise<RepositoryMergeRequest[]> {
  const search = new URLSearchParams();
  if (params?.state) {
    search.set("state", params.state);
  }
  const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
  return authFetch<RepositoryMergeRequest[]>(`/projects/${projectId}/repositories/${repositoryId}/merge-requests${suffix}`, {
    token
  });
}

export async function downloadRepositoryArchive(
  projectId: string,
  repositoryId: string,
  token: string,
  params?: { ref?: string }
): Promise<{ blob: Blob; fileName: string }> {
  const search = new URLSearchParams();
  if (params?.ref?.trim()) {
    search.set("ref", params.ref.trim());
  }
  const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
  const response = await authFetchResponse(`/projects/${projectId}/repositories/${repositoryId}/archive${suffix}`, {
    token,
    init: {
      method: "GET",
      headers: {
        Accept: REPOSITORY_ARCHIVE_ACCEPT_HEADER
      }
    }
  });

  return {
    blob: await response.blob(),
    fileName: parseFileNameFromContentDisposition(response.headers.get("Content-Disposition")) ?? "repository.zip"
  };
}
