import { ServiceUnavailableException } from "@nestjs/common";

import { GitlabService } from "./gitlab.service";

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

function jsonResponse(status: number, body?: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body))
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
    const accessService: any = {};
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
});
