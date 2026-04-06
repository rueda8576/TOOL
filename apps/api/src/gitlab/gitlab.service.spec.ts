import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";

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
    pathWithNamespace: "atlasium/nav",
    webUrl: "https://git.atlasium.info/atlasium/nav",
    defaultBranch: "main",
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

  const makeService = (): GitlabService => {
    const prisma: any = {};
    const accessService: any = {
      ensureProjectReadable: jest.fn().mockResolvedValue(undefined),
      ensureProjectWritable: jest.fn().mockResolvedValue(undefined),
      getProjectAccess: jest.fn().mockResolvedValue(undefined)
    };
    const auditService: any = {
      log: jest.fn().mockResolvedValue(undefined)
    };
    return new GitlabService(prisma, accessService, auditService);
  };

  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env.GITLAB_BASE_URL = "https://git.atlasium.info";
    process.env.GITLAB_SYSTEM_ACCESS_TOKEN = "system-token";
    process.env.GITLAB_SYSTEM_USER_ID = "999";
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("skips direct project membership creation when inherited group access already satisfies the desired role", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
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
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
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

  it("updates an existing direct project member when the direct access is too low", async () => {
    const service = makeService();
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
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
    jest.spyOn(service as any, "findRepositoryRecord").mockResolvedValue(repositoryRecord);
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

    fetchSpy.mockResolvedValueOnce(
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

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://git.atlasium.info/api/v4/projects/123/repository/archive.zip?sha=feature%2Fexport",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer user-token"
        })
      })
    );
  });
});
