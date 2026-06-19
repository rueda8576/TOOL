import { BadRequestException } from "@nestjs/common";

import {
  buildRepositoryCloneUrl,
  buildRepositorySshCloneUrl,
  mapManagedProvision,
  mapRepositoryStatusFromProject,
  mapRepositorySummaryFromRecord,
  mapUserSshKey,
  normalizeRepositoryPath,
  normalizeUserSshKeyId,
  resolveTokenExpiry
} from "./gitlab-mappers";

describe("gitlab mappers", () => {
  const browserBaseUrl = "https://git.atlasium.info";
  const repository = {
    id: "repo-1",
    gitlabProjectId: "123",
    name: "Navigation",
    description: "Project navigation",
    webUrl: "https://git.atlasium.info/atlasium/nav",
    pathWithNamespace: "/atlasium/nav",
    defaultBranch: "main",
    visibility: "private",
    lastActivityAt: new Date("2026-06-18T12:00:00.000Z"),
    connectedAt: new Date("2026-06-18T11:00:00.000Z"),
    connectedByUserId: "user-1"
  };

  it("normalizes repository paths and builds HTTPS/SSH clone URLs", () => {
    expect(normalizeRepositoryPath(" NAV Project ")).toBe("nav-project");
    expect(normalizeRepositoryPath("A/B:C")).toBe("a-b-c");
    expect(() => normalizeRepositoryPath("!!!")).toThrow(BadRequestException);

    expect(buildRepositoryCloneUrl(browserBaseUrl, "/atlasium/nav")).toBe("https://git.atlasium.info/atlasium/nav.git");
    expect(buildRepositorySshCloneUrl(browserBaseUrl, "/atlasium/nav")).toBe("git@git.atlasium.info:atlasium/nav.git");
  });

  it("maps persisted repositories to API summaries", () => {
    expect(mapRepositorySummaryFromRecord(repository, browserBaseUrl)).toEqual({
      id: "repo-1",
      gitlabProjectId: "123",
      name: "Navigation",
      description: "Project navigation",
      webUrl: "https://git.atlasium.info/atlasium/nav",
      sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
      httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git",
      pathWithNamespace: "/atlasium/nav",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-06-18T12:00:00.000Z",
      connectedAt: "2026-06-18T11:00:00.000Z",
      connectedByUserId: "user-1",
      managed: true
    });
  });

  it("maps remote GitLab projects to connected repository status with clone fallbacks", () => {
    expect(mapRepositoryStatusFromProject(
      {
        id: 456,
        name: "Navigation Remote",
        description: null,
        web_url: "https://git.atlasium.info/atlasium/nav",
        path_with_namespace: "atlasium/nav",
        default_branch: null,
        visibility: "private",
        last_activity_at: "2026-06-18T13:00:00.000Z"
      },
      repository,
      browserBaseUrl
    )).toEqual({
      connected: true,
      id: "repo-1",
      gitlabProjectId: "456",
      name: "Navigation Remote",
      description: null,
      webUrl: "https://git.atlasium.info/atlasium/nav",
      sshCloneUrl: "git@git.atlasium.info:atlasium/nav.git",
      httpCloneUrl: "https://git.atlasium.info/atlasium/nav.git",
      pathWithNamespace: "atlasium/nav",
      defaultBranch: "main",
      visibility: "private",
      lastActivityAt: "2026-06-18T13:00:00.000Z",
      connectedAt: "2026-06-18T11:00:00.000Z",
      connectedByUserId: "user-1",
      managed: true
    });
  });

  it("maps SSH keys and validates SSH key ids", () => {
    expect(mapUserSshKey({
      id: 42,
      title: "Laptop",
      key: "ssh-ed25519 AAA",
      created_at: "2026-06-18T12:00:00.000Z",
      expires_at: undefined,
      usage_type: "auth"
    })).toEqual({
      id: 42,
      title: "Laptop",
      key: "ssh-ed25519 AAA",
      createdAt: "2026-06-18T12:00:00.000Z",
      expiresAt: null,
      usageType: "auth"
    });
    expect(normalizeUserSshKeyId(" 42 ")).toBe("42");
    expect(() => normalizeUserSshKeyId("ssh-key")).toThrow(BadRequestException);
  });

  it("resolves token expiry and managed provisioning payloads", () => {
    expect(resolveTokenExpiry({ expires_in: 0 }, 1_000)).toBeNull();
    expect(resolveTokenExpiry({ expires_in: 60 }, 1_000)?.toISOString()).toBe("1970-01-01T00:01:01.000Z");

    expect(mapManagedProvision({
      id: 123,
      name: "Navigation",
      description: null,
      web_url: "https://git.atlasium.info/atlasium/nav",
      path_with_namespace: "atlasium/nav",
      default_branch: null,
      visibility: "private",
      last_activity_at: "2026-06-18T12:00:00.000Z"
    })).toEqual({
      gitlabProjectId: "123",
      pathWithNamespace: "atlasium/nav",
      webUrl: "https://git.atlasium.info/atlasium/nav",
      defaultBranch: "main",
      name: "Navigation",
      description: null,
      visibility: "private",
      lastActivityAt: "2026-06-18T12:00:00.000Z"
    });
  });
});
