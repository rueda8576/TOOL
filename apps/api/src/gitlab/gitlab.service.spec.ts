import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import AdmZip from "adm-zip";

import { encryptValue } from "../common/crypto";
import * as envModule from "../config/env";
import { buildRepositoryArchiveFileName } from "./gitlab-format";
import { normalizeRepositoryPath, normalizeUserSshKeyId, resolveTokenExpiry } from "./gitlab-mappers";
import { GitlabService } from "./gitlab.service";

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: {
    get: (name: string) => string | null;
  };
};

function jsonResponse(status: number, body?: unknown, headers?: Record<string, string>): FetchResponse {
  const textBody = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => textBody,
    arrayBuffer: async () => new TextEncoder().encode(textBody).buffer,
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? headers?.[name] ?? null
    }
  };
}

function binaryResponse(status: number, body: Uint8Array, headers?: Record<string, string>): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => new TextDecoder().decode(body),
    arrayBuffer: async () => Uint8Array.from(body).buffer,
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? headers?.[name] ?? null
    }
  };
}

describe("GitlabService", () => {
  const repositoryRecord = {
    id: "repo-1",
    projectId: "project-1",
    gitlabProjectId: "123",
    name: "Navigation",
    description: null,
    pathWithNamespace: "atlasium/nav",
    webUrl: "https://git.atlasium.info/atlasium/nav",
    defaultBranch: "main",
    visibility: "private",
    lastActivityAt: new Date("2026-03-31T18:00:00.000Z"),
    connectedByUserId: "admin-1",
    connectedAt: new Date("2026-03-31T18:00:00.000Z"),
    updatedAt: new Date("2026-03-31T18:00:00.000Z"),
    project: {
      id: "project-1",
      key: "NAV",
      name: "Navigation",
      description: null,
      deletedAt: null
    }
  };

  const makeServiceWithDeps = (): {
    service: GitlabService;
    prisma: any;
    accessService: any;
    auditService: any;
  } => {
    const prisma: any = {
      $transaction: jest.fn(),
      gitLabConnection: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn()
      },
      project: {
        findFirst: jest.fn()
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn()
      },
      projectRepository: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn()
      },
      wikiDocsBinding: {
        groupBy: jest.fn()
      }
    };
    const accessService: any = {
      ensureProjectReadable: jest.fn().mockResolvedValue(undefined),
      ensureProjectWritable: jest.fn().mockResolvedValue(undefined),
      getProjectAccess: jest.fn().mockResolvedValue(undefined)
    };
    const auditService: any = {
      log: jest.fn().mockResolvedValue(undefined)
    };
    return {
      service: new GitlabService(prisma, accessService, auditService),
      prisma,
      accessService,
      auditService
    };
  };

  const makeService = (): GitlabService => makeServiceWithDeps().service;

  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env.GITLAB_BASE_URL = "https://git.atlasium.info";
    process.env.GITLAB_EXTERNAL_URL = "https://git.atlasium.info";
    process.env.GITLAB_OAUTH_CLIENT_ID = "client-id";
    process.env.GITLAB_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GITLAB_OAUTH_REDIRECT_URI = "https://atlasium.info/api/auth/gitlab/callback";
    process.env.GITLAB_SYSTEM_ACCESS_TOKEN = "system-token";
    process.env.GITLAB_SYSTEM_USER_ID = "999";
    process.env.GITLAB_MANAGED_GROUP_ID = "3";
    process.env.GITLAB_MANAGED_GROUP_PATH = "atlasium";
    process.env.GITLAB_MANAGED_GROUP_NAME = "Atlasium";
    process.env.JWT_SECRET = "integration-secret-123";
    fetchSpy = jest.spyOn(global, "fetch");
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("builds the GitLab authorization URL with the expected OAuth parameters", () => {
    const service = makeService();

    const url = new URL(service.buildAuthorizationUrl("state-123"));

    expect(url.origin + url.pathname).toBe("https://git.atlasium.info/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://atlasium.info/api/auth/gitlab/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("api read_user");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("exchanges an authorization code, upserts the connection, and returns connection status", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "luis@example.com",
      name: "Luis",
      username: "luis"
    });
    jest.spyOn(service as any, "exchangeUserOAuthToken").mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "api read_user"
    });
    jest.spyOn(service as any, "fetchGitlabUser").mockResolvedValue({
      id: 7,
      username: "luis",
      name: "Luis",
      email: "luis@example.com",
      avatar_url: "https://git.atlasium.info/avatar.png",
      web_url: "https://git.atlasium.info/luis",
      identities: [{ provider: "openid_connect", extern_uid: "user-1" }]
    });
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: 7,
            username: "luis",
            name: "Luis",
            email: "luis@example.com",
            avatar_url: "https://git.atlasium.info/avatar.png",
            web_url: "https://git.atlasium.info/luis",
            identities: [{ provider: "openid_connect", extern_uid: "user-1" }]
          }
        ]) as Response
      )
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: 7,
            username: "luis",
            identities: [{ provider: "openid_connect", extern_uid: "user-1" }]
          }
        ]) as Response
      );
    prisma.gitLabConnection.findUnique.mockResolvedValue({
      username: "luis",
      name: "Luis",
      email: "luis@example.com",
      avatarUrl: "https://git.atlasium.info/avatar.png",
      webUrl: "https://git.atlasium.info/luis",
      reconnectRequired: false
    });

    await expect(service.exchangeAuthorizationCode("user-1", "code-123")).resolves.toEqual({
      connected: true,
      reconnectRequired: false,
      username: "luis",
      name: "Luis",
      email: "luis@example.com",
      avatarUrl: "https://git.atlasium.info/avatar.png",
      webUrl: "https://git.atlasium.info/luis",
      httpsClone: {
        enabled: false,
        syncedAt: null,
        username: "luis"
      }
    });

    expect(prisma.gitLabConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        create: expect.objectContaining({
          userId: "user-1",
          gitlabUserId: "7",
          reconnectRequired: false,
          accessTokenEncrypted: expect.any(String),
          refreshTokenEncrypted: expect.any(String)
        }),
        update: expect.objectContaining({
          gitlabUserId: "7",
          reconnectRequired: false
        })
      })
    );
  });

  it("rejects GitLab OAuth connections that do not match the Atlasium OIDC identity", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      username: "user"
    });
    jest.spyOn(service as any, "exchangeUserOAuthToken").mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: "api read_user"
    });
    jest.spyOn(service as any, "fetchGitlabUser").mockResolvedValue({
      id: 1,
      username: "root",
      name: "Root",
      email: "root@git.atlasium.info",
      identities: []
    });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, []) as Response);

    await expect(service.exchangeAuthorizationCode("user-1", "code-123")).rejects.toMatchObject({
      constructor: BadRequestException,
      message: "Connected GitLab account does not match this Atlasium user. Sign in to GitLab through Atlasium SSO, then reconnect."
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://git.atlasium.info/api/v4/users?extern_uid=user-1&provider=openid_connect"
    );
  });

  it("disconnects an existing GitLab connection and returns false when none exists", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.gitLabConnection.findUnique
      .mockResolvedValueOnce({ userId: "user-1" })
      .mockResolvedValueOnce(null);

    await expect(service.disconnectUserConnection("user-1")).resolves.toBe(true);
    await expect(service.disconnectUserConnection("user-1")).resolves.toBe(false);

    expect(prisma.gitLabConnection.delete).toHaveBeenCalledWith({
      where: {
        userId: "user-1"
      }
    });
  });

  it("returns a disconnected connection status when no GitLab OAuth record exists", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.gitLabConnection.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      username: "atlasium-user",
      gitlabHttpsPasswordSyncedAt: null
    });

    await expect(service.getConnectionStatus("user-1")).resolves.toEqual({
      connected: false,
      reconnectRequired: false,
      httpsClone: {
        enabled: false,
        syncedAt: null,
        username: "atlasium-user"
      }
    });
  });

  it("returns connected GitLab status with persistent HTTPS clone state", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.gitLabConnection.findUnique.mockResolvedValue({
      username: "gitlab-user",
      name: "GitLab User",
      email: "gitlab@example.com",
      avatarUrl: null,
      webUrl: "https://git.atlasium.info/gitlab-user",
      reconnectRequired: false
    });
    prisma.user.findUnique.mockResolvedValue({
      username: "atlasium-user",
      gitlabHttpsPasswordSyncedAt: new Date("2026-06-07T10:00:00.000Z")
    });

    await expect(service.getConnectionStatus("user-1")).resolves.toEqual({
      connected: true,
      reconnectRequired: false,
      username: "gitlab-user",
      name: "GitLab User",
      email: "gitlab@example.com",
      avatarUrl: null,
      webUrl: "https://git.atlasium.info/gitlab-user",
      httpsClone: {
        enabled: true,
        syncedAt: "2026-06-07T10:00:00.000Z",
        username: "gitlab-user"
      }
    });
  });

  it("validates GitLab config helpers when required env values are missing", () => {
    const service = makeService();
    const envSpy = jest.spyOn(envModule, "getEnv");

    envSpy.mockReturnValueOnce({
      APP_BASE_URL: "https://atlasium.info"
    } as any);
    expect(() => (service as any).getGitlabApiBaseUrl()).toThrow(ServiceUnavailableException);

    envSpy.mockReturnValueOnce({
      APP_BASE_URL: "https://atlasium.info",
      GITLAB_BASE_URL: undefined,
      GITLAB_EXTERNAL_URL: undefined
    } as any);
    expect(() => (service as any).getGitlabBrowserBaseUrl()).toThrow(ServiceUnavailableException);

    envSpy.mockReturnValueOnce({
      APP_BASE_URL: "https://atlasium.info",
      GITLAB_BASE_URL: "https://git.atlasium.info",
      GITLAB_EXTERNAL_URL: "https://git.atlasium.info",
      GITLAB_OAUTH_CLIENT_ID: undefined,
      GITLAB_OAUTH_CLIENT_SECRET: undefined
    } as any);
    expect(() => (service as any).getGitlabUserOauthConfig()).toThrow(ServiceUnavailableException);

    envSpy.mockReturnValueOnce({
      APP_BASE_URL: "https://atlasium.info",
      GITLAB_BASE_URL: "https://git.atlasium.info",
      GITLAB_EXTERNAL_URL: "https://git.atlasium.info",
      GITLAB_SYSTEM_ACCESS_TOKEN: undefined
    } as any);
    expect(() => (service as any).getManagedGitlabConfig()).toThrow(ServiceUnavailableException);
  });

  it("resolves the managed GitLab group by explicit id, existing path, or on-demand creation", async () => {
    const service = makeService();
    const getManagedGitlabConfigSpy = jest.spyOn(service as any, "getManagedGitlabConfig");
    const executeGitlabRequestSpy = jest.spyOn(service as any, "executeGitlabRequest");

    getManagedGitlabConfigSpy.mockReturnValueOnce({
      systemAccessToken: "system-token",
      managedGroupId: "3"
    });
    executeGitlabRequestSpy.mockResolvedValueOnce({ id: 3, path: "atlasium", name: "Atlasium" });

    await expect((service as any).ensureManagedGroup("system-token")).resolves.toEqual({
      id: 3,
      path: "atlasium",
      name: "Atlasium"
    });
    expect(executeGitlabRequestSpy).toHaveBeenNthCalledWith(1, "system-token", "/groups/3");

    getManagedGitlabConfigSpy.mockReturnValueOnce({
      systemAccessToken: "system-token",
      managedGroupPath: "atlasium",
      managedGroupName: "Atlasium"
    });
    executeGitlabRequestSpy.mockResolvedValueOnce({ id: 4, path: "atlasium", name: "Atlasium" });

    await expect((service as any).ensureManagedGroup("system-token")).resolves.toEqual({
      id: 4,
      path: "atlasium",
      name: "Atlasium"
    });
    expect(executeGitlabRequestSpy).toHaveBeenNthCalledWith(2, "system-token", "/groups/atlasium");

    executeGitlabRequestSpy.mockRestore();
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "group missing"
    } as Response);
    let notFoundError: unknown;
    try {
      await (service as any).executeGitlabRequest("token", "/failing");
    } catch (error) {
      notFoundError = error;
    }
    const ensureManagedGroupExecuteSpy = jest.spyOn(service as any, "executeGitlabRequest");
    getManagedGitlabConfigSpy.mockReturnValueOnce({
      systemAccessToken: "system-token",
      managedGroupPath: "atlasium",
      managedGroupName: "Atlasium"
    });
    ensureManagedGroupExecuteSpy
      .mockRejectedValueOnce(notFoundError)
      .mockResolvedValueOnce({ id: 5, path: "atlasium", name: "Atlasium" });

    await expect((service as any).ensureManagedGroup("system-token")).resolves.toEqual({
      id: 5,
      path: "atlasium",
      name: "Atlasium"
    });
    expect(ensureManagedGroupExecuteSpy).toHaveBeenNthCalledWith(2, "system-token", "/groups", {
      method: "POST",
      body: JSON.stringify({
        path: "atlasium",
        name: "Atlasium",
        visibility: "private"
      })
    });
  });

  it("falls back to repository metadata when GitLab project lookup fails", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    fetchSpy.mockRejectedValueOnce(new Error("network down"));

    await expect(
      service.getRepositoryStatus("project-1", {
        userId: "reader-1",
        globalRole: "reader"
      } as any)
    ).resolves.toEqual(
      expect.objectContaining({
        connected: true,
        gitlabProjectId: "123",
        webUrl: "https://git.atlasium.info/atlasium/nav",
        sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
        httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git",
        pathWithNamespace: "atlasium/nav",
        managed: true
      })
    );
  });

  it("rejects legacy singular repository resolution when multiple repositories exist", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.projectRepository.findMany.mockResolvedValue([
      repositoryRecord,
      {
        ...repositoryRecord,
        id: "repo-2",
        gitlabProjectId: "456",
        name: "Experiments",
        pathWithNamespace: "atlasium/experiments"
      }
    ]);

    await expect(
      service.getRepositoryStatus("project-1", {
        userId: "reader-1",
        globalRole: "reader"
      } as any)
    ).rejects.toEqual(
      expect.objectContaining({
        constructor: ConflictException,
        message: "Multiple repositories exist for this project; use a repository-scoped endpoint"
      })
    );
  });

  it("maps duplicate managed repository paths to a readable bad request", async () => {
    const service = makeService();
    jest.spyOn(service as any, "ensureManagedGroup").mockResolvedValue({ id: 3 });
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(400, {
        message: {
          path: ["has already been taken"]
        }
      }) as Response
    );

    await expect(service.provisionManagedRemoteRepository("NAV", "Navigation")).rejects.toEqual(
      expect.objectContaining({
        constructor: BadRequestException,
        message: "Managed GitLab repository path already exists for this project key"
      })
    );
  });

  it("bootstraps managed repositories with Atlasium Docs taxonomy files", async () => {
    const service = makeService();
    jest.spyOn(service as any, "ensureManagedGroup").mockResolvedValue({ id: 3 });
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: 456,
          name: "Navigation",
          description: "Navigation repository",
          path_with_namespace: "atlasium/nav",
          web_url: "https://git.atlasium.info/atlasium/nav",
          default_branch: "main",
          visibility: "private",
          last_activity_at: "2026-04-06T10:00:00.000Z"
        }) as Response
      )
      .mockResolvedValueOnce(jsonResponse(201, { id: "commit-bootstrap" }) as Response);

    await expect(
      service.provisionManagedRemoteRepository("NAV", "Navigation", {
        description: "Navigation repository"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        gitlabProjectId: "456",
        pathWithNamespace: "atlasium/nav"
      })
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/projects");
    const createBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(createBody).toEqual(
      expect.objectContaining({
        namespace_id: 3,
        name: "Navigation",
        path: "nav",
        visibility: "private",
        initialize_with_readme: true,
        default_branch: "main"
      })
    );

    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/456/repository/commits");
    const bootstrapBody = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string);
    expect(bootstrapBody).toEqual(
      expect.objectContaining({
        branch: "main",
        commit_message: "Initialize Atlasium repository documentation"
      })
    );
    expect(bootstrapBody.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "create",
          file_path: "AGENTS.md",
          content: expect.stringContaining("Docs/Research/")
        }),
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
      ])
    );
    expect(bootstrapBody.actions[0].content).toContain("Repo `Docs/` is not the Atlasium Documents module");
  });

  it("allows project writers to create an additional managed repository", async () => {
    const { service, prisma, accessService } = makeServiceWithDeps();
    prisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      key: "NAV",
      name: "Navigation"
    });
    jest.spyOn(service, "provisionManagedRemoteRepository").mockResolvedValue({
      gitlabProjectId: "gl-2",
      name: "Analysis",
      description: "Analysis workspace",
      pathWithNamespace: "atlasium/nav-analysis",
      webUrl: "https://git.atlasium.info/atlasium/nav-analysis",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-04-06T10:00:00.000Z"
    });
    jest.spyOn(service, "registerManagedRepository").mockResolvedValue({
      ...repositoryRecord,
      id: "repo-2",
      gitlabProjectId: "gl-2",
      name: "Analysis",
      description: "Analysis workspace",
      pathWithNamespace: "atlasium/nav-analysis",
      webUrl: "https://git.atlasium.info/atlasium/nav-analysis"
    } as any);
    jest.spyOn(service, "syncProjectRepositoryAccess").mockResolvedValue(undefined);
    const getRepositoryStatusSpy = jest.spyOn(service, "getRepositoryStatus").mockResolvedValue({
      connected: true,
      id: "repo-2",
      gitlabProjectId: "gl-2",
      name: "Analysis",
      description: "Analysis workspace",
      webUrl: "https://git.atlasium.info/atlasium/nav-analysis",
      sshCloneUrl: "git@git.atlasium.info:atlasium/nav-analysis.git",
      httpCloneUrl: "https://git.atlasium.info/atlasium/nav-analysis.git",
      pathWithNamespace: "atlasium/nav-analysis",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-04-06T10:00:00.000Z",
      connectedAt: repositoryRecord.connectedAt.toISOString(),
      connectedByUserId: repositoryRecord.connectedByUserId,
      managed: true
    });

    await expect(
      service.createRepository(
        "project-1",
        { name: "Analysis", description: "Analysis workspace" },
        {
          userId: "editor-1",
          globalRole: "editor"
        } as any
      )
    ).resolves.toEqual(
      expect.objectContaining({
        connected: true,
        gitlabProjectId: "gl-2"
      })
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(service.provisionManagedRemoteRepository).toHaveBeenCalledWith("NAV", "Analysis", {
      path: "nav-analysis",
      description: "Analysis workspace"
    });
    expect(getRepositoryStatusSpy).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        userId: "editor-1"
      }),
      "repo-2"
    );
  });

  it("rejects repository creation when the Atlasium project no longer exists", async () => {
    const { service, prisma } = makeServiceWithDeps();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(null);
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.createRepository(
        "missing-project",
        { name: "Navigation" },
        {
          userId: "admin-1",
          globalRole: "admin"
        } as any
      )
    ).rejects.toEqual(
      expect.objectContaining({
        message: "Project not found"
      })
    );
  });

  it("rolls back the managed GitLab repository when repository registration fails", async () => {
    const { service, prisma } = makeServiceWithDeps();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(null);
    prisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      key: "NAV",
      name: "Navigation"
    });
    jest.spyOn(service, "provisionManagedRemoteRepository").mockResolvedValue({
      gitlabProjectId: "gl-1",
      name: "Navigation",
      description: null,
      pathWithNamespace: "atlasium/nav",
      webUrl: "https://git.atlasium.info/atlasium/nav",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-04-06T10:00:00.000Z"
    });
    jest.spyOn(service, "registerManagedRepository").mockRejectedValue(new Error("db failed"));
    const deleteManagedRemoteRepositorySpy = jest
      .spyOn(service as any, "deleteManagedRemoteRepository")
      .mockResolvedValue(undefined);

    await expect(
      service.createRepository(
        "project-1",
        { name: "Navigation" },
        {
          userId: "admin-1",
          globalRole: "admin"
        } as any
      )
    ).rejects.toThrow("db failed");

    expect(deleteManagedRemoteRepositorySpy).toHaveBeenCalledWith("gl-1");
  });

  it("deletes the repository record and remote project when access sync fails after registration", async () => {
    const { service, prisma } = makeServiceWithDeps();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(null);
    prisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      key: "NAV",
      name: "Navigation"
    });
    jest.spyOn(service, "provisionManagedRemoteRepository").mockResolvedValue({
      gitlabProjectId: "gl-2",
      name: "Navigation",
      description: null,
      pathWithNamespace: "atlasium/nav",
      webUrl: "https://git.atlasium.info/atlasium/nav",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-04-06T10:00:00.000Z"
    });
    jest.spyOn(service, "registerManagedRepository").mockResolvedValue(repositoryRecord as any);
    jest.spyOn(service, "syncProjectRepositoryAccess").mockRejectedValue(new Error("sync failed"));
    const deleteManagedRemoteRepositorySpy = jest
      .spyOn(service as any, "deleteManagedRemoteRepository")
      .mockResolvedValue(undefined);

    await expect(
      service.createRepository(
        "project-1",
        { name: "Navigation" },
        {
          userId: "admin-1",
          globalRole: "admin"
        } as any
      )
    ).rejects.toThrow("sync failed");

    expect(prisma.projectRepository.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "repo-1"
      }
    });
    expect(deleteManagedRemoteRepositorySpy).toHaveBeenCalledWith("gl-2");
  });

  it("returns without touching GitLab when archiving or unarchiving a project with no repository record", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecords").mockResolvedValue([]);

    await expect(service.archiveManagedRepository("project-1")).resolves.toBeUndefined();
    await expect(service.unarchiveManagedRepository("project-1")).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores missing GitLab projects during archive and unarchive reconciliation", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecords").mockResolvedValue([repositoryRecord]);

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(404, { message: "404 Project Not Found" }) as Response)
      .mockResolvedValueOnce(jsonResponse(404, { message: "404 Project Not Found" }) as Response);

    await expect(service.archiveManagedRepository("project-1")).resolves.toBeUndefined();
    await expect(service.unarchiveManagedRepository("project-1")).resolves.toBeUndefined();
  });

  it("previews repository removal for admins with binding counts and warnings", async () => {
    const { service, prisma, accessService } = makeServiceWithDeps();
    accessService.getProjectAccess.mockResolvedValue({ isAdmin: true, projectRole: "admin", canWrite: true });
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    prisma.projectRepository.count.mockResolvedValue(2);
    prisma.wikiDocsBinding.groupBy.mockResolvedValue([
      { status: "active", _count: { _all: 3 } },
      { status: "conflict", _count: { _all: 1 } },
      { status: "error", _count: { _all: 2 } }
    ]);

    await expect(
      service.previewRepositoryRemoval("project-1", "repo-1", {
        userId: "admin-1",
        globalRole: "admin"
      } as any)
    ).resolves.toEqual({
      repository: {
        id: "repo-1",
        name: "Navigation",
        gitlabProjectId: "123",
        pathWithNamespace: "atlasium/nav",
        webUrl: "https://git.atlasium.info/atlasium/nav",
        defaultBranch: "main",
        visibility: "private",
        lastActivityAt: "2026-03-31T18:00:00.000Z"
      },
      remoteAction: "archive",
      confirmationText: "Navigation",
      lastRepository: false,
      wikiDocsBindings: {
        total: 6,
        active: 3,
        deleted: 0,
        conflict: 1,
        error: 2,
        unassigned: 0
      },
      warnings: expect.arrayContaining([
        "The managed GitLab project will be archived, not permanently deleted.",
        "Repo Docs sync bindings will be removed. Existing Wiki pages remain available but stop syncing with this repository."
      ]),
      blockers: []
    });
    expect(accessService.getProjectAccess).toHaveBeenCalledWith("admin-1", "admin", "project-1");
  });

  it("rejects repository removal preview and execution for non-admin project users", async () => {
    const { service, accessService } = makeServiceWithDeps();
    accessService.getProjectAccess.mockResolvedValue({ isAdmin: false, projectRole: "editor", canWrite: true });
    const findRepositoryRecordByIdSpy = jest.spyOn(service as any, "findRepositoryRecordById");

    await expect(
      service.previewRepositoryRemoval("project-1", "repo-1", {
        userId: "editor-1",
        globalRole: "editor"
      } as any)
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.removeRepository("project-1", "repo-1", "Navigation", {
        userId: "editor-1",
        globalRole: "editor"
      } as any)
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findRepositoryRecordByIdSpy).not.toHaveBeenCalled();
  });

  it("rejects repository removal when the typed confirmation does not match", async () => {
    const { service, prisma, accessService } = makeServiceWithDeps();
    accessService.getProjectAccess.mockResolvedValue({ isAdmin: true, projectRole: "admin", canWrite: true });
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);

    await expect(
      service.removeRepository("project-1", "repo-1", "Wrong name", {
        userId: "admin-1",
        globalRole: "admin"
      } as any)
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("archives the GitLab project, removes the repository record, and audits repository removal", async () => {
    const { service, prisma, accessService, auditService } = makeServiceWithDeps();
    accessService.getProjectAccess.mockResolvedValue({ isAdmin: true, projectRole: "admin", canWrite: true });
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    prisma.projectRepository.count.mockResolvedValue(1);
    prisma.wikiDocsBinding.groupBy.mockResolvedValue([
      { status: "active", _count: { _all: 2 } },
      { status: "deleted", _count: { _all: 1 } }
    ]);
    const txProjectRepository = {
      delete: jest.fn().mockResolvedValue(repositoryRecord),
      count: jest.fn().mockResolvedValue(0)
    };
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({ projectRepository: txProjectRepository })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse(201, { id: 123 }) as Response);

    await expect(
      service.removeRepository("project-1", "repo-1", "Navigation", {
        userId: "admin-1",
        globalRole: "admin"
      } as any)
    ).resolves.toEqual({
      repositoryId: "repo-1",
      name: "Navigation",
      pathWithNamespace: "atlasium/nav",
      gitlabProjectId: "123",
      remoteArchived: true,
      remoteMissing: false,
      removedAt: expect.any(String),
      remainingRepositories: 0,
      wikiDocsBindingsRemoved: 3
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/archive");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(txProjectRepository.delete).toHaveBeenCalledWith({ where: { id: "repo-1" } });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "admin-1",
      projectId: "project-1",
      entityType: "project_repository",
      entityId: "repo-1",
      action: "project.repository.archive",
      metadata: {
        gitlabProjectId: "123",
        pathWithNamespace: "atlasium/nav",
        lastRepository: true,
        wikiDocsBindings: {
          total: 3,
          active: 2,
          deleted: 1,
          conflict: 0,
          error: 0,
          unassigned: 0
        }
      }
    });
  });

  it("removes the local repository record when the remote GitLab project is already missing", async () => {
    const { service, prisma, accessService } = makeServiceWithDeps();
    accessService.getProjectAccess.mockResolvedValue({ isAdmin: true, projectRole: "admin", canWrite: true });
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    prisma.projectRepository.count.mockResolvedValue(1);
    prisma.wikiDocsBinding.groupBy.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        projectRepository: {
          delete: jest.fn().mockResolvedValue(repositoryRecord),
          count: jest.fn().mockResolvedValue(0)
        }
      })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse(404, { message: "404 Project Not Found" }) as Response);

    await expect(
      service.removeRepository("project-1", "repo-1", "Navigation", {
        userId: "admin-1",
        globalRole: "admin"
      } as any)
    ).resolves.toEqual(
      expect.objectContaining({
        remoteArchived: false,
        remoteMissing: true,
        wikiDocsBindingsRemoved: 0
      })
    );
  });

  it("leaves the repository record untouched when GitLab archiving fails", async () => {
    const { service, prisma, accessService } = makeServiceWithDeps();
    accessService.getProjectAccess.mockResolvedValue({ isAdmin: true, projectRole: "admin", canWrite: true });
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    prisma.projectRepository.count.mockResolvedValue(1);
    prisma.wikiDocsBinding.groupBy.mockResolvedValue([]);
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { message: "GitLab unavailable" }) as Response);

    await expect(
      service.removeRepository("project-1", "repo-1", "Navigation", {
        userId: "admin-1",
        globalRole: "admin"
      } as any)
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("attempts to unarchive the remote repository when local removal fails after archive", async () => {
    const { service, prisma, accessService } = makeServiceWithDeps();
    accessService.getProjectAccess.mockResolvedValue({ isAdmin: true, projectRole: "admin", canWrite: true });
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    prisma.projectRepository.count.mockResolvedValue(1);
    prisma.wikiDocsBinding.groupBy.mockResolvedValue([]);
    prisma.$transaction.mockRejectedValue(new Error("db failed"));
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(201, { id: 123 }) as Response)
      .mockResolvedValueOnce(jsonResponse(201, { id: 123 }) as Response);

    await expect(
      service.removeRepository("project-1", "repo-1", "Navigation", {
        userId: "admin-1",
        globalRole: "admin"
      } as any)
    ).rejects.toThrow("db failed");

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/archive");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/unarchive");
  });

  it("refreshes the user connection once after a 401 and retries the GitLab request", async () => {
    const service = makeService();
    const staleConnection = {
      userId: "user-1",
      accessTokenEncrypted: encryptValue("expired-token", process.env.JWT_SECRET!),
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
      reconnectRequired: false
    };
    const refreshedConnection = {
      ...staleConnection,
      accessTokenEncrypted: encryptValue("fresh-token", process.env.JWT_SECRET!)
    };
    jest.spyOn(service as any, "requireConnectionRecord").mockResolvedValue(staleConnection);
    jest
      .spyOn(service as any, "ensureConnectionReady")
      .mockResolvedValueOnce(staleConnection)
      .mockResolvedValueOnce(refreshedConnection);
    jest.spyOn(service as any, "refreshConnection").mockResolvedValue(refreshedConnection);

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" }) as Response)
      .mockResolvedValueOnce(jsonResponse(200, [] as unknown[]) as Response);

    await expect(
      (service as any).withUserAccessToken("user-1", async (accessToken: string) =>
        (service as any).executeGitlabRequest(accessToken, "/user/keys?per_page=100")
      )
    ).resolves.toEqual([]);

    expect((service as any).refreshConnection).toHaveBeenCalledWith(staleConnection);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer expired-token"
      })
    });
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer fresh-token"
      })
    });
  });

  it("shares proactive token refreshes across concurrent user requests", async () => {
    const service = makeService();
    const staleConnection = {
      userId: "user-1",
      accessTokenEncrypted: encryptValue("expiring-token", process.env.JWT_SECRET!),
      refreshTokenEncrypted: encryptValue("refresh-token", process.env.JWT_SECRET!),
      tokenExpiresAt: new Date(Date.now() + 10_000),
      reconnectRequired: false
    };
    const refreshedConnection = {
      ...staleConnection,
      accessTokenEncrypted: encryptValue("fresh-token", process.env.JWT_SECRET!),
      tokenExpiresAt: new Date(Date.now() + 3_600_000)
    };
    jest.spyOn(service as any, "requireConnectionRecord").mockResolvedValue(staleConnection);
    const refreshConnectionSpy = jest.spyOn(service as any, "refreshConnection").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return refreshedConnection;
    });

    await expect(
      Promise.all([
        (service as any).withUserAccessToken("user-1", async (accessToken: string) => accessToken),
        (service as any).withUserAccessToken("user-1", async (accessToken: string) => accessToken),
        (service as any).withUserAccessToken("user-1", async (accessToken: string) => accessToken)
      ])
    ).resolves.toEqual(["fresh-token", "fresh-token", "fresh-token"]);

    expect(refreshConnectionSpy).toHaveBeenCalledTimes(1);
  });

  it("shares retry token refreshes across concurrent GitLab 401 responses", async () => {
    const service = makeService();
    const staleConnection = {
      userId: "user-1",
      accessTokenEncrypted: encryptValue("expired-token", process.env.JWT_SECRET!),
      refreshTokenEncrypted: encryptValue("refresh-token", process.env.JWT_SECRET!),
      tokenExpiresAt: null,
      reconnectRequired: false
    };
    const refreshedConnection = {
      ...staleConnection,
      accessTokenEncrypted: encryptValue("fresh-token", process.env.JWT_SECRET!)
    };
    jest.spyOn(service as any, "requireConnectionRecord").mockResolvedValue(staleConnection);
    const refreshConnectionSpy = jest.spyOn(service as any, "refreshConnection").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return refreshedConnection;
    });
    let gitlabRequestCount = 0;
    fetchSpy.mockImplementation(async () => {
      gitlabRequestCount += 1;
      if (gitlabRequestCount <= 3) {
        return jsonResponse(401, { message: "expired" }) as Response;
      }

      return jsonResponse(200, [] as unknown[]) as Response;
    });

    await expect(
      Promise.all([
        (service as any).withUserAccessToken("user-1", async (accessToken: string) =>
          (service as any).executeGitlabRequest(accessToken, "/user/keys?per_page=100")
        ),
        (service as any).withUserAccessToken("user-1", async (accessToken: string) =>
          (service as any).executeGitlabRequest(accessToken, "/user/keys?per_page=100")
        ),
        (service as any).withUserAccessToken("user-1", async (accessToken: string) =>
          (service as any).executeGitlabRequest(accessToken, "/user/keys?per_page=100")
        )
      ])
    ).resolves.toEqual([[], [], []]);

    expect(refreshConnectionSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(fetchSpy.mock.calls.slice(0, 3).map((call) => (call[1]?.headers as Record<string, string>).Authorization))
      .toEqual(["Bearer expired-token", "Bearer expired-token", "Bearer expired-token"]);
    expect(fetchSpy.mock.calls.slice(3).map((call) => (call[1]?.headers as Record<string, string>).Authorization))
      .toEqual(["Bearer fresh-token", "Bearer fresh-token", "Bearer fresh-token"]);
  });

  it("marks reconnect required and hides raw OAuth refresh errors", async () => {
    const service = makeService();
    const staleConnection = {
      userId: "user-1",
      accessTokenEncrypted: encryptValue("expired-token", process.env.JWT_SECRET!),
      refreshTokenEncrypted: encryptValue("bad-refresh-token", process.env.JWT_SECRET!),
      tokenExpiresAt: new Date(Date.now() + 10_000),
      reconnectRequired: false
    };
    const markReconnectRequiredSpy = jest.spyOn(service as any, "markReconnectRequired").mockResolvedValue(undefined);
    jest
      .spyOn(service as any, "exchangeUserOAuthToken")
      .mockRejectedValue(new UnauthorizedException("invalid_grant"));

    await expect((service as any).refreshConnectionSingleFlight(staleConnection)).rejects.toEqual(
      expect.objectContaining({
        constructor: UnauthorizedException,
        message: "GitLab reconnection required"
      })
    );

    expect(markReconnectRequiredSpy).toHaveBeenCalledWith("user-1");
  });

  it("resolves GitLab user ids from OIDC identity, username sync, creation, and cache", async () => {
    const service = makeService();
    const cache = new Map<string, string | null>([["cached-user", "88"]]);

    await expect(
      (service as any).resolveGitlabUserId(
        {
          id: "cached-user",
          email: "cached@example.com",
          username: "cached",
          name: "Cached User"
        },
        "system-token",
        cache
      )
    ).resolves.toBe("88");

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          id: 77,
          username: "old-persisted",
          email: "persisted@example.com",
          identities: [{ provider: "openid_connect", extern_uid: "persisted-user" }]
        }
      ]) as Response
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, []) as Response);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 77,
        username: "persisted",
        email: "persisted@example.com",
        identities: [{ provider: "openid_connect", extern_uid: "persisted-user" }]
      }) as Response
    );

    await expect(
      (service as any).resolveGitlabUserId(
        {
          id: "persisted-user",
          email: "persisted@example.com",
          username: "persisted",
          name: "Persisted User"
        },
        "system-token",
        cache
      )
    ).resolves.toBe("77");

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, []) as Response);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, []) as Response);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(201, {
        id: 10,
        username: "missing",
        email: "missing@example.com"
      }) as Response
    );

    await expect(
      (service as any).resolveGitlabUserId(
        {
          id: "missing-user",
          email: "missing@example.com",
          username: "missing",
          name: "Missing User"
        },
        "system-token",
        cache
      )
    ).resolves.toBe("10");

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://git.atlasium.info/api/v4/users?extern_uid=persisted-user&provider=openid_connect"
    );
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://git.atlasium.info/api/v4/users?username=persisted");
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("https://git.atlasium.info/api/v4/users/77");
    expect(fetchSpy.mock.calls[2]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        username: "persisted"
      })
    });
    expect(fetchSpy.mock.calls[5]?.[0]).toBe("https://git.atlasium.info/api/v4/users");
    expect(fetchSpy.mock.calls[5]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        username: "missing",
        name: "Missing User",
        email: "missing@example.com",
        provider: "openid_connect",
        extern_uid: "missing-user",
        skip_confirmation: true,
        can_create_group: false,
        projects_limit: 0,
        force_random_password: true
      })
    });
  });

  it("syncs the Atlasium password into an existing OIDC GitLab user for HTTPS clone", async () => {
    const service = makeService();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { password_authentication_enabled_for_git: false }) as Response)
      .mockResolvedValueOnce(jsonResponse(200, { password_authentication_enabled_for_git: true }) as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: 7,
            username: "luisjrc",
            name: "Luis",
            email: "luis@example.com",
            identities: [{ provider: "openid_connect", extern_uid: "atlasium-user-1" }]
          }
        ]) as Response
      )
      .mockResolvedValueOnce(jsonResponse(200, []) as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 7,
          username: "luisjrc",
          name: "Luis",
          email: "luis@example.com"
        }) as Response
      );

    await expect(
      service.syncUserHttpsPassword(
        {
          id: "atlasium-user-1",
          email: "luis@example.com",
          username: "luisjrc",
          name: "Luis"
        },
        "atlasium-password-123"
      )
    ).resolves.toEqual({ username: "luisjrc" });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/application/settings");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://git.atlasium.info/api/v4/application/settings");
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        password_authentication_enabled_for_git: true
      })
    });
    expect(fetchSpy.mock.calls[2]?.[0]).toBe(
      "https://git.atlasium.info/api/v4/users?extern_uid=atlasium-user-1&provider=openid_connect"
    );
    expect(fetchSpy.mock.calls[3]?.[0]).toBe("https://git.atlasium.info/api/v4/users?username=luisjrc");
    expect(fetchSpy.mock.calls[4]?.[0]).toBe("https://git.atlasium.info/api/v4/users/7");
    expect(fetchSpy.mock.calls[4]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        password: "atlasium-password-123",
        skip_reconfirmation: true
      })
    });
  });

  it("creates a managed OIDC GitLab user with the Atlasium password when HTTPS clone is enabled first", async () => {
    const service = makeService();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { password_authentication_enabled_for_git: true }) as Response)
      .mockResolvedValueOnce(jsonResponse(200, []) as Response)
      .mockResolvedValueOnce(jsonResponse(200, []) as Response)
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: 10,
          username: "new-user",
          name: "New User",
          email: "new.user@example.com"
        }) as Response
      );

    await expect(
      service.syncUserHttpsPassword(
        {
          id: "new-user-id",
          email: "new.user@example.com",
          username: "new-user",
          name: "New User"
        },
        "atlasium-password-123"
      )
    ).resolves.toEqual({ username: "new-user" });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/application/settings");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      "https://git.atlasium.info/api/v4/users?extern_uid=new-user-id&provider=openid_connect"
    );
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("https://git.atlasium.info/api/v4/users?username=new-user");
    expect(fetchSpy.mock.calls[3]?.[0]).toBe("https://git.atlasium.info/api/v4/users");
    expect(fetchSpy.mock.calls[3]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        username: "new-user",
        name: "New User",
        email: "new.user@example.com",
        provider: "openid_connect",
        extern_uid: "new-user-id",
        skip_confirmation: true,
        can_create_group: false,
        projects_limit: 0,
        password: "atlasium-password-123"
      })
    });
  });

  it("rejects managed GitLab username conflicts instead of silently suffixing", async () => {
    const service = makeService();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, []) as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: 4,
            username: "taken",
            name: "Taken User",
            identities: []
          }
        ]) as Response
      );

    await expect(
      service.syncManagedUserIdentity({
        id: "atlasium-user-1",
        email: "user@example.com",
        username: "taken",
        name: "User One"
      })
    ).rejects.toThrow("GitLab username is already in use");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("builds desired project members for admins, editors, readers, and unresolved GitLab identities", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.user = {
      findMany: jest.fn().mockReturnValue("admins-query")
    };
    prisma.projectMember = {
      findMany: jest.fn().mockReturnValue("members-query")
    };
    prisma.$transaction.mockResolvedValue([
      [
        {
          id: "admin-1",
          email: "admin@example.com",
          name: "Admin One"
        }
      ],
      [
        {
          user: {
            id: "editor-1",
            email: "editor@example.com",
            name: "Editor One",
            globalRole: "EDITOR"
          },
          role: "EDITOR"
        },
        {
          user: {
            id: "reader-1",
            email: "reader@example.com",
            name: "Reader One",
            globalRole: "READER"
          },
          role: "READER"
        },
        {
          user: {
            id: "admin-2",
            email: "admin2@example.com",
            name: "Admin Two",
            globalRole: "ADMIN"
          },
          role: "EDITOR"
        }
      ]
    ]);
    jest
      .spyOn(service as any, "resolveGitlabUserId")
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("7")
      .mockResolvedValueOnce(null);

    await expect((service as any).buildDesiredMembers("project-1", "system-token", false)).resolves.toEqual(
      new Map([
        ["1", 40],
        ["7", 30]
      ])
    );
  });

  it("marks the connection as requiring reconnection after a second 401", async () => {
    const service = makeService();
    const staleConnection = {
      userId: "user-1",
      accessTokenEncrypted: encryptValue("expired-token", process.env.JWT_SECRET!),
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
      reconnectRequired: false
    };
    const refreshedConnection = {
      ...staleConnection,
      accessTokenEncrypted: encryptValue("still-invalid", process.env.JWT_SECRET!)
    };
    jest.spyOn(service as any, "requireConnectionRecord").mockResolvedValue(staleConnection);
    jest
      .spyOn(service as any, "ensureConnectionReady")
      .mockResolvedValueOnce(staleConnection)
      .mockResolvedValueOnce(refreshedConnection);
    jest.spyOn(service as any, "refreshConnection").mockResolvedValue(refreshedConnection);
    const markReconnectRequiredSpy = jest.spyOn(service as any, "markReconnectRequired").mockResolvedValue(undefined);

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" }) as Response)
      .mockResolvedValueOnce(jsonResponse(401, { message: "still expired" }) as Response);

    await expect(
      (service as any).withUserAccessToken("user-1", async (accessToken: string) =>
        (service as any).executeGitlabRequest(accessToken, "/user/keys?per_page=100")
      )
    ).rejects.toEqual(
      expect.objectContaining({
        constructor: UnauthorizedException,
        message: "GitLab reconnection required"
      })
    );

    expect(markReconnectRequiredSpy).toHaveBeenCalledWith("user-1");
  });

  it("skips direct project membership creation when inherited group access already satisfies the desired role", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecords").mockResolvedValue([repositoryRecord]);
    jest.spyOn(service as any, "buildDesiredMembers").mockResolvedValue(new Map([["1", 40]]));

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, [] as unknown[]) as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 1, username: "root", name: "Root", access_level: 50 }]) as Response
      );

    await service.syncProjectRepositoryAccess("project-1");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/members?per_page=100");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/members/all?per_page=100");
  });

  it("adds a direct project member when inherited access is missing or insufficient", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecords").mockResolvedValue([repositoryRecord]);
    jest.spyOn(service as any, "buildDesiredMembers").mockResolvedValue(new Map([["7", 40]]));

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, [] as unknown[]) as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 7, username: "dev", name: "Dev", access_level: 20 }]) as Response
      )
      .mockResolvedValueOnce(jsonResponse(201, {}) as Response);

    await service.syncProjectRepositoryAccess("project-1");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/members");
    expect(fetchSpy.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        user_id: 7,
        access_level: 40
      })
    });
  });

  it("ensures the current user's repository access before returning status", async () => {
    const service = makeService();
    const syncSpy = jest.spyOn(service, "syncProjectRepositoryAccess").mockResolvedValue(undefined);
    const statusSpy = jest.spyOn(service, "getRepositoryStatus").mockResolvedValue({
      connected: true,
      id: "repo-1",
      gitlabProjectId: "123",
      name: "Navigation",
      description: null,
      webUrl: "https://git.atlasium.info/atlasium/nav",
      sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
      httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git",
      pathWithNamespace: "atlasium/nav",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-04-06T12:00:00.000Z",
      connectedAt: "2026-04-06T12:00:00.000Z",
      connectedByUserId: "admin-1",
      managed: true
    });
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);

    const user = { userId: "reader-1", email: "reader@example.com", globalRole: "reader" as const };
    await expect(service.ensureCurrentUserRepositoryAccess("project-1", user)).resolves.toMatchObject({
      connected: true,
      gitlabProjectId: "123"
    });

    expect(syncSpy).toHaveBeenCalledWith("project-1");
    expect(statusSpy).toHaveBeenCalledWith("project-1", user, "repo-1");
  });

  it("updates an existing direct project member when the direct access is too low", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecords").mockResolvedValue([repositoryRecord]);
    jest.spyOn(service as any, "buildDesiredMembers").mockResolvedValue(new Map([["5", 30]]));

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 5, username: "editor", name: "Editor", access_level: 20 }]) as Response
      )
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 5, username: "editor", name: "Editor", access_level: 20 }]) as Response
      )
      .mockResolvedValueOnce(jsonResponse(200, {}) as Response);

    await service.syncProjectRepositoryAccess("project-1");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/members/5");
    expect(fetchSpy.mock.calls[2]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        access_level: 30
      })
    });
  });

  it("maps GitLab membership sync errors to a service-availability error instead of leaking a raw 500", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecords").mockResolvedValue([repositoryRecord]);
    jest.spyOn(service as any, "buildDesiredMembers").mockResolvedValue(new Map([["1", 40]]));

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, [] as unknown[]) as Response)
      .mockResolvedValueOnce(jsonResponse(200, [] as unknown[]) as Response)
      .mockResolvedValueOnce(
        jsonResponse(403, {
          message: {
            access_level: ["should be greater than or equal to Owner inherited membership from group Atlasium"]
          }
        }) as Response
      );

    await expect(service.syncProjectRepositoryAccess("project-1")).rejects.toEqual(
      expect.objectContaining({
        constructor: ServiceUnavailableException,
        message: "Atlasium GitLab system token is not authorized"
      })
    );
  });

  it("includes the HTTPS clone URL in repository status", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 123,
        name: "Navigation",
        description: "Managed repo",
        web_url: "https://git.atlasium.info/atlasium/nav",
        ssh_url_to_repo: "git@git.atlasium.info:atlasium/nav.git",
        http_url_to_repo: "https://git.atlasium.info/atlasium/nav.git",
        path_with_namespace: "atlasium/nav",
        default_branch: "main",
        visibility: "private",
        last_activity_at: "2026-04-01T10:00:00.000Z"
      }) as Response
    );

    await expect(
      service.getRepositoryStatus("project-1", {
        userId: "reader-1",
        globalRole: "reader"
      } as any)
    ).resolves.toEqual(
      expect.objectContaining({
        connected: true,
        sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
        httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git"
      })
    );
  });

  it("lists the connected user's SSH keys", async () => {
    const service = makeService();
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          id: 7,
          title: "Laptop",
          key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAexample",
          created_at: "2026-04-06T10:00:00.000Z",
          expires_at: null,
          usage_type: "auth"
        }
      ]) as Response
    );

    await expect(service.listUserSshKeys("user-1")).resolves.toEqual([
      {
        id: 7,
        title: "Laptop",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAexample",
        createdAt: "2026-04-06T10:00:00.000Z",
        expiresAt: null,
        usageType: "auth"
      }
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://git.atlasium.info/api/v4/user/keys?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer user-token"
        })
      })
    );
  });

  it("creates an SSH key for the connected user", async () => {
    const service = makeService();
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(201, {
        id: 9,
        title: "Workstation",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
        created_at: "2026-04-06T11:00:00.000Z",
        expires_at: "2027-04-06",
        usage_type: "auth"
      }) as Response
    );

    await expect(
      service.createUserSshKey("user-1", {
        title: "Workstation",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
        expiresAt: "2027-04-06"
      })
    ).resolves.toEqual({
      id: 9,
      title: "Workstation",
      key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
      createdAt: "2026-04-06T11:00:00.000Z",
      expiresAt: "2027-04-06",
      usageType: "auth"
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://git.atlasium.info/api/v4/user/keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "Workstation",
          key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
          expires_at: "2027-04-06"
        })
      })
    );
  });

  it("deletes an SSH key for the connected user", async () => {
    const service = makeService();
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(jsonResponse(204) as Response);

    await expect(service.deleteUserSshKey("user-1", "42")).resolves.toEqual({ deleted: true });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://git.atlasium.info/api/v4/user/keys/42",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer user-token"
        })
      })
    );
  });

  it("surfaces invalid or duplicate SSH key errors as a readable bad request", async () => {
    const service = makeService();
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(400, {
        message: {
          key: ["has already been taken"]
        }
      }) as Response
    );

    await expect(
      service.createUserSshKey("user-1", {
        title: "Duplicate",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAduplicate"
      })
    ).rejects.toEqual(
      expect.objectContaining({
        constructor: BadRequestException,
        message: "has already been taken"
      })
    );
  });

  it("preserves the GitLab reconnection-required error when SSH key operations run without a valid user token", async () => {
    const service = makeService();
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockRejectedValue(new UnauthorizedException("GitLab reconnection required"));

    await expect(service.listUserSshKeys("user-1")).rejects.toEqual(
      expect.objectContaining({
        constructor: UnauthorizedException,
        message: "GitLab reconnection required"
      })
    );
  });

  it("lists merge requests for the requested state and maps draft and author details", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          id: 81,
          iid: 7,
          title: "Draft: Sync notes",
          state: "opened",
          web_url: "https://git.atlasium.info/atlasium/nav/-/merge_requests/7",
          source_branch: "feature/notes",
          target_branch: "main",
          updated_at: "2026-04-01T12:00:00.000Z",
          draft: true,
          author: {
            id: 4,
            username: "luis",
            name: "Luis",
            avatar_url: "https://git.atlasium.info/uploads/-/system/user/avatar.png"
          }
        }
      ]) as Response
    );

    await expect(
      service.listMergeRequests(
        "project-1",
        "merged",
        {
          userId: "reader-1",
          globalRole: "reader"
        } as any
      )
    ).resolves.toEqual([
      {
        id: 81,
        iid: 7,
        title: "Draft: Sync notes",
        state: "opened",
        webUrl: "https://git.atlasium.info/atlasium/nav/-/merge_requests/7",
        sourceBranch: "feature/notes",
        targetBranch: "main",
        updatedAt: "2026-04-01T12:00:00.000Z",
        draft: true,
        author: {
          name: "Luis",
          username: "luis",
          avatarUrl: "https://git.atlasium.info/uploads/-/system/user/avatar.png"
        }
      }
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://git.atlasium.info/api/v4/projects/123/merge_requests?state=merged&per_page=20&order_by=updated_at&sort=desc",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer user-token"
        })
      })
    );
  });

  it("downloads the repository archive for the requested ref", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: "commit-sha-1",
            short_id: "commit",
            title: "Export",
            message: "Export",
            authored_date: "2026-03-31T18:00:00.000Z",
            author_name: "Luis"
          }
        ]) as Response
      )
      .mockResolvedValueOnce(
        binaryResponse(200, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          "content-type": "application/zip"
        }) as Response
      );

    await expect(
      service.getRepositoryArchive(
        "project-1",
        "feature/export",
        {
          userId: "reader-1",
          globalRole: "reader"
        } as any
      )
    ).resolves.toEqual({
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      fileName: "atlasium-nav-feature-export.zip",
      contentType: "application/zip"
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://git.atlasium.info/api/v4/projects/123/repository/commits?per_page=1&ref_name=feature%2Fexport",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer user-token"
        })
      })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://git.atlasium.info/api/v4/projects/123/repository/archive.zip?sha=commit-sha-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "*/*",
          Authorization: "Bearer user-token"
        })
      })
    );
  });

  it("retries repository archives with no-extension format negotiation after a 406", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: "commit-sha-2",
            short_id: "commit",
            title: "Main",
            message: "Main",
            authored_date: "2026-03-31T18:00:00.000Z",
            author_name: "Luis"
          }
        ]) as Response
      )
      .mockResolvedValueOnce(jsonResponse(406, { error: "Not acceptable" }) as Response)
      .mockResolvedValueOnce(
        binaryResponse(200, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          "content-type": "application/zip"
        }) as Response
      );

    await expect(
      service.getRepositoryArchive("project-1", "main", {
        userId: "reader-1",
        globalRole: "reader"
      } as any)
    ).resolves.toMatchObject({
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      contentType: "application/zip"
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://git.atlasium.info/api/v4/projects/123/repository/archive?sha=commit-sha-2",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/zip",
          Authorization: "Bearer user-token"
        })
      })
    );
  });

  it("keeps existing repository access mappings for non-406 archive failures", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: "commit-sha-forbidden",
            short_id: "commit",
            title: "Main",
            message: "Main",
            authored_date: "2026-03-31T18:00:00.000Z",
            author_name: "Luis"
          }
        ]) as Response
      )
      .mockResolvedValueOnce(jsonResponse(403, { message: "forbidden" }) as Response);

    await expect(
      service.getRepositoryArchive("project-1", "main", {
        userId: "reader-1",
        globalRole: "reader"
      } as any)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries repository archives with OAuth query authentication after repeated 406 responses", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: "commit-sha-3",
            short_id: "commit",
            title: "Main",
            message: "Main",
            authored_date: "2026-03-31T18:00:00.000Z",
            author_name: "Luis"
          }
        ]) as Response
      )
      .mockResolvedValueOnce(jsonResponse(406, { error: "Not acceptable" }) as Response)
      .mockResolvedValueOnce(jsonResponse(406, { error: "Still not acceptable" }) as Response)
      .mockResolvedValueOnce(
        binaryResponse(200, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          "content-type": "application/zip"
        }) as Response
      );

    await expect(
      service.getRepositoryArchive("project-1", "main", {
        userId: "reader-1",
        globalRole: "reader"
      } as any)
    ).resolves.toMatchObject({
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      contentType: "application/zip"
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "https://git.atlasium.info/api/v4/projects/123/repository/archive.zip?sha=commit-sha-3&access_token=user-token",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String)
        })
      })
    );
  });

  it("builds a fallback ZIP from repository tree and raw files after archive 406 responses", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: "commit-sha-4",
            short_id: "commit",
            title: "Main",
            message: "Main",
            authored_date: "2026-03-31T18:00:00.000Z",
            author_name: "Luis"
          }
        ]) as Response
      )
      .mockResolvedValueOnce(jsonResponse(406, { error: "Not acceptable" }) as Response)
      .mockResolvedValueOnce(jsonResponse(406, { error: "Still not acceptable" }) as Response)
      .mockResolvedValueOnce(jsonResponse(406, { error: "Query auth not acceptable" }) as Response)
      .mockResolvedValueOnce(
        jsonResponse(200, [
          { id: "blob-1", name: "README.md", type: "blob", path: "README.md", mode: "100644" },
          { id: "blob-2", name: "main.ts", type: "blob", path: "src/main.ts", mode: "100644" }
        ]) as Response
      )
      .mockResolvedValueOnce(binaryResponse(200, new TextEncoder().encode("# Navigation\n")) as Response)
      .mockResolvedValueOnce(binaryResponse(200, new TextEncoder().encode("console.log('nav');\n")) as Response);

    const archive = await service.getRepositoryArchive("project-1", "main", {
      userId: "reader-1",
      globalRole: "reader"
    } as any);
    const zip = new AdmZip(archive.buffer);

    expect(archive.fileName).toBe("atlasium-nav-main.zip");
    expect(archive.contentType).toBe("application/zip");
    expect(zip.readAsText("README.md")).toBe("# Navigation\n");
    expect(zip.readAsText("src/main.ts")).toBe("console.log('nav');\n");
  });

  it("maps repository access failures from repository read and write operations", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(403, { message: "forbidden" }) as Response)
      .mockResolvedValueOnce(jsonResponse(500, { message: "boom" }) as Response);

    await expect(
      service.listMergeRequests(
        "project-1",
        "opened",
        {
          userId: "user-1",
          globalRole: "reader"
        } as any
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.getRepositoryArchive(
        "project-1",
        "main",
        {
          userId: "user-1",
          globalRole: "reader"
        } as any
      )
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("lists branches for the readable repository", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          name: "main",
          default: true,
          merged: false,
          can_push: true,
          protected: true,
          web_url: "https://git.atlasium.info/atlasium/nav/-/tree/main"
        }
      ]) as Response
    );

    await expect(
      service.listBranches(
        "project-1",
        {
          userId: "user-1",
          globalRole: "reader"
        } as any
      )
    ).resolves.toEqual([
      {
        name: "main",
        default: true,
        merged: false,
        canPush: true,
        protected: true,
        webUrl: "https://git.atlasium.info/atlasium/nav/-/tree/main"
      }
    ]);
  });

  it("lists commits using the requested ref", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          id: "abc123",
          short_id: "abc123",
          title: "Add navigation draft",
          message: "Add navigation draft\n\nMore context",
          authored_date: "2026-04-06T12:00:00.000Z",
          author_name: "Luis",
          web_url: "https://git.atlasium.info/atlasium/nav/-/commit/abc123"
        }
      ]) as Response
    );

    await expect(
      service.listCommits(
        "project-1",
        "feature/nav",
        {
          userId: "user-1",
          globalRole: "reader"
        } as any
      )
    ).resolves.toEqual([
      {
        id: "abc123",
        shortId: "abc123",
        title: "Add navigation draft",
        message: "Add navigation draft\n\nMore context",
        authoredDate: "2026-04-06T12:00:00.000Z",
        authorName: "Luis",
        webUrl: "https://git.atlasium.info/atlasium/nav/-/commit/abc123"
      }
    ]);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://git.atlasium.info/api/v4/projects/123/repository/commits?per_page=25&ref_name=feature%2Fnav"
    );
  });

  it("returns the repository tree for the requested path and ref", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, [
        {
          id: "tree-1",
          name: "src",
          path: "src",
          type: "tree"
        },
        {
          id: "blob-1",
          name: "index.ts",
          path: "src/index.ts",
          type: "blob"
        }
      ]) as Response
    );

    await expect(
      service.getRepositoryTree(
        "project-1",
        "src",
        "feature/nav",
        {
          userId: "user-1",
          globalRole: "reader"
        } as any
      )
    ).resolves.toEqual({
      ref: "feature/nav",
      path: "src",
      entries: [
        { id: "tree-1", name: "src", path: "src", type: "tree" },
        { id: "blob-1", name: "index.ts", path: "src/index.ts", type: "blob" }
      ]
    });
  });

  it("returns text repository files decoded from base64", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        file_path: "README.md",
        file_name: "README.md",
        ref: "main",
        size: 14,
        content: Buffer.from("# Navigation\n").toString("base64")
      }) as Response
    );

    await expect(
      service.getRepositoryFile(
        "project-1",
        "README.md",
        undefined,
        {
          userId: "user-1",
          globalRole: "reader"
        } as any
      )
    ).resolves.toEqual({
      filePath: "README.md",
      fileName: "README.md",
      ref: "main",
      size: 14,
      binary: false,
      content: "# Navigation\n"
    });
  });

  it("lists Docs markdown files recursively and decodes their content", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            id: "blob-1",
            name: "Intro.md",
            path: "Docs/Guides/Intro.md",
            type: "blob"
          },
          {
            id: "blob-2",
            name: "logo.png",
            path: "Docs/logo.png",
            type: "blob"
          }
        ]) as Response
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          file_path: "Docs/Guides/Intro.md",
          file_name: "Intro.md",
          ref: "main",
          size: 8,
          encoding: "base64",
          content_sha256: "sha-1",
          blob_id: "blob-1",
          commit_id: "commit-1",
          last_commit_id: "commit-1",
          content: Buffer.from("# Intro\n").toString("base64")
        }) as Response
      );

    await expect(
      service.listRepositoryDocsMarkdownFiles(
        "project-1",
        {
          userId: "user-1",
          globalRole: "reader"
        } as any,
        "repo-1"
      )
    ).resolves.toEqual([
      {
        docsPath: "Docs/Guides/Intro.md",
        relativePath: "Guides/Intro.md",
        fileName: "Intro.md",
        ref: "main",
        blobId: "blob-1",
        lastCommitId: "commit-1",
        contentSha256: "sha-1",
        content: "# Intro\n"
      }
    ]);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://git.atlasium.info/api/v4/projects/123/repository/tree?recursive=true&per_page=100&page=1&ref=main&path=Docs"
    );
  });

  it("creates repository commits for Docs file actions", async () => {
    const { service, auditService } = makeServiceWithDeps();
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(201, {
        id: "commit-2",
        short_id: "commit-2",
        title: "Sync docs",
        message: "Sync docs",
        authored_date: "2026-06-02T10:00:00.000Z",
        author_name: "Luis",
        web_url: "https://git.atlasium.info/atlasium/nav/-/commit/commit-2"
      }) as Response
    );

    await expect(
      service.commitRepositoryFileActions(
        "project-1",
        {
          userId: "user-1",
          globalRole: "editor"
        } as any,
        "repo-1",
        [
          {
            action: "update",
            filePath: "Docs/Intro.md",
            content: "# Intro",
            lastCommitId: "commit-1"
          }
        ],
        "Sync docs"
      )
    ).resolves.toEqual({
      id: "commit-2",
      shortId: "commit-2",
      title: "Sync docs",
      message: "Sync docs",
      webUrl: "https://git.atlasium.info/atlasium/nav/-/commit/commit-2"
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/repository/commits");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        branch: "main",
        commit_message: "Sync docs",
        actions: [
          {
            action: "update",
            file_path: "Docs/Intro.md",
            content: "# Intro",
            last_commit_id: "commit-1"
          }
        ]
      })
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.repository.docs.commit",
        entityId: "repo-1"
      })
    );
  });

  it("returns binary repository files without exposing decoded text content", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        file_path: "assets/logo.png",
        file_name: "logo.png",
        ref: "main",
        size: 4,
        content: Buffer.from([0x00, 0xff, 0x10, 0x89]).toString("base64")
      }) as Response
    );

    await expect(
      service.getRepositoryFile(
        "project-1",
        "assets/logo.png",
        undefined,
        {
          userId: "user-1",
          globalRole: "reader"
        } as any
      )
    ).resolves.toEqual({
      filePath: "assets/logo.png",
      fileName: "logo.png",
      ref: "main",
      size: 4,
      binary: true,
      content: null
    });
  });

  it("streams raw repository files for image previews", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecordById").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      binaryResponse(200, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        "content-type": "image/png"
      }) as Response
    );

    await expect(
      service.getRepositoryRawFile(
        "project-1",
        "plots/Coordinates.png",
        "main",
        {
          userId: "user-1",
          globalRole: "reader"
        } as any,
        "repo-1"
      )
    ).resolves.toEqual({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      fileName: "Coordinates.png",
      contentType: "image/png"
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://git.atlasium.info/api/v4/projects/123/repository/files/plots%2FCoordinates.png/raw?ref=main",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "*/*",
          Authorization: "Bearer user-token"
        })
      })
    );
  });

  it("creates a repository branch and writes an audit log", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(201, {
        name: "feature/nav",
        default: false,
        web_url: "https://git.atlasium.info/atlasium/nav/-/tree/feature/nav"
      }) as Response
    );

    await expect(
      service.createBranch(
        "project-1",
        {
          name: "feature/nav",
          sourceRef: "main"
        },
        {
          userId: "user-1",
          globalRole: "editor"
        } as any
      )
    ).resolves.toEqual({
      name: "feature/nav",
      webUrl: "https://git.atlasium.info/atlasium/nav/-/tree/feature/nav",
      default: false
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/repository/branches");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        branch: "feature/nav",
        ref: "main"
      })
    });
    expect((service as any).auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.repository.branch.create"
      })
    );
  });

  it.each([
    [{ name: "   ", sourceRef: "main" }, "Branch name is required."],
    [{ name: "feature/nav", sourceRef: "   " }, "Source ref is required."]
  ])("rejects invalid repository branch creation payloads", async (dto, message) => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);

    await expect(
      service.createBranch(
        "project-1",
        dto,
        {
          userId: "user-1",
          globalRole: "editor"
        } as any
      )
    ).rejects.toThrow(message);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect((service as any).auditService.log).not.toHaveBeenCalled();
  });

  it("creates a merge request and writes an audit log", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
    jest
      .spyOn(service as any, "withUserAccessToken")
      .mockImplementation(async (...args: unknown[]) => {
        const callback = args[1] as (accessToken: string) => Promise<unknown>;
        return callback("user-token");
      });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(201, {
        id: 91,
        iid: 14,
        title: "Merge navigation updates",
        state: "opened",
        web_url: "https://git.atlasium.info/atlasium/nav/-/merge_requests/14"
      }) as Response
    );

    await expect(
      service.createMergeRequest(
        "project-1",
        {
          sourceBranch: "feature/nav",
          targetBranch: "main",
          title: "Merge navigation updates",
          description: "Ready for review"
        },
        {
          userId: "user-1",
          globalRole: "editor"
        } as any
      )
    ).resolves.toEqual({
      id: 91,
      iid: 14,
      title: "Merge navigation updates",
      state: "opened",
      webUrl: "https://git.atlasium.info/atlasium/nav/-/merge_requests/14"
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://git.atlasium.info/api/v4/projects/123/merge_requests");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        source_branch: "feature/nav",
        target_branch: "main",
        title: "Merge navigation updates",
        description: "Ready for review"
      })
    });
    expect((service as any).auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.repository.merge_request.create"
      })
    );
  });

  it.each([
    [
      { sourceBranch: "   ", targetBranch: "main", title: "Merge navigation updates" },
      "Source branch is required."
    ],
    [
      { sourceBranch: "feature/nav", targetBranch: "   ", title: "Merge navigation updates" },
      "Target branch is required."
    ],
    [
      { sourceBranch: "feature/nav", targetBranch: "main", title: "   " },
      "Merge request title is required."
    ],
    [
      { sourceBranch: "main", targetBranch: "main", title: "Merge navigation updates" },
      "Source and target branches must be different."
    ]
  ])("rejects invalid merge request creation payloads", async (dto, message) => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);

    await expect(
      service.createMergeRequest(
        "project-1",
        dto,
        {
          userId: "user-1",
          globalRole: "editor"
        } as any
      )
    ).rejects.toThrow(message);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect((service as any).auditService.log).not.toHaveBeenCalled();
  });

  it("rejects manual repository linking and searching flows for managed GitLab projects", async () => {
    const service = makeService();

    await expect(service.searchProjects({} as any, "nav")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.linkRepository("project-1", {} as any, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.disconnectRepository("project-1", {} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("fails readable and writable repository lookups when the repository is not provisioned", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(null);

    await expect(
      (service as any).requireReadableRepository("project-1", {
        userId: "reader-1",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      (service as any).requireWritableRepository("project-1", {
        userId: "editor-1",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects repository file reads without a file path", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);

    await expect(
      service.getRepositoryFile(
        "project-1",
        "   ",
        "main",
        {
          userId: "reader-1",
          globalRole: "reader"
        } as any
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refresh helpers reject reconnect-required or disconnected user states", async () => {
    const { service, prisma } = makeServiceWithDeps();
    prisma.gitLabConnection.findUnique.mockResolvedValue(null);

    await expect((service as any).requireConnectionRecord("user-1")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      (service as any).ensureConnectionReady({
        userId: "user-1",
        reconnectRequired: true
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refreshes expiring user tokens and handles missing refresh tokens", async () => {
    const { service } = makeServiceWithDeps();
    const refreshConnectionSpy = jest
      .spyOn(service as any, "refreshConnection")
      .mockResolvedValue({ userId: "user-1", reconnectRequired: false });

    await expect(
      (service as any).ensureConnectionReady({
        userId: "user-1",
        reconnectRequired: false,
        tokenExpiresAt: new Date(Date.now() + 10_000)
      })
    ).resolves.toEqual({ userId: "user-1", reconnectRequired: false });
    expect(refreshConnectionSpy).toHaveBeenCalled();
    refreshConnectionSpy.mockRestore();

    const markReconnectRequiredSpy = jest.spyOn(service as any, "markReconnectRequired").mockResolvedValue(undefined);
    await expect(
      (service as any).refreshConnection({
        userId: "user-1",
        refreshTokenEncrypted: null
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(markReconnectRequiredSpy).toHaveBeenCalledWith("user-1");
  });

  it("exchanges OAuth tokens directly and surfaces exchange failures", async () => {
    const service = makeService();

    fetchSpy
      .mockResolvedValueOnce(
        {
          ok: true,
          json: async () => ({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600
          })
        } as Response
      )
      .mockResolvedValueOnce(
        {
          ok: false,
          text: async () => "invalid_grant"
        } as Response
      );

    await expect(
      (service as any).exchangeUserOAuthToken({
        grantType: "authorization_code",
        params: { code: "code-123" }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        access_token: "access-token",
        refresh_token: "refresh-token"
      })
    );

    await expect(
      (service as any).exchangeUserOAuthToken({
        grantType: "refresh_token",
        params: { refresh_token: "bad-token" }
      })
    ).rejects.toEqual(
      expect.objectContaining({
        constructor: UnauthorizedException,
        message: "invalid_grant"
      })
    );
  });

  it("supports empty JSON responses and binary GitLab request failures", async () => {
    const service = makeService();

    fetchSpy
      .mockResolvedValueOnce(
        {
          ok: true,
          text: async () => ""
        } as Response
      )
      .mockResolvedValueOnce(jsonResponse(404, { message: "404 Project Not Found" }) as Response);

    await expect((service as any).executeGitlabRequest("token", "/noop")).resolves.toBeUndefined();
    await expect((service as any).executeGitlabBinaryRequest("token", "/archive")).rejects.toMatchObject({
      status: 404
    });
  });

  it("maps repository, infrastructure, and SSH key errors to Nest exceptions", () => {
    const service = makeService();

    expect((service as any).mapRepositoryAccessError(new Error("network"))).toBeInstanceOf(Error);
    expect((service as any).mapRepositoryAccessError({})).toBeInstanceOf(BadGatewayException);
    expect((service as any).mapInfrastructureError({})).toBeInstanceOf(BadGatewayException);
    expect((service as any).mapUserSshKeyError({})).toBeInstanceOf(BadGatewayException);
  });

  it("maps GitLabApiError variants across repository, infrastructure, and SSH key helpers", async () => {
    const service = makeService();
    const captureGitlabError = async (status: number, body: string) => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => body
      } as Response);
      try {
        await (service as any).executeGitlabRequest("token", "/failing");
      } catch (error) {
        return error;
      }
      throw new Error("Expected GitLab request to fail");
    };

    const repo401 = (service as any).mapRepositoryAccessError(await captureGitlabError(401, "expired"));
    const repo403 = (service as any).mapRepositoryAccessError(await captureGitlabError(403, "forbidden"));
    const repo500 = (service as any).mapRepositoryAccessError(await captureGitlabError(500, "boom"));
    const repo400 = (service as any).mapRepositoryAccessError(
      await captureGitlabError(400, JSON.stringify({ message: { path: ["taken"] } }))
    );
    const infra404 = (service as any).mapInfrastructureError(await captureGitlabError(404, "missing"));
    const ssh404 = (service as any).mapUserSshKeyError(await captureGitlabError(404, "missing"));

    expect(repo401).toBeInstanceOf(UnauthorizedException);
    expect(repo403).toBeInstanceOf(ForbiddenException);
    expect(repo500).toBeInstanceOf(BadGatewayException);
    expect(repo400).toBeInstanceOf(BadRequestException);
    expect(infra404).toBeInstanceOf(ServiceUnavailableException);
    expect(ssh404).toBeInstanceOf(NotFoundException);
  });

  it("validates repository paths, SSH key ids, archive names, and token expiry helpers", () => {
    expect(normalizeRepositoryPath(" NAV Project ")).toBe("nav-project");
    expect(() => normalizeRepositoryPath("!!!")).toThrow(BadRequestException);

    expect(normalizeUserSshKeyId(" 42 ")).toBe("42");
    expect(() => normalizeUserSshKeyId("ssh-key")).toThrow(BadRequestException);

    expect(buildRepositoryArchiveFileName("/atlasium/nav/", "feature/nav")).toBe("atlasium-nav-feature-nav.zip");
    expect(resolveTokenExpiry({ expires_in: 0 })).toBeNull();
    expect(resolveTokenExpiry({ expires_in: 3600 })).toBeInstanceOf(Date);
  });

  it("extracts structured and raw GitLab error messages", () => {
    const service = makeService();

    expect((service as any).extractGitlabErrorMessage("", "fallback")).toBe("fallback");
    expect((service as any).extractGitlabErrorMessage("plain text", "fallback")).toBe("plain text");
    expect(
      (service as any).extractGitlabErrorMessage(JSON.stringify({ message: { path: ["taken"], title: ["invalid"] } }), "fallback")
    ).toBe("taken. invalid");
  });
});
