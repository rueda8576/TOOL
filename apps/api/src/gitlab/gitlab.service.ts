import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { GitLabConnection, GlobalRole, Prisma, ProjectRole } from "@prisma/client";
import AdmZip from "adm-zip";

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
import {
  executeGitlabBinaryRequest as executeGitlabBinaryClientRequest,
  executeGitlabJsonRequest,
  GitlabApiError,
  GitlabBinaryRequestOptions,
  GitlabBinaryResponse
} from "./gitlab-client";
import {
  buildCreateBranchRequest,
  buildCreateMergeRequestRequest,
  buildRepositoryArchiveAttempts,
  buildRepositoryArchiveFallbackTreePath,
  buildRepositoryArchiveResolveCommitsPath,
  buildRepositoryBranchesCollectionPath,
  buildRepositoryBranchesPath,
  buildRepositoryCommitPath,
  buildRepositoryCommitRequest,
  buildRepositoryCommitsPath,
  buildRepositoryFilePath,
  buildRepositoryMergeRequestsCollectionPath,
  buildRepositoryMergeRequestsPath,
  buildRepositoryRawFilePath,
  buildRepositoryRecursiveTreePath,
  buildRepositoryTreePath,
  mapCreatedBranch,
  mapCreatedMergeRequest,
  mapGitlabBranch,
  mapGitlabCommit,
  mapGitlabDocsMarkdownFile,
  mapGitlabFileContent,
  mapGitlabMergeRequest,
  mapGitlabRawFile,
  mapGitlabTreeNode,
  mapRepositoryArchiveResponse,
  mapRepositoryDocsCommitResult,
  normalizeRepositoryDocsFilePath,
  normalizeRepositoryFilePath,
  readTextFromGitlabFile,
  resolveArchiveCommitSha
} from "./gitlab-content";
import {
  GITLAB_DOCS_ROOT,
  isDocsMarkdownPath
} from "./gitlab-format";
import {
  mapManagedProvision,
  mapRepositoryStatusFromProject,
  mapRepositorySummaryFromRecord,
  mapUserSshKey,
  normalizeRepositoryPath,
  normalizeUserSshKeyId,
  resolveTokenExpiry
} from "./gitlab-mappers";

const GITLAB_ARCHIVE_FALLBACK_MAX_FILES = 2000;
const GITLAB_ARCHIVE_FALLBACK_MAX_BYTES = 50 * 1024 * 1024;
const MANAGED_REPOSITORY_AGENTS_MD = `# Atlasium Repository Documentation

This repository belongs to an Atlasium project archive.

## Repo Docs

- Use the repo-local \`Docs/\` folder for Markdown documentation that should sync into the Atlasium Wiki.
- \`Docs/Research/\` is for academic, theoretical, methodological, scientific, and technical reference knowledge.
- \`Docs/Implementation/\` is for code architecture, implementation decisions, runtime behavior, integration notes, deployment, and engineering traceability.
- Repo \`Docs/\` is not the Atlasium Documents module; it is the Git-backed Wiki sync source.
- Prefer clear Markdown headings, stable filenames, relative links, citations or references when relevant, and concise operational language.
- Use \`README.md\` or \`index.md\` inside a Docs branch only when the page is the branch overview.
`;

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
  identities?: GitlabIdentity[];
};

type GitlabProject = {
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
  archived?: boolean;
};

type GitlabGroup = {
  id: number;
  name: string;
  path: string;
  full_path: string;
  web_url?: string;
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
  updated_at: string;
  draft?: boolean;
  work_in_progress?: boolean;
  author?: {
    id: number;
    username: string;
    name: string;
    avatar_url?: string | null;
    web_url?: string;
  };
};

type GitlabProjectMember = {
  id: number;
  username: string;
  name: string;
  access_level: number;
};

type GitlabUserSearchResult = {
  id: number;
  username: string;
  name: string;
  email?: string;
  public_email?: string | null;
  state?: string;
  avatar_url?: string;
  web_url?: string;
  identities?: GitlabIdentity[];
};

type GitlabIdentity = {
  provider: string;
  extern_uid: string;
};

type GitlabApplicationSettings = {
  password_authentication_enabled_for_git?: boolean;
};

type GitlabSshKey = {
  id: number;
  title: string;
  key: string;
  created_at: string;
  expires_at?: string | null;
  usage_type?: string | null;
};

type ConnectionStatus = {
  connected: boolean;
  reconnectRequired: boolean;
  username?: string;
  name?: string;
  email?: string | null;
  avatarUrl?: string | null;
  webUrl?: string | null;
  httpsClone: {
    enabled: boolean;
    syncedAt: string | null;
    username: string;
  };
};

type RepositorySummary = {
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

type RepositoryStatus = { connected: false } | ({ connected: true } & RepositorySummary);

type RepositoryRemovalBindingCounts = {
  total: number;
  active: number;
  deleted: number;
  conflict: number;
  error: number;
  unassigned: number;
};

export type RepositoryRemovalPreview = {
  repository: {
    id: string;
    name: string;
    gitlabProjectId: string;
    pathWithNamespace: string;
    webUrl: string;
    defaultBranch: string;
    visibility: string;
    lastActivityAt: string;
  };
  remoteAction: "archive";
  confirmationText: string;
  lastRepository: boolean;
  wikiDocsBindings: RepositoryRemovalBindingCounts;
  warnings: string[];
  blockers: Array<{ code: string; message: string }>;
};

export type RepositoryRemovalResult = {
  repositoryId: string;
  name: string;
  pathWithNamespace: string;
  gitlabProjectId: string;
  remoteArchived: boolean;
  remoteMissing: boolean;
  removedAt: string;
  remainingRepositories: number;
  wikiDocsBindingsRemoved: number;
};

type RepositoryRecord = Prisma.ProjectRepositoryGetPayload<{
  include: {
    project: {
      select: { id: true; key: true; name: true; description: true; deletedAt: true };
    };
  };
}>;

type ManagedRepositoryProvision = {
  gitlabProjectId: string;
  pathWithNamespace: string;
  webUrl: string;
  defaultBranch: string;
  name: string;
  description: string | null;
  visibility: string;
  lastActivityAt: string;
};

type ManagedGitlabUser = {
  id: string;
  email: string;
  name: string;
  username: string;
};

const GITLAB_OAUTH_STATE_PURPOSE = "gitlab_oauth";
const GITLAB_OAUTH_SCOPE = "api read_user";
const GITLAB_ACCESS_LEVEL_REPORTER = 20;
const GITLAB_ACCESS_LEVEL_DEVELOPER = 30;
const GITLAB_ACCESS_LEVEL_MAINTAINER = 40;
const GITLAB_DOCS_TREE_PAGE_SIZE = 100;
const GITLAB_DOCS_MAX_MARKDOWN_FILES = 2000;

type RepositoryMergeRequestState = "opened" | "merged" | "closed" | "all";

export type RepositoryDocsMarkdownFile = {
  docsPath: string;
  relativePath: string;
  fileName: string;
  ref: string;
  blobId: string;
  lastCommitId: string;
  contentSha256: string | null;
  content: string;
};

export type RepositoryCommitFileAction = {
  action: "create" | "update" | "delete";
  filePath: string;
  content?: string;
  lastCommitId?: string | null;
};

export type RepositoryDocsCommitResult = {
  id: string;
  shortId: string;
  title: string;
  message: string;
  webUrl: string | null;
};

@Injectable()
export class GitlabService {
  private readonly logger = new Logger(GitlabService.name);
  private readonly refreshConnectionByUserId = new Map<string, Promise<GitLabConnection>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService
  ) {}

  getOauthStatePurpose(): string {
    return GITLAB_OAUTH_STATE_PURPOSE;
  }

  buildAuthorizationUrl(state: string): string {
    const config = this.getGitlabUserOauthConfig();
    const authorizeUrl = new URL(`${config.browserBaseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", GITLAB_OAUTH_SCOPE);
    authorizeUrl.searchParams.set("state", state);
    return authorizeUrl.toString();
  }

  async exchangeAuthorizationCode(userId: string, code: string): Promise<ConnectionStatus> {
    const atlasiumUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        email: true,
        name: true,
        username: true
      }
    });

    if (!atlasiumUser) {
      throw new UnauthorizedException("Session expired");
    }

    const tokenPayload = await this.exchangeUserOAuthToken({
      grantType: "authorization_code",
      params: {
        code
      }
    });
    const gitlabUser = await this.fetchGitlabUser(tokenPayload.access_token);
    await this.assertGitlabUserMatchesAtlasiumIdentity(userId, gitlabUser);
    const syncedGitlabUser = await this.syncManagedUserIdentity(atlasiumUser);
    const tokenExpiresAt = resolveTokenExpiry(tokenPayload);
    const secret = getEnv().JWT_SECRET;

    await this.prisma.gitLabConnection.upsert({
      where: {
        userId
      },
      create: {
        userId,
        gitlabUserId: String(syncedGitlabUser.id),
        username: syncedGitlabUser.username,
        name: syncedGitlabUser.name,
        email: syncedGitlabUser.email,
        avatarUrl: syncedGitlabUser.avatar_url,
        webUrl: syncedGitlabUser.web_url,
        scope: tokenPayload.scope ?? GITLAB_OAUTH_SCOPE,
        accessTokenEncrypted: encryptValue(tokenPayload.access_token, secret),
        refreshTokenEncrypted: tokenPayload.refresh_token ? encryptValue(tokenPayload.refresh_token, secret) : null,
        tokenExpiresAt,
        reconnectRequired: false
      },
      update: {
        gitlabUserId: String(syncedGitlabUser.id),
        username: syncedGitlabUser.username,
        name: syncedGitlabUser.name,
        email: syncedGitlabUser.email,
        avatarUrl: syncedGitlabUser.avatar_url,
        webUrl: syncedGitlabUser.web_url,
        scope: tokenPayload.scope ?? GITLAB_OAUTH_SCOPE,
        accessTokenEncrypted: encryptValue(tokenPayload.access_token, secret),
        refreshTokenEncrypted: tokenPayload.refresh_token ? encryptValue(tokenPayload.refresh_token, secret) : null,
        tokenExpiresAt,
        reconnectRequired: false
      }
    });

    return this.getConnectionStatus(userId);
  }

  async syncManagedUserIdentity(user: ManagedGitlabUser): Promise<GitlabUserSearchResult> {
    return this.withSystemAccessToken(async (accessToken) => {
      try {
        const syncedUser = await this.upsertManagedOidcUser(user, accessToken);
        await this.updateStoredConnectionFromGitlabUser(user.id, syncedUser);
        return syncedUser;
      } catch (error) {
        throw this.mapManagedUserIdentityError(error);
      }
    });
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
    const [connection, user] = await Promise.all([
      this.prisma.gitLabConnection.findUnique({
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
      }),
      this.prisma.user.findUnique({
        where: {
          id: userId
        },
        select: {
          username: true,
          gitlabHttpsPasswordSyncedAt: true
        }
      })
    ]);

    const httpsClone = {
      enabled: Boolean(user?.gitlabHttpsPasswordSyncedAt),
      syncedAt: user?.gitlabHttpsPasswordSyncedAt ? user.gitlabHttpsPasswordSyncedAt.toISOString() : null,
      username: connection?.username ?? user?.username ?? ""
    };

    if (!connection) {
      return {
        connected: false,
        reconnectRequired: false,
        httpsClone
      };
    }

    return {
      connected: true,
      reconnectRequired: connection.reconnectRequired,
      username: connection.username,
      name: connection.name,
      email: connection.email,
      avatarUrl: connection.avatarUrl,
      webUrl: connection.webUrl,
      httpsClone
    };
  }

  async syncUserHttpsPassword(
    user: ManagedGitlabUser,
    password: string
  ): Promise<{ username: string }> {
    return this.withSystemAccessToken(async (accessToken) => {
      try {
        await this.ensureGitPasswordAuthenticationEnabled(accessToken);
        const gitlabUser = await this.upsertManagedOidcUser(user, accessToken, { password });
        await this.updateStoredConnectionFromGitlabUser(user.id, gitlabUser);

        return {
          username: gitlabUser.username
        };
      } catch (error) {
        throw this.mapHttpsPasswordSyncError(error);
      }
    });
  }

  async listUserSshKeys(userId: string): Promise<Array<{
    id: number;
    title: string;
    key: string;
    createdAt: string;
    expiresAt: string | null;
    usageType: string | null;
  }>> {
    return this.withUserAccessToken(userId, async (accessToken) => {
      try {
        const keys = await this.executeGitlabRequest<GitlabSshKey[]>(
          accessToken,
          "/user/keys?per_page=100"
        );

        return keys.map((key) => mapUserSshKey(key));
      } catch (error) {
        throw this.mapUserSshKeyError(error);
      }
    });
  }

  async createUserSshKey(
    userId: string,
    payload: { title: string; key: string; expiresAt?: string }
  ): Promise<{
    id: number;
    title: string;
    key: string;
    createdAt: string;
    expiresAt: string | null;
    usageType: string | null;
  }> {
    return this.withUserAccessToken(userId, async (accessToken) => {
      try {
        const createdKey = await this.executeGitlabRequest<GitlabSshKey>(
          accessToken,
          "/user/keys",
          {
            method: "POST",
            body: JSON.stringify({
              title: payload.title.trim(),
              key: payload.key.trim(),
              ...(payload.expiresAt?.trim() ? { expires_at: payload.expiresAt.trim() } : {})
            })
          }
        );

        return mapUserSshKey(createdKey);
      } catch (error) {
        throw this.mapUserSshKeyError(error);
      }
    });
  }

  async deleteUserSshKey(userId: string, keyId: string): Promise<{ deleted: true }> {
    const normalizedKeyId = normalizeUserSshKeyId(keyId);

    return this.withUserAccessToken(userId, async (accessToken) => {
      try {
        await this.executeGitlabRequest<void>(
          accessToken,
          `/user/keys/${encodeURIComponent(normalizedKeyId)}`,
          {
            method: "DELETE"
          }
        );

        return { deleted: true };
      } catch (error) {
        throw this.mapUserSshKeyError(error);
      }
    });
  }

  async searchProjects(_user: AuthenticatedUser, _query: string): Promise<never> {
    throw new ForbiddenException("Atlasium provisions managed GitLab repositories automatically");
  }

  async listRepositories(projectId: string, user: AuthenticatedUser): Promise<RepositorySummary[]> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const repositories = await this.findRepositoryRecords(projectId);
    const browserBaseUrl = this.getGitlabBrowserBaseUrl();
    return repositories.map((repository) => mapRepositorySummaryFromRecord(repository, browserBaseUrl));
  }

  async getRepositoryStatus(projectId: string, user: AuthenticatedUser, repositoryId?: string): Promise<RepositoryStatus> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const repository = repositoryId
      ? await this.findRepositoryRecordById(projectId, repositoryId)
      : await this.findRepositoryRecord(projectId);
    if (!repository) {
      return { connected: false };
    }

    try {
      const project = await this.withSystemAccessToken((accessToken) =>
        this.fetchRepositoryProject(repository.gitlabProjectId, accessToken)
      );

      return mapRepositoryStatusFromProject(project, repository, this.getGitlabBrowserBaseUrl());
    } catch {
      return {
        connected: true,
        ...mapRepositorySummaryFromRecord(repository, this.getGitlabBrowserBaseUrl())
      };
    }
  }

  async ensureCurrentUserRepositoryAccess(projectId: string, user: AuthenticatedUser, repositoryId?: string): Promise<RepositoryStatus> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const repository = repositoryId
      ? await this.findRepositoryRecordById(projectId, repositoryId)
      : await this.findRepositoryRecord(projectId);
    if (!repository) {
      return { connected: false };
    }

    await this.syncProjectRepositoryAccess(projectId);
    return this.getRepositoryStatus(projectId, user, repository.id);
  }

  private async bootstrapManagedRepositoryDocs(accessToken: string, remoteProject: GitlabProject): Promise<void> {
    const branch = remoteProject.default_branch ?? "main";
    await this.executeGitlabRequest<GitlabCommit>(
      accessToken,
      `/projects/${encodeURIComponent(remoteProject.id)}/repository/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          branch,
          commit_message: "Initialize Atlasium repository documentation",
          actions: [
            {
              action: "create",
              file_path: "AGENTS.md",
              content: MANAGED_REPOSITORY_AGENTS_MD
            },
            {
              action: "create",
              file_path: "Docs/Research/.gitkeep",
              content: ""
            },
            {
              action: "create",
              file_path: "Docs/Implementation/.gitkeep",
              content: ""
            }
          ]
        })
      }
    );
  }

  async provisionManagedRemoteRepository(
    projectKey: string,
    repositoryName: string,
    options: { path?: string; description?: string | null } = {}
  ): Promise<ManagedRepositoryProvision> {
    const repositoryPath = normalizeRepositoryPath(options.path ?? projectKey);

    return this.withSystemAccessToken(async (accessToken) => {
      const group = await this.ensureManagedGroup(accessToken);

      try {
        const remoteProject = await this.executeGitlabRequest<GitlabProject>(
          accessToken,
          "/projects",
          {
            method: "POST",
            body: JSON.stringify({
              namespace_id: group.id,
              name: repositoryName,
              path: repositoryPath,
              ...(options.description?.trim() ? { description: options.description.trim() } : {}),
              visibility: "private",
              initialize_with_readme: true,
              default_branch: "main"
            })
          }
        );

        await this.bootstrapManagedRepositoryDocs(accessToken, remoteProject);
        return mapManagedProvision(remoteProject);
      } catch (error) {
        if (error instanceof GitlabApiError && error.status === 400) {
          throw new BadRequestException(
            "Managed GitLab repository path already exists for this project key"
          );
        }
        throw this.mapInfrastructureError(error);
      }
    });
  }

  async registerManagedRepository(
    projectId: string,
    provisioned: ManagedRepositoryProvision,
    connectedByUserId: string
  ): Promise<RepositoryRecord> {
    return this.prisma.projectRepository.create({
      data: {
        projectId,
        gitlabProjectId: provisioned.gitlabProjectId,
        name: provisioned.name,
        description: provisioned.description,
        pathWithNamespace: provisioned.pathWithNamespace,
        webUrl: provisioned.webUrl,
        defaultBranch: provisioned.defaultBranch,
        visibility: provisioned.visibility,
        lastActivityAt: new Date(provisioned.lastActivityAt),
        connectedByUserId
      },
      include: {
        project: {
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            deletedAt: true
          }
        }
      }
    });
  }

  async rollbackManagedRemoteProvision(gitlabProjectId: string): Promise<void> {
    await this.deleteManagedRemoteRepository(gitlabProjectId);
  }

  async createRepository(
    projectId: string,
    dto: CreateProjectRepositoryDto,
    user: AuthenticatedUser
  ): Promise<RepositoryStatus> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

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

    const repositoryName = dto.name?.trim();
    if (!repositoryName) {
      throw new BadRequestException("Repository name is required");
    }
    const repositoryPathSuffix = normalizeRepositoryPath(dto.path?.trim() || repositoryName);
    const repositoryPath = normalizeRepositoryPath(`${atlasiumProject.key}-${repositoryPathSuffix}`);
    const provisioned = await this.provisionManagedRemoteRepository(atlasiumProject.key, repositoryName, {
      path: repositoryPath,
      description: dto.description
    });
    let repository: RepositoryRecord;

    try {
      repository = await this.registerManagedRepository(atlasiumProject.id, provisioned, user.userId);
    } catch (error) {
      await this.deleteManagedRemoteRepository(provisioned.gitlabProjectId);
      throw error;
    }

    try {
      await this.syncProjectRepositoryAccess(projectId);
    } catch (error) {
      await this.prisma.projectRepository.deleteMany({
        where: {
          id: repository.id
        }
      });
      await this.deleteManagedRemoteRepository(provisioned.gitlabProjectId);
      throw error;
    }

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_repository",
      entityId: repository.id,
      action: "project.repository.provision",
      metadata: {
        gitlabProjectId: provisioned.gitlabProjectId,
        pathWithNamespace: provisioned.pathWithNamespace
      }
    });

    return this.getRepositoryStatus(projectId, user, repository.id);
  }

  async linkRepository(
    _projectId: string,
    _dto: LinkProjectRepositoryDto,
    _user: AuthenticatedUser
  ): Promise<never> {
    throw new ForbiddenException("Managed GitLab repositories cannot be linked manually");
  }

  async disconnectRepository(_projectId: string, _user: AuthenticatedUser): Promise<never> {
    throw new ForbiddenException("Managed GitLab repositories cannot be disconnected manually");
  }

  async previewRepositoryRemoval(
    projectId: string,
    repositoryId: string,
    user: AuthenticatedUser
  ): Promise<RepositoryRemovalPreview> {
    await this.ensureProjectAdmin(projectId, user);
    const repository = await this.findRepositoryRecordById(projectId, repositoryId);
    if (!repository) {
      throw new NotFoundException("Repository not found");
    }

    const [repositoryCount, wikiDocsBindings] = await Promise.all([
      this.prisma.projectRepository.count({
        where: { projectId }
      }),
      this.countRepositoryWikiDocsBindings(repository.id)
    ]);

    return this.buildRepositoryRemovalPreview(repository, {
      lastRepository: repositoryCount <= 1,
      wikiDocsBindings
    });
  }

  async removeRepository(
    projectId: string,
    repositoryId: string,
    confirmation: string,
    user: AuthenticatedUser
  ): Promise<RepositoryRemovalResult> {
    await this.ensureProjectAdmin(projectId, user);
    const repository = await this.findRepositoryRecordById(projectId, repositoryId);
    if (!repository) {
      throw new NotFoundException("Repository not found");
    }

    if (confirmation !== repository.name) {
      throw new BadRequestException(`Type "${repository.name}" to archive this repository`);
    }

    const [repositoryCount, wikiDocsBindings] = await Promise.all([
      this.prisma.projectRepository.count({
        where: { projectId }
      }),
      this.countRepositoryWikiDocsBindings(repository.id)
    ]);
    const remoteResult = await this.archiveManagedRemoteRepository(repository.gitlabProjectId);
    const removedAt = new Date();
    let remainingRepositories = 0;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.projectRepository.delete({
          where: {
            id: repository.id
          }
        });
        remainingRepositories = await tx.projectRepository.count({
          where: { projectId }
        });
      });
    } catch (error) {
      if (remoteResult.remoteArchived && !remoteResult.remoteMissing) {
        await this.unarchiveManagedRemoteRepository(repository.gitlabProjectId).catch((rollbackError) => {
          this.logger.warn(
            JSON.stringify({
              code: "gitlab_repository_archive_rollback_failed",
              projectId,
              repositoryId: repository.id,
              gitlabProjectId: repository.gitlabProjectId,
              message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            })
          );
        });
      }
      throw error;
    }

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_repository",
      entityId: repository.id,
      action: "project.repository.archive",
      metadata: {
        gitlabProjectId: repository.gitlabProjectId,
        pathWithNamespace: repository.pathWithNamespace,
        lastRepository: repositoryCount <= 1,
        wikiDocsBindings
      }
    });

    return {
      repositoryId: repository.id,
      name: repository.name,
      pathWithNamespace: repository.pathWithNamespace,
      gitlabProjectId: repository.gitlabProjectId,
      remoteArchived: remoteResult.remoteArchived,
      remoteMissing: remoteResult.remoteMissing,
      removedAt: removedAt.toISOString(),
      remainingRepositories,
      wikiDocsBindingsRemoved: wikiDocsBindings.total
    };
  }

  async archiveManagedRepository(projectId: string): Promise<void> {
    const repositories = await this.findRepositoryRecords(projectId);
    if (repositories.length === 0) {
      return;
    }

    await this.withSystemAccessToken(async (accessToken) => {
      const archived: RepositoryRecord[] = [];
      for (const repository of repositories) {
        try {
          await this.executeGitlabRequest<void>(
            accessToken,
            `/projects/${encodeURIComponent(repository.gitlabProjectId)}/archive`,
            {
              method: "POST"
            }
          );
          archived.push(repository);
        } catch (error) {
          if (error instanceof GitlabApiError && error.status === 404) {
            continue;
          }
          await Promise.all(
            archived.map((archivedRepository) =>
              this.executeGitlabRequest<void>(
                accessToken,
                `/projects/${encodeURIComponent(archivedRepository.gitlabProjectId)}/unarchive`,
                {
                  method: "POST"
                }
              ).catch(() => undefined)
            )
          );
          throw this.mapInfrastructureError(error);
        }
      }
    });
  }

  async unarchiveManagedRepository(projectId: string): Promise<void> {
    const repositories = await this.findRepositoryRecords(projectId);
    if (repositories.length === 0) {
      return;
    }

    await this.withSystemAccessToken(async (accessToken) => {
      for (const repository of repositories) {
        try {
          await this.executeGitlabRequest<void>(
            accessToken,
            `/projects/${encodeURIComponent(repository.gitlabProjectId)}/unarchive`,
            {
              method: "POST"
            }
          );
        } catch (error) {
          if (error instanceof GitlabApiError && error.status === 404) {
            continue;
          }
          throw this.mapInfrastructureError(error);
        }
      }
    });
  }

  async syncProjectRepositoryAccess(projectId: string): Promise<void> {
    const repositories = await this.findRepositoryRecords(projectId);
    if (repositories.length === 0) {
      return;
    }

    await this.withSystemAccessToken(async (accessToken) => {
      try {
        const desiredMembers = await this.buildDesiredMembers(projectId, accessToken, repositories[0].project.deletedAt !== null);
        const systemUserId = getEnv().GITLAB_SYSTEM_USER_ID?.trim() || null;

        for (const repository of repositories) {
          const [currentMembers, effectiveMembers] = await Promise.all([
            this.executeGitlabRequest<GitlabProjectMember[]>(
              accessToken,
              `/projects/${encodeURIComponent(repository.gitlabProjectId)}/members?per_page=100`
            ),
            this.executeGitlabRequest<GitlabProjectMember[]>(
              accessToken,
              `/projects/${encodeURIComponent(repository.gitlabProjectId)}/members/all?per_page=100`
            )
          ]);
          const currentById = new Map(currentMembers.map((member) => [String(member.id), member]));
          const effectiveById = new Map(effectiveMembers.map((member) => [String(member.id), member]));

          for (const [gitlabUserId, accessLevel] of desiredMembers.entries()) {
            const existingMember = currentById.get(gitlabUserId);
            const effectiveMember = effectiveById.get(gitlabUserId);

            if (!existingMember) {
              if (effectiveMember && effectiveMember.access_level >= accessLevel) {
                continue;
              }

            await this.executeGitlabRequest<void>(
              accessToken,
              `/projects/${encodeURIComponent(repository.gitlabProjectId)}/members`,
              {
                method: "POST",
                body: JSON.stringify({
                  user_id: Number(gitlabUserId),
                  access_level: accessLevel
                })
              }
            );
              continue;
            }

            // When GitLab already grants enough access through the parent group, leave
            // the project membership unchanged instead of forcing a conflicting update.
            if (
              effectiveMember &&
              effectiveMember.access_level > existingMember.access_level &&
              effectiveMember.access_level >= accessLevel
            ) {
              continue;
            }

            if (existingMember.access_level !== accessLevel) {
              await this.executeGitlabRequest<void>(
                accessToken,
                `/projects/${encodeURIComponent(repository.gitlabProjectId)}/members/${encodeURIComponent(gitlabUserId)}`,
                {
                  method: "PUT",
                  body: JSON.stringify({
                    access_level: accessLevel
                  })
                }
              );
            }
          }

          for (const currentMember of currentMembers) {
            const gitlabUserId = String(currentMember.id);
            if (systemUserId && gitlabUserId === systemUserId) {
              continue;
            }
            if (desiredMembers.has(gitlabUserId)) {
              continue;
            }

            await this.executeGitlabRequest<void>(
              accessToken,
              `/projects/${encodeURIComponent(repository.gitlabProjectId)}/members/${encodeURIComponent(gitlabUserId)}`,
              {
                method: "DELETE"
              }
            );
          }
        }
      } catch (error) {
        throw this.mapInfrastructureError(error);
      }
    });
  }

  async listBranches(projectId: string, user: AuthenticatedUser, repositoryId?: string): Promise<Array<{
    name: string;
    default: boolean;
    merged: boolean;
    canPush: boolean;
    protected: boolean;
    webUrl: string | null;
  }>> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const branches = await this.executeGitlabRequest<GitlabBranch[]>(
        accessToken,
        buildRepositoryBranchesPath(repository.gitlabProjectId)
      );
      return branches.map(mapGitlabBranch);
    });
  }

  async listCommits(projectId: string, ref: string | undefined, user: AuthenticatedUser, repositoryId?: string): Promise<Array<{
    id: string;
    shortId: string;
    title: string;
    message: string;
    authoredDate: string;
    authorName: string;
    webUrl: string | null;
  }>> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const commits = await this.executeGitlabRequest<GitlabCommit[]>(
        accessToken,
        buildRepositoryCommitsPath(repository.gitlabProjectId, ref)
      );
      return commits.map(mapGitlabCommit);
    });
  }

  async getRepositoryTree(
    projectId: string,
    path: string | undefined,
    ref: string | undefined,
    user: AuthenticatedUser,
    repositoryId?: string
  ): Promise<{
    ref: string;
    path: string;
    entries: Array<{ id: string; name: string; path: string; type: "tree" | "blob" }>;
  }> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const resolvedRef = ref?.trim() || repository.defaultBranch;

      const entries = await this.executeGitlabRequest<GitlabTreeNode[]>(
        accessToken,
        buildRepositoryTreePath({
          gitlabProjectId: repository.gitlabProjectId,
          ref: resolvedRef,
          path,
          perPage: 200
        })
      );

      return {
        ref: resolvedRef,
        path: path?.trim() || "",
        entries: entries.map(mapGitlabTreeNode)
      };
    });
  }

  async getRepositoryFile(
    projectId: string,
    filePath: string,
    ref: string | undefined,
    user: AuthenticatedUser,
    repositoryId?: string
  ): Promise<{
    filePath: string;
    fileName: string;
    ref: string;
    size: number;
    binary: boolean;
    content: string | null;
  }> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);
    const normalizedFilePath = normalizeRepositoryFilePath(filePath);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const resolvedRef = ref?.trim() || repository.defaultBranch;
      const gitlabFile = await this.executeGitlabRequest<GitlabFile>(
        accessToken,
        buildRepositoryFilePath(repository.gitlabProjectId, normalizedFilePath, resolvedRef)
      );

      return mapGitlabFileContent(gitlabFile);
    });
  }

  async getRepositoryRawFile(
    projectId: string,
    filePath: string,
    ref: string | undefined,
    user: AuthenticatedUser,
    repositoryId?: string
  ): Promise<{
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);
    const normalizedFilePath = normalizeRepositoryFilePath(filePath);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const resolvedRef = ref?.trim() || repository.defaultBranch;

      try {
        const rawFile = await this.executeGitlabBinaryRequest(
          accessToken,
          buildRepositoryRawFilePath(repository.gitlabProjectId, normalizedFilePath, resolvedRef),
          {
            headers: {
              Accept: "*/*"
            }
          }
        );

        return mapGitlabRawFile(normalizedFilePath, rawFile);
      } catch (error) {
        throw this.mapRepositoryAccessError(error);
      }
    });
  }

  async listRepositoryDocsMarkdownFiles(
    projectId: string,
    user: AuthenticatedUser,
    repositoryId: string
  ): Promise<RepositoryDocsMarkdownFile[]> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const ref = repository.defaultBranch;
      const entries = await this.listRepositoryTreeRecursive(repository, accessToken, ref, GITLAB_DOCS_ROOT);
      const markdownEntries = entries
        .filter((entry) => entry.type === "blob" && isDocsMarkdownPath(entry.path))
        .sort((left, right) => left.path.localeCompare(right.path));

      if (markdownEntries.length > GITLAB_DOCS_MAX_MARKDOWN_FILES) {
        throw new BadRequestException(`Docs sync exceeded ${GITLAB_DOCS_MAX_MARKDOWN_FILES} Markdown files`);
      }

      const files: RepositoryDocsMarkdownFile[] = [];
      for (const entry of markdownEntries) {
        const gitlabFile = await this.readRepositoryTextFile(repository, accessToken, entry.path, ref);
        files.push(mapGitlabDocsMarkdownFile(gitlabFile));
      }

      return files;
    });
  }

  async getRepositoryTextFileForDocsSync(
    projectId: string,
    user: AuthenticatedUser,
    repositoryId: string,
    filePath: string
  ): Promise<RepositoryDocsMarkdownFile | null> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);
    const normalizedFilePath = normalizeRepositoryDocsFilePath(filePath);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      try {
        const gitlabFile = await this.readRepositoryTextFile(repository, accessToken, normalizedFilePath, repository.defaultBranch);
        return mapGitlabDocsMarkdownFile(gitlabFile);
      } catch (error) {
        if (error instanceof GitlabApiError && error.status === 404) {
          return null;
        }
        throw this.mapRepositoryAccessError(error);
      }
    });
  }

  async commitRepositoryFileActions(
    projectId: string,
    user: AuthenticatedUser,
    repositoryId: string,
    actions: RepositoryCommitFileAction[],
    commitMessage: string
  ): Promise<RepositoryDocsCommitResult> {
    const repository = await this.requireWritableRepository(projectId, user, repositoryId);
    const commitRequest = buildRepositoryCommitRequest({
      branch: repository.defaultBranch,
      commitMessage,
      actions
    });

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      try {
        const commit = await this.executeGitlabRequest<GitlabCommit>(
          accessToken,
          buildRepositoryCommitPath(repository.gitlabProjectId),
          {
            method: "POST",
            body: JSON.stringify(commitRequest.payload)
          }
        );

        await this.auditService.log({
          userId: user.userId,
          projectId,
          entityType: "project_repository",
          entityId: repository.id,
          action: "project.repository.docs.commit",
          metadata: {
            commitId: commit.id,
            actionCount: commitRequest.normalizedActions.length
          }
        });

        return mapRepositoryDocsCommitResult(commit);
      } catch (error) {
        throw this.mapRepositoryAccessError(error);
      }
    });
  }

  async listMergeRequests(
    projectId: string,
    state: RepositoryMergeRequestState | undefined,
    user: AuthenticatedUser,
    repositoryId?: string
  ): Promise<
    Array<{
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
    }>
  > {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      try {
        const mergeRequests = await this.executeGitlabRequest<GitlabMergeRequest[]>(
          accessToken,
          buildRepositoryMergeRequestsPath(repository.gitlabProjectId, state)
        );

        return mergeRequests.map(mapGitlabMergeRequest);
      } catch (error) {
        throw this.mapRepositoryAccessError(error);
      }
    });
  }

  async getRepositoryArchive(
    projectId: string,
    ref: string | undefined,
    user: AuthenticatedUser,
    repositoryId?: string
  ): Promise<{
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    const repository = await this.requireReadableRepository(projectId, user, repositoryId);

    return this.withUserAccessToken(user.userId, async (accessToken) => {
      const resolvedRef = ref?.trim() || repository.defaultBranch;
      let archiveSha: string;
      try {
        archiveSha = await this.resolveRepositoryArchiveSha(repository, resolvedRef, accessToken);
      } catch (error) {
        throw this.mapRepositoryAccessError(error);
      }

      const attempts = buildRepositoryArchiveAttempts(repository.gitlabProjectId, archiveSha);

      for (const attempt of attempts) {
        try {
          const archive = await this.executeGitlabBinaryRequest(
            accessToken,
            attempt.path,
            {
              headers: {
                Accept: attempt.accept
              }
            },
            {
              authMode: attempt.authMode ?? "header"
            }
          );

          return mapRepositoryArchiveResponse({
            pathWithNamespace: repository.pathWithNamespace,
            ref: resolvedRef,
            archive
          });
        } catch (error) {
          this.logArchiveAttemptFailure({
            attempt: attempt.label,
            error,
            projectId,
            repositoryId: repository.id,
            gitlabProjectId: repository.gitlabProjectId,
            resolvedRef,
            archiveSha
          });
          if (!(error instanceof GitlabApiError) || error.status !== 406) {
            throw this.mapRepositoryAccessError(error);
          }
        }
      }

      try {
        const buffer = await this.buildRepositoryArchiveFallback(repository, archiveSha, accessToken);
        return mapRepositoryArchiveResponse({
          pathWithNamespace: repository.pathWithNamespace,
          ref: resolvedRef,
          archive: { buffer, contentType: "application/zip" }
        });
      } catch (error) {
        this.logArchiveAttemptFailure({
          attempt: "atlasium_zip_fallback",
          error,
          projectId,
          repositoryId: repository.id,
          gitlabProjectId: repository.gitlabProjectId,
          resolvedRef,
          archiveSha
        });
        if (error instanceof BadRequestException) {
          throw error;
        }
        if (error instanceof GitlabApiError) {
          if (error.status === 406) {
            throw new BadGatewayException("GitLab archive download failed (gitlab_archive_406)");
          }
          throw this.mapRepositoryAccessError(error);
        }
        throw this.mapRepositoryAccessError(error);
      }
    });
  }

  private async resolveRepositoryArchiveSha(
    repository: RepositoryRecord,
    resolvedRef: string,
    accessToken: string
  ): Promise<string> {
    const commits = await this.executeGitlabRequest<GitlabCommit[]>(
      accessToken,
      buildRepositoryArchiveResolveCommitsPath(repository.gitlabProjectId, resolvedRef)
    );
    return resolveArchiveCommitSha(commits);
  }

  private async buildRepositoryArchiveFallback(
    repository: RepositoryRecord,
    archiveSha: string,
    accessToken: string
  ): Promise<Buffer> {
    const zip = new AdmZip();
    let page = 1;
    let fileCount = 0;
    let totalBytes = 0;

    while (true) {
      const entries = await this.executeGitlabRequest<GitlabTreeNode[]>(
        accessToken,
        buildRepositoryArchiveFallbackTreePath(repository.gitlabProjectId, archiveSha, page)
      );
      const files = entries.filter((entry) => entry.type === "blob");

      for (const file of files) {
        fileCount += 1;
        if (fileCount > GITLAB_ARCHIVE_FALLBACK_MAX_FILES) {
          throw new BadRequestException("GitLab archive fallback exceeded file limit (gitlab_archive_fallback_file_limit)");
        }

        const rawFile = await this.executeGitlabBinaryRequest(
          accessToken,
          buildRepositoryRawFilePath(repository.gitlabProjectId, file.path, archiveSha),
          {
            headers: {
              Accept: "*/*"
            }
          }
        );
        totalBytes += rawFile.buffer.length;
        if (totalBytes > GITLAB_ARCHIVE_FALLBACK_MAX_BYTES) {
          throw new BadRequestException("GitLab archive fallback exceeded size limit (gitlab_archive_fallback_size_limit)");
        }
        zip.addFile(file.path, rawFile.buffer);
      }

      if (entries.length < 100) {
        break;
      }
      page += 1;
    }

    return zip.toBuffer();
  }

  private async listRepositoryTreeRecursive(
    repository: RepositoryRecord,
    accessToken: string,
    ref: string,
    path: string
  ): Promise<GitlabTreeNode[]> {
    const entries: GitlabTreeNode[] = [];
    let page = 1;

    while (true) {
      let pageEntries: GitlabTreeNode[];
      try {
        pageEntries = await this.executeGitlabRequest<GitlabTreeNode[]>(
          accessToken,
          buildRepositoryRecursiveTreePath({
            gitlabProjectId: repository.gitlabProjectId,
            ref,
            path,
            page,
            pageSize: GITLAB_DOCS_TREE_PAGE_SIZE
          })
        );
      } catch (error) {
        if (error instanceof GitlabApiError && error.status === 404 && page === 1) {
          return [];
        }
        throw this.mapRepositoryAccessError(error);
      }

      entries.push(...pageEntries);
      if (pageEntries.length < GITLAB_DOCS_TREE_PAGE_SIZE) {
        break;
      }
      page += 1;
    }

    return entries;
  }

  private async readRepositoryTextFile(
    repository: RepositoryRecord,
    accessToken: string,
    filePath: string,
    ref: string
  ): Promise<Omit<GitlabFile, "content"> & { content: string }> {
    const gitlabFile = await this.executeGitlabRequest<GitlabFile>(
      accessToken,
      buildRepositoryFilePath(repository.gitlabProjectId, filePath, ref)
    );
    return readTextFromGitlabFile(gitlabFile, filePath);
  }

  private logArchiveAttemptFailure(params: {
    attempt: string;
    error: unknown;
    projectId: string;
    repositoryId: string;
    gitlabProjectId: string;
    resolvedRef: string;
    archiveSha: string;
  }): void {
    if (params.error instanceof GitlabApiError) {
      this.logger.warn(
        JSON.stringify({
          code: params.error.status === 406 ? "gitlab_archive_406" : "gitlab_archive_upstream_error",
          attempt: params.attempt,
          projectId: params.projectId,
          repositoryId: params.repositoryId,
          gitlabProjectId: params.gitlabProjectId,
          resolvedRef: params.resolvedRef,
          archiveSha: params.archiveSha,
          upstreamPath: params.error.metadata?.path ?? null,
          upstreamStatus: params.error.status,
          upstreamContentType: params.error.metadata?.contentType ?? null,
          upstreamRequestId: params.error.metadata?.requestId ?? null,
          upstreamGitlabMeta: params.error.metadata?.gitlabMeta ?? null,
          responsePreview: params.error.responseBody.slice(0, 300)
        })
      );
      return;
    }

    this.logger.warn(
      JSON.stringify({
        code: "gitlab_archive_proxy_error",
        attempt: params.attempt,
        projectId: params.projectId,
        repositoryId: params.repositoryId,
        gitlabProjectId: params.gitlabProjectId,
        resolvedRef: params.resolvedRef,
        archiveSha: params.archiveSha,
        message: params.error instanceof Error ? params.error.message : String(params.error)
      })
    );
  }

  async createBranch(
    projectId: string,
    dto: CreateRepositoryBranchDto,
    user: AuthenticatedUser,
    repositoryId?: string
  ): Promise<{ name: string; webUrl: string | null; default: boolean }> {
    const repository = await this.requireWritableRepository(projectId, user, repositoryId);
    const branchRequest = buildCreateBranchRequest(dto);

    const createdBranch = await this.withUserAccessToken(user.userId, async (accessToken) => {
      return this.executeGitlabRequest<GitlabBranch>(
        accessToken,
        buildRepositoryBranchesCollectionPath(repository.gitlabProjectId),
        {
          method: "POST",
          body: JSON.stringify(branchRequest.payload)
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
        sourceRef: branchRequest.sourceRef
      }
    });

    return mapCreatedBranch(createdBranch);
  }

  async createMergeRequest(
    projectId: string,
    dto: CreateRepositoryMergeRequestDto,
    user: AuthenticatedUser,
    repositoryId?: string
  ): Promise<{ id: number; iid: number; title: string; state: string; webUrl: string }> {
    const repository = await this.requireWritableRepository(projectId, user, repositoryId);
    const mergeRequestRequest = buildCreateMergeRequestRequest(dto);

    const mergeRequest = await this.withUserAccessToken(user.userId, async (accessToken) => {
      return this.executeGitlabRequest<GitlabMergeRequest>(
        accessToken,
        buildRepositoryMergeRequestsCollectionPath(repository.gitlabProjectId),
        {
          method: "POST",
          body: JSON.stringify(mergeRequestRequest.payload)
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
        sourceBranch: mergeRequestRequest.sourceBranch,
        targetBranch: mergeRequestRequest.targetBranch
      }
    });

    return mapCreatedMergeRequest(mergeRequest);
  }

  private async requireReadableRepository(projectId: string, user: AuthenticatedUser, repositoryId?: string): Promise<RepositoryRecord> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);
    const repository = repositoryId
      ? await this.findRepositoryRecordById(projectId, repositoryId)
      : await this.findRepositoryRecord(projectId);
    if (!repository) {
      throw new NotFoundException("This project repository is not provisioned yet");
    }
    return repository;
  }

  private async requireWritableRepository(projectId: string, user: AuthenticatedUser, repositoryId?: string): Promise<RepositoryRecord> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);
    const repository = repositoryId
      ? await this.findRepositoryRecordById(projectId, repositoryId)
      : await this.findRepositoryRecord(projectId);
    if (!repository) {
      throw new NotFoundException("This project repository is not provisioned yet");
    }
    return repository;
  }

  private async ensureProjectAdmin(projectId: string, user: AuthenticatedUser): Promise<void> {
    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);
    if (!access.isAdmin) {
      throw new ForbiddenException("Admin role is required to manage repositories");
    }
  }

  private async countRepositoryWikiDocsBindings(repositoryId: string): Promise<RepositoryRemovalBindingCounts> {
    const grouped = await this.prisma.wikiDocsBinding.groupBy({
      by: ["status"],
      where: { repositoryId },
      _count: {
        _all: true
      }
    });
    const counts: RepositoryRemovalBindingCounts = {
      total: 0,
      active: 0,
      deleted: 0,
      conflict: 0,
      error: 0,
      unassigned: 0
    };

    for (const row of grouped) {
      const count = row._count._all;
      counts.total += count;
      if (row.status === "active") {
        counts.active += count;
      } else if (row.status === "deleted") {
        counts.deleted += count;
      } else if (row.status === "conflict") {
        counts.conflict += count;
      } else if (row.status === "error") {
        counts.error += count;
      } else if (row.status === "unassigned") {
        counts.unassigned += count;
      }
    }

    return counts;
  }

  private buildRepositoryRemovalPreview(
    repository: RepositoryRecord,
    params: {
      lastRepository: boolean;
      wikiDocsBindings: RepositoryRemovalBindingCounts;
    }
  ): RepositoryRemovalPreview {
    const warnings = [
      "The managed GitLab project will be archived, not permanently deleted.",
      "Atlasium will remove this repository from Code."
    ];

    if (params.wikiDocsBindings.total > 0) {
      warnings.push("Repo Docs sync bindings will be removed. Existing Wiki pages remain available but stop syncing with this repository.");
    }
    if (params.lastRepository) {
      warnings.push("This is the last Code repository for the project.");
    }

    return {
      repository: {
        id: repository.id,
        name: repository.name,
        gitlabProjectId: repository.gitlabProjectId,
        pathWithNamespace: repository.pathWithNamespace,
        webUrl: repository.webUrl,
        defaultBranch: repository.defaultBranch,
        visibility: repository.visibility,
        lastActivityAt: repository.lastActivityAt.toISOString()
      },
      remoteAction: "archive",
      confirmationText: repository.name,
      lastRepository: params.lastRepository,
      wikiDocsBindings: params.wikiDocsBindings,
      warnings,
      blockers: []
    };
  }

  private async archiveManagedRemoteRepository(gitlabProjectId: string): Promise<{ remoteArchived: boolean; remoteMissing: boolean }> {
    return this.withSystemAccessToken(async (accessToken) => {
      try {
        await this.executeGitlabRequest<void>(
          accessToken,
          `/projects/${encodeURIComponent(gitlabProjectId)}/archive`,
          {
            method: "POST"
          }
        );
        return { remoteArchived: true, remoteMissing: false };
      } catch (error) {
        if (error instanceof GitlabApiError && error.status === 404) {
          return { remoteArchived: false, remoteMissing: true };
        }
        throw this.mapInfrastructureError(error);
      }
    });
  }

  private async unarchiveManagedRemoteRepository(gitlabProjectId: string): Promise<void> {
    await this.withSystemAccessToken(async (accessToken) => {
      try {
        await this.executeGitlabRequest<void>(
          accessToken,
          `/projects/${encodeURIComponent(gitlabProjectId)}/unarchive`,
          {
            method: "POST"
          }
        );
      } catch (error) {
        if (error instanceof GitlabApiError && error.status === 404) {
          return;
        }
        throw this.mapInfrastructureError(error);
      }
    });
  }

  private async findRepositoryRecordById(projectId: string, repositoryId: string): Promise<RepositoryRecord | null> {
    return this.prisma.projectRepository.findFirst({
      where: {
        id: repositoryId,
        projectId
      },
      include: this.repositoryRecordInclude()
    });
  }

  private async findRepositoryRecord(projectId: string): Promise<RepositoryRecord | null> {
    return this.findSoleRepositoryRecord(projectId);
  }

  private async findSoleRepositoryRecord(projectId: string): Promise<RepositoryRecord | null> {
    const repositories = await this.prisma.projectRepository.findMany({
      where: {
        projectId
      },
      orderBy: [
        { name: "asc" },
        { pathWithNamespace: "asc" }
      ],
      take: 2,
      include: this.repositoryRecordInclude()
    });

    if (repositories.length > 1) {
      throw new ConflictException("Multiple repositories exist for this project; use a repository-scoped endpoint");
    }

    return repositories[0] ?? null;
  }

  private async findRepositoryRecords(projectId: string): Promise<RepositoryRecord[]> {
    return this.prisma.projectRepository.findMany({
      where: {
        projectId
      },
      orderBy: [
        { name: "asc" },
        { pathWithNamespace: "asc" }
      ],
      include: this.repositoryRecordInclude()
    });
  }

  private repositoryRecordInclude() {
    return {
      project: {
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          deletedAt: true
        }
      }
    } as const;
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
          connection = await this.refreshConnectionSingleFlight(connection);
          continue;
        }

        throw error;
      }
    }
  }

  private async withSystemAccessToken<T>(callback: (accessToken: string) => Promise<T>): Promise<T> {
    const accessToken = this.getManagedGitlabConfig().systemAccessToken;
    return callback(accessToken);
  }

  private async requireConnectionRecord(userId: string): Promise<GitLabConnection> {
    const connection = await this.prisma.gitLabConnection.findUnique({
      where: {
        userId
      }
    });

    if (!connection) {
      throw new UnauthorizedException("GitLab API access is not connected for this Atlasium account");
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

    return this.refreshConnectionSingleFlight(connection);
  }

  private async refreshConnectionSingleFlight(connection: GitLabConnection): Promise<GitLabConnection> {
    const existingRefresh = this.refreshConnectionByUserId.get(connection.userId);
    if (existingRefresh) {
      return existingRefresh;
    }

    const refreshPromise = this.refreshConnection(connection)
      .catch(async (error) => {
        if (error instanceof UnauthorizedException) {
          await this.markReconnectRequired(connection.userId);
          throw new UnauthorizedException("GitLab reconnection required");
        }

        throw error;
      })
      .finally(() => {
        this.refreshConnectionByUserId.delete(connection.userId);
      });

    this.refreshConnectionByUserId.set(connection.userId, refreshPromise);
    return refreshPromise;
  }

  private async refreshConnection(connection: GitLabConnection): Promise<GitLabConnection> {
    if (!connection.refreshTokenEncrypted) {
      await this.markReconnectRequired(connection.userId);
      throw new UnauthorizedException("GitLab reconnection required");
    }

    const refreshToken = decryptValue(connection.refreshTokenEncrypted, getEnv().JWT_SECRET);
    const refreshedPayload = await this.exchangeUserOAuthToken({
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
        tokenExpiresAt: resolveTokenExpiry(refreshedPayload),
        reconnectRequired: false
      }
    });
  }

  private async exchangeUserOAuthToken(params: {
    grantType: "authorization_code" | "refresh_token";
    params: Record<string, string>;
  }): Promise<GitlabOAuthTokenPayload> {
    const config = this.getGitlabUserOauthConfig();
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: params.grantType,
      ...params.params
    });

    const response = await fetch(`${config.apiBaseUrl}/oauth/token`, {
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
    return executeGitlabJsonRequest<T>({
      apiBaseUrl: this.getGitlabApiBaseUrl(),
      accessToken,
      path,
      init
    });
  }

  private async executeGitlabBinaryRequest(
    accessToken: string,
    path: string,
    init?: RequestInit,
    options?: GitlabBinaryRequestOptions
  ): Promise<GitlabBinaryResponse> {
    return executeGitlabBinaryClientRequest({
      apiBaseUrl: this.getGitlabApiBaseUrl(),
      accessToken,
      path,
      init,
      options
    });
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
      return new BadRequestException(this.extractGitlabErrorMessage(error.responseBody, "GitLab request failed"));
    }

    return error instanceof Error ? error : new BadGatewayException("GitLab request failed");
  }

  private mapInfrastructureError(error: unknown): Error {
    if (error instanceof GitlabApiError) {
      if (error.status === 401 || error.status === 403) {
        return new ServiceUnavailableException("Atlasium GitLab system token is not authorized");
      }
      if (error.status === 404) {
        return new ServiceUnavailableException("Atlasium managed GitLab group is not available");
      }
      if (error.status >= 500) {
        return new BadGatewayException("GitLab is currently unavailable");
      }
      return new BadRequestException(
        this.extractGitlabErrorMessage(error.responseBody, "GitLab infrastructure request failed")
      );
    }

    return error instanceof Error ? error : new BadGatewayException("GitLab infrastructure request failed");
  }

  private mapUserSshKeyError(error: unknown): Error {
    if (error instanceof GitlabApiError) {
      if (error.status === 401) {
        return new UnauthorizedException("GitLab reconnection required");
      }
      if (error.status === 403) {
        return new ForbiddenException("Your connected GitLab account cannot manage SSH keys");
      }
      if (error.status === 404) {
        return new NotFoundException("SSH key not found");
      }
      if (error.status >= 500) {
        return new BadGatewayException("GitLab is currently unavailable");
      }
      return new BadRequestException(this.extractGitlabErrorMessage(error.responseBody, "GitLab SSH key request failed"));
    }

    return error instanceof Error ? error : new BadGatewayException("GitLab SSH key request failed");
  }

  private mapHttpsPasswordSyncError(error: unknown): Error {
    if (error instanceof GitlabApiError) {
      if (error.status === 401 || error.status === 403) {
        return new ServiceUnavailableException("Atlasium GitLab system token is not authorized");
      }
      if (error.status >= 500) {
        return new BadGatewayException("GitLab is currently unavailable");
      }
      return new BadRequestException(
        this.extractGitlabErrorMessage(error.responseBody, "Unable to sync GitLab HTTPS password")
      );
    }

    return error instanceof Error ? error : new BadGatewayException("Unable to sync GitLab HTTPS password");
  }

  private ensureGlobalAdmin(user: AuthenticatedUser): void {
    if (user.globalRole !== "admin") {
      throw new ForbiddenException("Only admins can manage project repositories");
    }
  }

  private extractGitlabErrorMessage(responseBody: string, fallback: string): string {
    const normalized = responseBody.trim();
    if (!normalized) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(normalized) as { message?: unknown; error?: unknown };
      const messageParts = this.collectGitlabErrorMessages(parsed.message ?? parsed.error ?? parsed);
      if (messageParts.length > 0) {
        return messageParts.join(". ");
      }
    } catch {
      return normalized;
    }

    return normalized;
  }

  private collectGitlabErrorMessages(value: unknown): string[] {
    if (typeof value === "string") {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.collectGitlabErrorMessages(entry));
    }

    if (value && typeof value === "object") {
      return Object.values(value).flatMap((entry) => this.collectGitlabErrorMessages(entry));
    }

    return [];
  }

  private getGitlabApiBaseUrl(): string {
    const env = getEnv();
    if (!env.GITLAB_BASE_URL) {
      throw new ServiceUnavailableException("GitLab API base URL is not configured");
    }

    return env.GITLAB_BASE_URL.replace(/\/+$/, "");
  }

  private getGitlabBrowserBaseUrl(): string {
    const env = getEnv();
    const baseUrl = env.GITLAB_EXTERNAL_URL ?? env.GITLAB_BASE_URL;
    if (!baseUrl) {
      throw new ServiceUnavailableException("GitLab external URL is not configured");
    }

    return baseUrl.replace(/\/+$/, "");
  }

  private getGitlabUserOauthConfig(): {
    apiBaseUrl: string;
    browserBaseUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    const env = getEnv();
    if (!env.GITLAB_OAUTH_CLIENT_ID || !env.GITLAB_OAUTH_CLIENT_SECRET) {
      throw new ServiceUnavailableException("GitLab OAuth access is not configured");
    }

    return {
      apiBaseUrl: this.getGitlabApiBaseUrl(),
      browserBaseUrl: this.getGitlabBrowserBaseUrl(),
      clientId: env.GITLAB_OAUTH_CLIENT_ID,
      clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
      redirectUri: env.GITLAB_OAUTH_REDIRECT_URI ?? `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/auth/gitlab/callback`
    };
  }

  private getManagedGitlabConfig(): {
    systemAccessToken: string;
    managedGroupId?: string;
    managedGroupPath?: string;
    managedGroupName?: string;
  } {
    const env = getEnv();
    if (!env.GITLAB_SYSTEM_ACCESS_TOKEN) {
      throw new ServiceUnavailableException("Atlasium managed GitLab token is not configured");
    }

    return {
      systemAccessToken: env.GITLAB_SYSTEM_ACCESS_TOKEN,
      managedGroupId: env.GITLAB_MANAGED_GROUP_ID?.trim() || undefined,
      managedGroupPath: env.GITLAB_MANAGED_GROUP_PATH?.trim() || undefined,
      managedGroupName: env.GITLAB_MANAGED_GROUP_NAME?.trim() || undefined
    };
  }

  private async ensureManagedGroup(accessToken: string): Promise<GitlabGroup> {
    const config = this.getManagedGitlabConfig();

    if (config.managedGroupId) {
      return this.executeGitlabRequest<GitlabGroup>(
        accessToken,
        `/groups/${encodeURIComponent(config.managedGroupId)}`
      );
    }

    if (!config.managedGroupPath || !config.managedGroupName) {
      throw new ServiceUnavailableException(
        "Atlasium managed GitLab group is not configured"
      );
    }

    try {
      return await this.executeGitlabRequest<GitlabGroup>(
        accessToken,
        `/groups/${encodeURIComponent(config.managedGroupPath)}`
      );
    } catch (error) {
      if (!(error instanceof GitlabApiError) || error.status !== 404) {
        throw this.mapInfrastructureError(error);
      }
    }

    try {
      return await this.executeGitlabRequest<GitlabGroup>(accessToken, "/groups", {
        method: "POST",
        body: JSON.stringify({
          path: config.managedGroupPath,
          name: config.managedGroupName,
          visibility: "private"
        })
      });
    } catch (error) {
      throw this.mapInfrastructureError(error);
    }
  }

  private async deleteManagedRemoteRepository(gitlabProjectId: string): Promise<void> {
    await this.withSystemAccessToken(async (accessToken) => {
      try {
        await this.executeGitlabRequest<void>(
          accessToken,
          `/projects/${encodeURIComponent(gitlabProjectId)}`,
          { method: "DELETE" }
        );
      } catch {
        // Best effort rollback only.
      }
    });
  }

  private async buildDesiredMembers(
    projectId: string,
    accessToken: string,
    projectDeleted: boolean
  ): Promise<Map<string, number>> {
    const desired = new Map<string, number>();
    const gitlabUserCache = new Map<string, string | null>();

    const [admins, projectMembers] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          globalRole: GlobalRole.ADMIN
        },
        select: {
          id: true,
          email: true,
          name: true,
          username: true
        }
      }),
      projectDeleted
        ? this.prisma.projectMember.findMany({
            where: {
              projectId: "__never__"
            },
            select: {
              user: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                  username: true,
                  globalRole: true
                }
              },
              role: true
            }
          })
        : this.prisma.projectMember.findMany({
            where: {
              projectId,
              user: {
                deletedAt: null,
                isActive: true
              }
            },
            select: {
              user: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                  username: true,
                  globalRole: true
                }
              },
              role: true
            }
          })
    ]);

    for (const admin of admins) {
      const gitlabUserId = await this.resolveGitlabUserId(
        { id: admin.id, email: admin.email, name: admin.name, username: admin.username },
        accessToken,
        gitlabUserCache
      );
      if (gitlabUserId) {
        desired.set(gitlabUserId, GITLAB_ACCESS_LEVEL_MAINTAINER);
      }
    }

    for (const membership of projectMembers) {
      if (membership.user.globalRole === GlobalRole.ADMIN) {
        continue;
      }

      const gitlabUserId = await this.resolveGitlabUserId(
        {
          id: membership.user.id,
          email: membership.user.email,
          name: membership.user.name,
          username: membership.user.username
        },
        accessToken,
        gitlabUserCache
      );
      if (!gitlabUserId) {
        continue;
      }

      const accessLevel = membership.role === ProjectRole.EDITOR
        ? GITLAB_ACCESS_LEVEL_DEVELOPER
        : GITLAB_ACCESS_LEVEL_REPORTER;
      const existing = desired.get(gitlabUserId) ?? 0;
      desired.set(gitlabUserId, Math.max(existing, accessLevel));
    }

    return desired;
  }

  private async resolveGitlabUserId(
    user: ManagedGitlabUser,
    accessToken: string,
    cache: Map<string, string | null>
  ): Promise<string | null> {
    if (cache.has(user.id)) {
      return cache.get(user.id) ?? null;
    }

    const syncedUser = await this.upsertManagedOidcUser(user, accessToken);
    const gitlabUserId = String(syncedUser.id);
    cache.set(user.id, gitlabUserId);
    return gitlabUserId;
  }

  private async assertGitlabUserMatchesAtlasiumIdentity(userId: string, gitlabUser: GitlabCurrentUser): Promise<void> {
    if (this.hasAtlasiumOidcIdentity(gitlabUser, userId)) {
      return;
    }

    const matchedUser = await this.withSystemAccessToken((accessToken) =>
      this.findGitlabUserByAtlasiumIdentity(userId, accessToken)
    );
    if (matchedUser && String(matchedUser.id) === String(gitlabUser.id)) {
      return;
    }

    throw new BadRequestException(
      "Connected GitLab account does not match this Atlasium user. Sign in to GitLab through Atlasium SSO, then reconnect."
    );
  }

  private hasAtlasiumOidcIdentity(
    user: { identities?: GitlabIdentity[] },
    atlasiumUserId: string
  ): boolean {
    return user.identities?.some((identity) =>
      identity.provider === "openid_connect" && identity.extern_uid === atlasiumUserId
    ) ?? false;
  }

  private async findGitlabUserByAtlasiumIdentity(
    atlasiumUserId: string,
    accessToken: string
  ): Promise<GitlabUserSearchResult | null> {
    const search = new URLSearchParams({
      extern_uid: atlasiumUserId,
      provider: "openid_connect"
    });
    const matches = await this.executeGitlabRequest<GitlabUserSearchResult[]>(
      accessToken,
      `/users?${search.toString()}`
    );

    return matches.find((candidate) => this.hasAtlasiumOidcIdentity(candidate, atlasiumUserId)) ?? matches[0] ?? null;
  }

  private async createManagedOidcUser(
    user: ManagedGitlabUser,
    accessToken: string,
    password?: string
  ): Promise<GitlabUserSearchResult> {
    return this.executeGitlabRequest<GitlabUserSearchResult>(
      accessToken,
      "/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: user.username,
          name: user.name,
          email: user.email,
          provider: "openid_connect",
          extern_uid: user.id,
          skip_confirmation: true,
          can_create_group: false,
          projects_limit: 0,
          ...(password ? { password } : { force_random_password: true })
        })
      }
    );
  }

  private async ensureGitPasswordAuthenticationEnabled(accessToken: string): Promise<void> {
    const settings = await this.executeGitlabRequest<GitlabApplicationSettings>(
      accessToken,
      "/application/settings"
    );

    if (settings.password_authentication_enabled_for_git === true) {
      return;
    }

    await this.executeGitlabRequest<GitlabApplicationSettings>(
      accessToken,
      "/application/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          password_authentication_enabled_for_git: true
        })
      }
    );
  }

  private async updateManagedOidcUser(
    gitlabUserId: number,
    body: { username?: string; password?: string },
    accessToken: string
  ): Promise<GitlabUserSearchResult> {
    return this.executeGitlabRequest<GitlabUserSearchResult>(
      accessToken,
      `/users/${encodeURIComponent(String(gitlabUserId))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          ...body,
          ...(body.password ? { skip_reconfirmation: true } : {})
        })
      }
    );
  }

  private async upsertManagedOidcUser(
    user: ManagedGitlabUser,
    accessToken: string,
    options?: { password?: string }
  ): Promise<GitlabUserSearchResult> {
    const oidcUser = await this.findGitlabUserByAtlasiumIdentity(user.id, accessToken);
    await this.assertGitlabUsernameAvailable(user.username, oidcUser?.id, user.id, accessToken);

    if (!oidcUser) {
      return this.createManagedOidcUser(user, accessToken, options?.password);
    }

    const updateBody: { username?: string; password?: string } = {};
    if (oidcUser.username !== user.username) {
      updateBody.username = user.username;
    }
    if (options?.password) {
      updateBody.password = options.password;
    }

    if (Object.keys(updateBody).length === 0) {
      return oidcUser;
    }

    return this.updateManagedOidcUser(oidcUser.id, updateBody, accessToken);
  }

  private async assertGitlabUsernameAvailable(
    username: string,
    allowedGitlabUserId: number | undefined,
    atlasiumUserId: string,
    accessToken: string
  ): Promise<void> {
    const search = new URLSearchParams({
      username
    });
    const matches = await this.executeGitlabRequest<GitlabUserSearchResult[]>(
      accessToken,
      `/users?${search.toString()}`
    );

    const conflictingUser = matches.find((candidate) => {
      if (allowedGitlabUserId && String(candidate.id) === String(allowedGitlabUserId)) {
        return false;
      }

      return !this.hasAtlasiumOidcIdentity(candidate, atlasiumUserId);
    });

    if (conflictingUser) {
      throw new BadRequestException("GitLab username is already in use");
    }
  }

  private async updateStoredConnectionFromGitlabUser(
    atlasiumUserId: string,
    gitlabUser: GitlabUserSearchResult
  ): Promise<void> {
    await this.prisma.gitLabConnection.updateMany({
      where: {
        userId: atlasiumUserId,
        gitlabUserId: String(gitlabUser.id)
      },
      data: {
        username: gitlabUser.username,
        name: gitlabUser.name,
        email: gitlabUser.email,
        avatarUrl: gitlabUser.avatar_url,
        webUrl: gitlabUser.web_url
      }
    });
  }

  private mapManagedUserIdentityError(error: unknown): Error {
    if (error instanceof GitlabApiError) {
      if (error.status === 401 || error.status === 403) {
        return new ServiceUnavailableException("Atlasium GitLab system token is not authorized");
      }
      if (error.status >= 500) {
        return new BadGatewayException("GitLab is currently unavailable");
      }
      return new BadRequestException(
        this.extractGitlabErrorMessage(error.responseBody, "Unable to sync GitLab username")
      );
    }

    return error instanceof Error ? error : new BadGatewayException("Unable to sync GitLab username");
  }
}
