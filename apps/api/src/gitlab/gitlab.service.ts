import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { GitLabConnection, Prisma } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { decryptValue, encryptValue } from "../common/crypto";
import { ProjectAccessService } from "../common/project-access.service";
import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectRepositoryDto } from "./dto/create-project-repository.dto";
import { CreateRepositoryBranchDto } from "./dto/create-repository-branch.dto";
import { CreateRepositoryMergeRequestDto } from "./dto/create-repository-merge-request.dto";
import { LinkProjectRepositoryDto } from "./dto/link-project-repository.dto";

type GitlabOAuthTokenPayload = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  created_at?: number;
};

type GitlabCurrentUser = {
  id: number;
  username: string;
  name: string;
  email?: string;
  avatar_url?: string;
  web_url?: string;
};

type GitlabProject = {
  id: number;
  name: string;
  description: string | null;
  web_url: string;
  path_with_namespace: string;
  default_branch: string | null;
  visibility: string;
  last_activity_at: string;
};

type GitlabBranch = {
  name: string;
  merged: boolean;
  default: boolean;
  web_url?: string;
  can_push?: boolean;
  protected?: boolean;
  commit?: {
    id: string;
    short_id: string;
    title: string;
    message: string;
    authored_date: string;
    author_name: string;
    web_url?: string;
  };
};

type GitlabCommit = {
  id: string;
  short_id: string;
  title: string;
  message: string;
  authored_date: string;
  author_name: string;
  web_url?: string;
};

type GitlabTreeNode = {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
  mode: string;
};

type GitlabFile = {
  file_name: string;
  file_path: string;
  size: number;
  encoding: string;
  content_sha256?: string;
  ref: string;
  blob_id: string;
  commit_id: string;
  last_commit_id: string;
  content: string;
};

type GitlabMergeRequest = {
  id: number;
  iid: number;
  title: string;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
};

type ConnectionStatus = {
  connected: boolean;
  reconnectRequired: boolean;
  username?: string;
  name?: string;
  email?: string | null;
  avatarUrl?: string | null;
  webUrl?: string | null;
};

type RepositoryStatus =
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

type RepositoryRecord = Prisma.ProjectRepositoryGetPayload<{
  include: {
    project: {
      select: { id: true; key: true; name: true; deletedAt: true };
    };
  };
}>;

const GITLAB_OAUTH_STATE_PURPOSE = "gitlab_oauth";
const GITLAB_OAUTH_SCOPE = "api read_user";

class GitlabApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    message?: string
  ) {
    super(message ?? responseBody ?? `GitLab API error (${status})`);
  }
}

@Injectable()
export class GitlabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService
  ) {}

  getOauthStatePurpose(): string {
    return GITLAB_OAUTH_STATE_PURPOSE;
  }

  buildAuthorizationUrl(state: string): string {
    const config = this.getGitlabConfig();
    const authorizeUrl = new URL(`${config.baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", GITLAB_OAUTH_SCOPE);
    authorizeUrl.searchParams.set("state", state);
    return authorizeUrl.toString();
  }

  async exchangeAuthorizationCode(userId: string, code: string): Promise<ConnectionStatus> {
    const tokenPayload = await this.exchangeToken({
      grantType: "authorization_code",
      params: {
        code
      }
    });
    const gitlabUser = await this.fetchGitlabUser(tokenPayload.access_token);
    const tokenExpiresAt = this.resolveTokenExpiry(tokenPayload);
    const secret = getEnv().JWT_SECRET;

    await this.prisma.gitLabConnection.upsert({
      where: {
        userId
      },
      create: {
        userId,
        gitlabUserId: String(gitlabUser.id),
        username: gitlabUser.username,
        name: gitlabUser.name,
        email: gitlabUser.email,
        avatarUrl: gitlabUser.avatar_url,
        webUrl: gitlabUser.web_url,
        scope: tokenPayload.scope ?? GITLAB_OAUTH_SCOPE,
        accessTokenEncrypted: encryptValue(tokenPayload.access_token, secret),
        refreshTokenEncrypted: tokenPayload.refresh_token ? encryptValue(tokenPayload.refresh_token, secret) : null,
        tokenExpiresAt,
        reconnectRequired: false
      },
      update: {
        gitlabUserId: String(gitlabUser.id),
        username: gitlabUser.username,
        name: gitlabUser.name,
        email: gitlabUser.email,
        avatarUrl: gitlabUser.avatar_url,
        webUrl: gitlabUser.web_url,
        scope: tokenPayload.scope ?? GITLAB_OAUTH_SCOPE,
        accessTokenEncrypted: encryptValue(tokenPayload.access_token, secret),
        refreshTokenEncrypted: tokenPayload.refresh_token ? encryptValue(tokenPayload.refresh_token, secret) : null,
        tokenExpiresAt,
        reconnectRequired: false
      }
    });

    return this.getConnectionStatus(userId);
  }

  async disconnectUserConnection(userId: string): Promise<boolean> {
    const existing = await this.prisma.gitLabConnection.findUnique({
      where: {
        userId
      },
      select: {
        userId: true
      }
    });

    if (!existing) {
      return false;
    }

    await this.prisma.gitLabConnection.delete({
      where: {
        userId
      }
    });

    return true;
  }

  async getConnectionStatus(userId: string): Promise<ConnectionStatus> {
    const connection = await this.prisma.gitLabConnection.findUnique({
      where: {
        userId
      },
      select: {
        username: true,
        name: true,
        email: true,
        avatarUrl: true,
        webUrl: true,
        reconnectRequired: true
      }
    });

    if (!connection) {
      return {
        connected: false,
        reconnectRequired: false
      };
    }

    return {
      connected: true,
      reconnectRequired: connection.reconnectRequired,
      username: connection.username,
      name: connection.name,
      email: connection.email,
      avatarUrl: connection.avatarUrl,
      webUrl: connection.webUrl
    };
  }

  async searchProjects(user: AuthenticatedUser, query: string): Promise<Array<{
    gitlabProjectId: string;
    name: string;
    description: string | null;
    pathWithNamespace: string;
    webUrl: string;
    defaultBranch: string | null;
    visibility: string;
    lastActivityAt: string;
  }>> {
    this.ensureGlobalAdmin(user);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const encodedQuery = query.trim();
      const search = new URLSearchParams({
        simple: "true",
        membership: "true",
        order_by: "last_activity_at",
        sort: "desc",
        per_page: "20"
      });
      if (encodedQuery.length > 0) {
        search.set("search", encodedQuery);
      }

      const projects = await this.executeGitlabRequest<GitlabProject[]>(accessToken, `/projects?${search.toString()}`);
      return projects.map((project) => ({
        gitlabProjectId: String(project.id),
        name: project.name,
        description: project.description,
        pathWithNamespace: project.path_with_namespace,
        webUrl: project.web_url,
        defaultBranch: project.default_branch,
        visibility: project.visibility,
        lastActivityAt: project.last_activity_at
      }));
    });
  }

  async getRepositoryStatus(projectId: string, user: AuthenticatedUser): Promise<RepositoryStatus> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const repository = await this.findRepositoryRecord(projectId);
    if (!repository) {
      return { connected: false };
    }

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const project = await this.fetchRepositoryProject(repository.gitlabProjectId, accessToken);
      return {
        connected: true,
        gitlabProjectId: String(project.id),
        name: project.name,
        description: project.description,
        webUrl: project.web_url,
        pathWithNamespace: project.path_with_namespace,
        defaultBranch: project.default_branch ?? repository.defaultBranch,
        visibility: project.visibility,
        lastActivityAt: project.last_activity_at,
        connectedAt: repository.connectedAt.toISOString(),
        connectedByUserId: repository.connectedByUserId
      };
    });
  }

  async linkRepository(
    projectId: string,
    dto: LinkProjectRepositoryDto,
    user: AuthenticatedUser
  ): Promise<RepositoryStatus> {
    this.ensureGlobalAdmin(user);
    await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);

    const linked = await this.withUserAccessToken(user.userId, async (accessToken) => {
      const remoteProject = await this.fetchRepositoryProject(dto.gitlabProjectId, accessToken);

      return this.prisma.projectRepository.upsert({
        where: {
          projectId
        },
        create: {
          projectId,
          gitlabProjectId: String(remoteProject.id),
          pathWithNamespace: remoteProject.path_with_namespace,
          webUrl: remoteProject.web_url,
          defaultBranch: remoteProject.default_branch ?? "main",
          connectedByUserId: user.userId
        },
        update: {
          gitlabProjectId: String(remoteProject.id),
          pathWithNamespace: remoteProject.path_with_namespace,
          webUrl: remoteProject.web_url,
          defaultBranch: remoteProject.default_branch ?? "main",
          connectedByUserId: user.userId,
          connectedAt: new Date()
        }
      });
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_repository",
      entityId: linked.id,
      action: "project.repository.link",
      metadata: {
        gitlabProjectId: linked.gitlabProjectId,
        pathWithNamespace: linked.pathWithNamespace
      }
    });

    return this.getRepositoryStatus(projectId, user);
  }

  async createRepository(
    projectId: string,
    dto: CreateProjectRepositoryDto,
    user: AuthenticatedUser
  ): Promise<RepositoryStatus> {
    this.ensureGlobalAdmin(user);
    await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);

    const atlasiumProject = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null
      },
      select: {
        id: true,
        key: true,
        name: true
      }
    });

    if (!atlasiumProject) {
      throw new NotFoundException("Project not found");
    }

    const repositoryName = dto.name?.trim() || atlasiumProject.name;
    const repositoryPath = this.normalizeRepositoryPath(dto.path?.trim() || atlasiumProject.key.toLowerCase());
    const namespaceId = this.getGitlabConfig().defaultNamespaceId;

    if (!namespaceId) {
      throw new ServiceUnavailableException("GitLab default namespace is not configured");
    }

    const created = await this.withUserAccessToken(user.userId, async (accessToken) => {
      const remoteProject = await this.executeGitlabRequest<GitlabProject>(accessToken, "/projects", {
        method: "POST",
        body: JSON.stringify({
          namespace_id: namespaceId,
          name: repositoryName,
          path: repositoryPath,
          initialize_with_readme: false
        })
      });

      return this.prisma.projectRepository.upsert({
        where: {
          projectId
        },
        create: {
          projectId,
          gitlabProjectId: String(remoteProject.id),
          pathWithNamespace: remoteProject.path_with_namespace,
          webUrl: remoteProject.web_url,
          defaultBranch: remoteProject.default_branch ?? "main",
          connectedByUserId: user.userId
        },
        update: {
          gitlabProjectId: String(remoteProject.id),
          pathWithNamespace: remoteProject.path_with_namespace,
          webUrl: remoteProject.web_url,
          defaultBranch: remoteProject.default_branch ?? "main",
          connectedByUserId: user.userId,
          connectedAt: new Date()
        }
      });
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_repository",
      entityId: created.id,
      action: "project.repository.create",
      metadata: {
        gitlabProjectId: created.gitlabProjectId,
        pathWithNamespace: created.pathWithNamespace
      }
    });

    return this.getRepositoryStatus(projectId, user);
  }

  async disconnectRepository(projectId: string, user: AuthenticatedUser): Promise<{ disconnected: true }> {
    this.ensureGlobalAdmin(user);
    await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);

    const repository = await this.prisma.projectRepository.findUnique({
      where: {
        projectId
      },
      select: {
        id: true
      }
    });

    if (!repository) {
      throw new NotFoundException("No GitLab repository is connected to this project");
    }

    await this.prisma.projectRepository.delete({
      where: {
        projectId
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_repository",
      entityId: repository.id,
      action: "project.repository.disconnect"
    });

    return { disconnected: true };
  }

  async listBranches(projectId: string, user: AuthenticatedUser): Promise<Array<{
    name: string;
    default: boolean;
    merged: boolean;
    canPush: boolean;
    protected: boolean;
    webUrl: string | null;
  }>> {
    const repository = await this.requireReadableRepository(projectId, user);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const branches = await this.executeGitlabRequest<GitlabBranch[]>(
        accessToken,
        `/projects/${encodeURIComponent(repository.gitlabProjectId)}/repository/branches?per_page=100`
      );
      return branches.map((branch) => ({
        name: branch.name,
        default: branch.default,
        merged: branch.merged,
        canPush: branch.can_push ?? false,
        protected: branch.protected ?? false,
        webUrl: branch.web_url ?? null
      }));
    });
  }

  async listCommits(projectId: string, ref: string | undefined, user: AuthenticatedUser): Promise<Array<{
    id: string;
    shortId: string;
    title: string;
    message: string;
    authoredDate: string;
    authorName: string;
    webUrl: string | null;
  }>> {
    const repository = await this.requireReadableRepository(projectId, user);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const search = new URLSearchParams({ per_page: "25" });
      if (ref?.trim()) {
        search.set("ref_name", ref.trim());
      }

      const commits = await this.executeGitlabRequest<GitlabCommit[]>(
        accessToken,
        `/projects/${encodeURIComponent(repository.gitlabProjectId)}/repository/commits?${search.toString()}`
      );
      return commits.map((commit) => ({
        id: commit.id,
        shortId: commit.short_id,
        title: commit.title,
        message: commit.message,
        authoredDate: commit.authored_date,
        authorName: commit.author_name,
        webUrl: commit.web_url ?? null
      }));
    });
  }

  async getRepositoryTree(
    projectId: string,
    path: string | undefined,
    ref: string | undefined,
    user: AuthenticatedUser
  ): Promise<{
    ref: string;
    path: string;
    entries: Array<{ id: string; name: string; path: string; type: "tree" | "blob" }>;
  }> {
    const repository = await this.requireReadableRepository(projectId, user);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const resolvedRef = ref?.trim() || repository.defaultBranch;
      const search = new URLSearchParams({ per_page: "200", ref: resolvedRef });
      if (path?.trim()) {
        search.set("path", path.trim());
      }

      const entries = await this.executeGitlabRequest<GitlabTreeNode[]>(
        accessToken,
        `/projects/${encodeURIComponent(repository.gitlabProjectId)}/repository/tree?${search.toString()}`
      );

      return {
        ref: resolvedRef,
        path: path?.trim() || "",
        entries: entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          path: entry.path,
          type: entry.type
        }))
      };
    });
  }

  async getRepositoryFile(
    projectId: string,
    filePath: string,
    ref: string | undefined,
    user: AuthenticatedUser
  ): Promise<{
    filePath: string;
    fileName: string;
    ref: string;
    size: number;
    binary: boolean;
    content: string | null;
  }> {
    const repository = await this.requireReadableRepository(projectId, user);
    const normalizedFilePath = filePath.trim();
    if (!normalizedFilePath) {
      throw new BadRequestException("filePath is required");
    }

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const resolvedRef = ref?.trim() || repository.defaultBranch;
      const search = new URLSearchParams({ ref: resolvedRef });
      const gitlabFile = await this.executeGitlabRequest<GitlabFile>(
        accessToken,
        `/projects/${encodeURIComponent(repository.gitlabProjectId)}/repository/files/${encodeURIComponent(normalizedFilePath)}?${search.toString()}`
      );

      const rawBuffer = Buffer.from(gitlabFile.content, "base64");
      const binary = this.isBinaryBuffer(rawBuffer);

      return {
        filePath: gitlabFile.file_path,
        fileName: gitlabFile.file_name,
        ref: gitlabFile.ref,
        size: gitlabFile.size,
        binary,
        content: binary ? null : rawBuffer.toString("utf8")
      };
    });
  }

  async createBranch(
    projectId: string,
    dto: CreateRepositoryBranchDto,
    user: AuthenticatedUser
  ): Promise<{ name: string; webUrl: string | null; default: boolean }> {
    const repository = await this.requireWritableRepository(projectId, user);

    const createdBranch = await this.withUserAccessToken(user.userId, async (accessToken) => {
      return this.executeGitlabRequest<GitlabBranch>(
        accessToken,
        `/projects/${encodeURIComponent(repository.gitlabProjectId)}/repository/branches`,
        {
          method: "POST",
          body: JSON.stringify({
            branch: dto.name.trim(),
            ref: dto.sourceRef.trim()
          })
        }
      );
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_repository_branch",
      entityId: `${repository.id}:${createdBranch.name}`,
      action: "project.repository.branch.create",
      metadata: {
        sourceRef: dto.sourceRef.trim()
      }
    });

    return {
      name: createdBranch.name,
      webUrl: createdBranch.web_url ?? null,
      default: createdBranch.default
    };
  }

  async createMergeRequest(
    projectId: string,
    dto: CreateRepositoryMergeRequestDto,
    user: AuthenticatedUser
  ): Promise<{ id: number; iid: number; title: string; state: string; webUrl: string }> {
    const repository = await this.requireWritableRepository(projectId, user);

    const mergeRequest = await this.withUserAccessToken(user.userId, async (accessToken) => {
      return this.executeGitlabRequest<GitlabMergeRequest>(
        accessToken,
        `/projects/${encodeURIComponent(repository.gitlabProjectId)}/merge_requests`,
        {
          method: "POST",
          body: JSON.stringify({
            source_branch: dto.sourceBranch.trim(),
            target_branch: dto.targetBranch.trim(),
            title: dto.title.trim(),
            description: dto.description?.trim() || undefined
          })
        }
      );
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_merge_request",
      entityId: String(mergeRequest.id),
      action: "project.repository.merge_request.create",
      metadata: {
        iid: mergeRequest.iid,
        sourceBranch: dto.sourceBranch.trim(),
        targetBranch: dto.targetBranch.trim()
      }
    });

    return {
      id: mergeRequest.id,
      iid: mergeRequest.iid,
      title: mergeRequest.title,
      state: mergeRequest.state,
      webUrl: mergeRequest.web_url
    };
  }

  private async requireReadableRepository(projectId: string, user: AuthenticatedUser): Promise<RepositoryRecord> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);
    const repository = await this.findRepositoryRecord(projectId);
    if (!repository) {
      throw new NotFoundException("No GitLab repository is connected to this project");
    }
    return repository;
  }

  private async requireWritableRepository(projectId: string, user: AuthenticatedUser): Promise<RepositoryRecord> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);
    const repository = await this.findRepositoryRecord(projectId);
    if (!repository) {
      throw new NotFoundException("No GitLab repository is connected to this project");
    }
    return repository;
  }

  private async findRepositoryRecord(projectId: string): Promise<RepositoryRecord | null> {
    return this.prisma.projectRepository.findUnique({
      where: {
        projectId
      },
      include: {
        project: {
          select: {
            id: true,
            key: true,
            name: true,
            deletedAt: true
          }
        }
      }
    });
  }

  private async fetchRepositoryProject(gitlabProjectId: string, accessToken: string): Promise<GitlabProject> {
    try {
      return await this.executeGitlabRequest<GitlabProject>(
        accessToken,
        `/projects/${encodeURIComponent(gitlabProjectId)}`
      );
    } catch (error) {
      throw this.mapRepositoryAccessError(error);
    }
  }

  private async withUserAccessToken<T>(userId: string, callback: (accessToken: string) => Promise<T>): Promise<T> {
    let connection = await this.requireConnectionRecord(userId);
    let hasRetried = false;

    while (true) {
      connection = await this.ensureConnectionReady(connection);
      const accessToken = decryptValue(connection.accessTokenEncrypted, getEnv().JWT_SECRET);

      try {
        return await callback(accessToken);
      } catch (error) {
        if (error instanceof GitlabApiError && error.status === 401) {
          if (hasRetried) {
            await this.markReconnectRequired(userId);
            throw new UnauthorizedException("GitLab reconnection required");
          }

          hasRetried = true;
          connection = await this.refreshConnection(connection);
          continue;
        }

        throw error;
      }
    }
  }

  private async requireConnectionRecord(userId: string): Promise<GitLabConnection> {
    const connection = await this.prisma.gitLabConnection.findUnique({
      where: {
        userId
      }
    });

    if (!connection) {
      throw new UnauthorizedException("GitLab connection required");
    }

    return connection;
  }

  private async ensureConnectionReady(connection: GitLabConnection): Promise<GitLabConnection> {
    if (connection.reconnectRequired) {
      throw new UnauthorizedException("GitLab reconnection required");
    }

    const expiresAt = connection.tokenExpiresAt?.getTime();
    const now = Date.now();
    const expirySkewMs = 30_000;
    if (!expiresAt || expiresAt - now > expirySkewMs) {
      return connection;
    }

    return this.refreshConnection(connection);
  }

  private async refreshConnection(connection: GitLabConnection): Promise<GitLabConnection> {
    if (!connection.refreshTokenEncrypted) {
      await this.markReconnectRequired(connection.userId);
      throw new UnauthorizedException("GitLab reconnection required");
    }

    const refreshToken = decryptValue(connection.refreshTokenEncrypted, getEnv().JWT_SECRET);
    const refreshedPayload = await this.exchangeToken({
      grantType: "refresh_token",
      params: {
        refresh_token: refreshToken
      }
    });

    const secret = getEnv().JWT_SECRET;
    return this.prisma.gitLabConnection.update({
      where: {
        userId: connection.userId
      },
      data: {
        scope: refreshedPayload.scope ?? connection.scope,
        accessTokenEncrypted: encryptValue(refreshedPayload.access_token, secret),
        refreshTokenEncrypted: refreshedPayload.refresh_token
          ? encryptValue(refreshedPayload.refresh_token, secret)
          : connection.refreshTokenEncrypted,
        tokenExpiresAt: this.resolveTokenExpiry(refreshedPayload),
        reconnectRequired: false
      }
    });
  }

  private async exchangeToken(params: {
    grantType: "authorization_code" | "refresh_token";
    params: Record<string, string>;
  }): Promise<GitlabOAuthTokenPayload> {
    const config = this.getGitlabConfig();
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: params.grantType,
      ...params.params
    });

    const response = await fetch(`${config.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new UnauthorizedException(text || "GitLab token exchange failed");
    }

    return (await response.json()) as GitlabOAuthTokenPayload;
  }

  private async fetchGitlabUser(accessToken: string): Promise<GitlabCurrentUser> {
    return this.executeGitlabRequest<GitlabCurrentUser>(accessToken, "/user");
  }

  private async executeGitlabRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.getGitlabConfig().baseUrl}/api/v4${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GitlabApiError(response.status, text, text || `GitLab API error (${response.status})`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async markReconnectRequired(userId: string): Promise<void> {
    await this.prisma.gitLabConnection.updateMany({
      where: {
        userId
      },
      data: {
        reconnectRequired: true
      }
    });
  }

  private mapRepositoryAccessError(error: unknown): Error {
    if (error instanceof GitlabApiError) {
      if (error.status === 401) {
        return new UnauthorizedException("GitLab reconnection required");
      }
      if (error.status === 403 || error.status === 404) {
        return new ForbiddenException("Your connected GitLab account cannot access this repository");
      }
      if (error.status >= 500) {
        return new BadGatewayException("GitLab is currently unavailable");
      }
      return new BadRequestException(error.responseBody || "GitLab request failed");
    }

    return error instanceof Error ? error : new BadGatewayException("GitLab request failed");
  }

  private ensureGlobalAdmin(user: AuthenticatedUser): void {
    if (user.globalRole !== "admin") {
      throw new ForbiddenException("Only admins can manage project repositories");
    }
  }

  private normalizeRepositoryPath(path: string): string {
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

  private resolveTokenExpiry(payload: GitlabOAuthTokenPayload): Date | null {
    if (!payload.expires_in || payload.expires_in <= 0) {
      return null;
    }

    return new Date(Date.now() + payload.expires_in * 1000);
  }

  private isBinaryBuffer(buffer: Buffer): boolean {
    if (buffer.length === 0) {
      return false;
    }

    const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
    let suspicious = 0;
    for (const byte of sample) {
      if (byte === 0) {
        return true;
      }
      if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) {
        suspicious += 1;
      }
    }

    return suspicious / sample.length > 0.15;
  }

  private getGitlabConfig(): {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    defaultNamespaceId?: string;
    redirectUri: string;
  } {
    const env = getEnv();
    if (!env.GITLAB_BASE_URL || !env.GITLAB_OAUTH_CLIENT_ID || !env.GITLAB_OAUTH_CLIENT_SECRET) {
      throw new ServiceUnavailableException("GitLab integration is not configured");
    }

    return {
      baseUrl: env.GITLAB_BASE_URL.replace(/\/+$/, ""),
      clientId: env.GITLAB_OAUTH_CLIENT_ID,
      clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
      defaultNamespaceId: env.GITLAB_DEFAULT_NAMESPACE_ID,
      redirectUri: env.GITLAB_OAUTH_REDIRECT_URI ?? `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/auth/gitlab/callback`
    };
  }
}
