import { BadRequestException } from "@nestjs/common";

export type GitlabOAuthTokenExpiryInput = {
  expires_in?: number;
};

export type GitlabProjectMapperInput = {
  id: number;
  name: string;
  description: string | null;
  web_url: string;
  http_url_to_repo?: string;
  ssh_url_to_repo?: string;
  path_with_namespace: string;
  default_branch: string | null;
  visibility: string;
  last_activity_at: string;
};

export type RepositorySummaryRecord = {
  id: string;
  gitlabProjectId: string;
  name: string;
  description: string | null;
  webUrl: string;
  pathWithNamespace: string;
  defaultBranch: string;
  visibility: string;
  lastActivityAt: Date;
  connectedAt: Date;
  connectedByUserId: string;
};

export type GitlabSshKeyMapperInput = {
  id: number;
  title: string;
  key: string;
  created_at: string;
  expires_at?: string | null;
  usage_type?: string | null;
};

export function normalizeRepositoryPath(path: string): string {
  const normalized = path
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new BadRequestException("Repository path must contain at least one valid character");
  }

  return normalized;
}

export function buildRepositoryCloneUrl(browserBaseUrl: string, pathWithNamespace: string): string {
  return `${browserBaseUrl}/${pathWithNamespace.replace(/^\/+/, "")}.git`;
}

export function buildRepositorySshCloneUrl(browserBaseUrl: string, pathWithNamespace: string): string {
  const browserUrl = new URL(browserBaseUrl);
  return `git@${browserUrl.hostname}:${pathWithNamespace.replace(/^\/+/, "")}.git`;
}

export function resolveTokenExpiry(payload: GitlabOAuthTokenExpiryInput, nowMs = Date.now()): Date | null {
  if (!payload.expires_in || payload.expires_in <= 0) {
    return null;
  }

  return new Date(nowMs + payload.expires_in * 1000);
}

export function mapRepositorySummaryFromRecord(
  repository: RepositorySummaryRecord,
  browserBaseUrl: string
) {
  return {
    id: repository.id,
    gitlabProjectId: repository.gitlabProjectId,
    name: repository.name,
    description: repository.description,
    webUrl: repository.webUrl,
    sshCloneUrl: buildRepositorySshCloneUrl(browserBaseUrl, repository.pathWithNamespace),
    httpCloneUrl: buildRepositoryCloneUrl(browserBaseUrl, repository.pathWithNamespace),
    pathWithNamespace: repository.pathWithNamespace,
    defaultBranch: repository.defaultBranch,
    visibility: repository.visibility,
    lastActivityAt: repository.lastActivityAt.toISOString(),
    connectedAt: repository.connectedAt.toISOString(),
    connectedByUserId: repository.connectedByUserId,
    managed: true as const
  };
}

export function mapRepositoryStatusFromProject(
  project: GitlabProjectMapperInput,
  repository: Pick<RepositorySummaryRecord, "id" | "defaultBranch" | "connectedAt" | "connectedByUserId">,
  browserBaseUrl: string
) {
  return {
    connected: true as const,
    id: repository.id,
    gitlabProjectId: String(project.id),
    name: project.name,
    description: project.description,
    webUrl: project.web_url,
    sshCloneUrl: project.ssh_url_to_repo ?? buildRepositorySshCloneUrl(browserBaseUrl, project.path_with_namespace),
    httpCloneUrl: project.http_url_to_repo ?? buildRepositoryCloneUrl(browserBaseUrl, project.path_with_namespace),
    pathWithNamespace: project.path_with_namespace,
    defaultBranch: project.default_branch ?? repository.defaultBranch,
    visibility: project.visibility,
    lastActivityAt: project.last_activity_at,
    connectedAt: repository.connectedAt.toISOString(),
    connectedByUserId: repository.connectedByUserId,
    managed: true as const
  };
}

export function mapUserSshKey(key: GitlabSshKeyMapperInput): {
  id: number;
  title: string;
  key: string;
  createdAt: string;
  expiresAt: string | null;
  usageType: string | null;
} {
  return {
    id: key.id,
    title: key.title,
    key: key.key,
    createdAt: key.created_at,
    expiresAt: key.expires_at ?? null,
    usageType: key.usage_type ?? null
  };
}

export function normalizeUserSshKeyId(keyId: string): string {
  const normalized = keyId.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new BadRequestException("SSH key id must be a numeric GitLab key id");
  }

  return normalized;
}

export function mapManagedProvision(project: GitlabProjectMapperInput) {
  return {
    gitlabProjectId: String(project.id),
    pathWithNamespace: project.path_with_namespace,
    webUrl: project.web_url,
    defaultBranch: project.default_branch ?? "main",
    name: project.name,
    description: project.description,
    visibility: project.visibility,
    lastActivityAt: project.last_activity_at
  };
}
