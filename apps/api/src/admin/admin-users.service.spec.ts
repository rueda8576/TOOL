import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { GlobalRole, ProjectRole } from "@prisma/client";

import * as collaborationRegistry from "../documents/collaboration-server-registry";
import { AdminUsersService } from "./admin-users.service";

describe("AdminUsersService", () => {
  const makeService = (): { service: AdminUsersService; prisma: any; auditService: any; gitlabService: any } => {
    const prisma: any = {
      user: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      },
      project: {
        findMany: jest.fn(),
        count: jest.fn()
      },
      session: {
        deleteMany: jest.fn()
      },
      projectMember: {
        deleteMany: jest.fn(),
        createMany: jest.fn()
      },
      userPinnedProject: {
        deleteMany: jest.fn()
      },
      gitLabConnection: {
        deleteMany: jest.fn()
      },
      projectRepository: {
        findMany: jest.fn(),
        count: jest.fn()
      },
      document: {
        count: jest.fn()
      },
      documentBranch: {
        count: jest.fn()
      },
      documentVersion: {
        count: jest.fn()
      },
      wikiPage: {
        count: jest.fn()
      },
      wikiRevision: {
        count: jest.fn()
      },
      wikiDraft: {
        count: jest.fn()
      },
      wikiAsset: {
        count: jest.fn()
      },
      task: {
        count: jest.fn()
      },
      taskDependency: {
        count: jest.fn()
      },
      meeting: {
        count: jest.fn()
      },
      invite: {
        count: jest.fn()
      },
      $transaction: jest.fn()
    };

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
    prisma.projectRepository.findMany.mockResolvedValue([]);

    [
      prisma.user.count,
      prisma.project.count,
      prisma.projectRepository.count,
      prisma.document.count,
      prisma.documentBranch.count,
      prisma.documentVersion.count,
      prisma.wikiPage.count,
      prisma.wikiRevision.count,
      prisma.wikiDraft.count,
      prisma.wikiAsset.count,
      prisma.task.count,
      prisma.taskDependency.count,
      prisma.meeting.count,
      prisma.invite.count
    ].forEach((mock) => mock.mockResolvedValue(0));

    const auditService = {
      log: jest.fn()
    };

    const gitlabService = {
      syncProjectRepositoryAccess: jest.fn()
    };

    return {
      service: new AdminUsersService(prisma, auditService as any, gitlabService as any),
      prisma,
      auditService,
      gitlabService
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("lists active users with per-project role mapping", async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([
      {
        id: "admin-1",
        name: "Admin",
        email: "admin@example.com",
        isActive: true,
        createdAt: new Date("2026-03-30T09:00:00.000Z"),
        globalRole: GlobalRole.ADMIN,
        projectMemberships: []
      },
      {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com",
        isActive: true,
        createdAt: new Date("2026-03-30T10:00:00.000Z"),
        globalRole: GlobalRole.EDITOR,
        projectMemberships: [
          {
            role: ProjectRole.EDITOR,
            project: {
              id: "project-1",
              key: "PHD1",
              name: "Main project"
            }
          }
        ]
      }
    ]);

    await expect(
      service.listUsers({
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      })
    ).resolves.toEqual([
      {
        id: "admin-1",
        name: "Admin",
        email: "admin@example.com",
        globalRole: "admin",
        isActive: true,
        createdAt: "2026-03-30T09:00:00.000Z",
        projectAccessMode: "all_projects",
        projects: []
      },
      {
        id: "editor-1",
        name: "Editor",
        email: "editor@example.com",
        globalRole: "editor",
        isActive: true,
        createdAt: "2026-03-30T10:00:00.000Z",
        projectAccessMode: "selected_projects",
        projects: [
          {
            id: "project-1",
            key: "PHD1",
            name: "Main project",
            role: "editor"
          }
        ]
      }
    ]);
  });

  it("replaces project memberships for non-admin users with project roles and revokes realtime connections", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const disconnectUser = jest.fn();
    jest.spyOn(collaborationRegistry, "getDocumentsCollaborationServer").mockReturnValue({
      disconnectUser
    } as any);

    prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-2",
      name: "Editor",
      email: "editor@example.com",
      isActive: true,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      globalRole: GlobalRole.EDITOR,
      projectMemberships: []
    });
    prisma.project.findMany.mockResolvedValue([{ id: "project-1" }, { id: "project-2" }]);
    prisma.user.update.mockResolvedValue({ id: "user-2" });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-2",
      name: "Editor",
      email: "editor@example.com",
      isActive: true,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      globalRole: GlobalRole.READER,
      projectMemberships: [
        {
          role: ProjectRole.EDITOR,
          project: {
            id: "project-1",
            key: "PHD1",
            name: "Main project"
          }
        },
        {
          role: ProjectRole.READER,
          project: {
            id: "project-2",
            key: "PHD2",
            name: "Second project"
          }
        }
      ]
    });

    const result = await service.updateUser(
      "user-2",
      {
        globalRole: "reader",
        projectAccess: [
          { projectId: "project-1", role: "editor" },
          { projectId: "project-2", role: "reader" },
          { projectId: "project-1", role: "editor" }
        ]
      },
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      }
    );

    expect(prisma.projectMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-2" } });
    expect(prisma.projectMember.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: "project-1", userId: "user-2", role: ProjectRole.EDITOR },
        { projectId: "project-2", userId: "user-2", role: ProjectRole.READER }
      ],
      skipDuplicates: true
    });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-2" } });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.update",
        metadata: {
          globalRole: "reader",
          projectAccess: [
            { projectId: "project-1", role: "editor" },
            { projectId: "project-2", role: "reader" }
          ]
        }
      })
    );
    expect(disconnectUser).toHaveBeenCalledWith("user-2", "Permissions updated by an administrator");
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("project-1");
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("project-2");
    expect(result).toEqual({
      id: "user-2",
      name: "Editor",
      email: "editor@example.com",
      globalRole: "reader",
      isActive: true,
      createdAt: "2026-03-30T10:00:00.000Z",
      projectAccessMode: "selected_projects",
      projects: [
        {
          id: "project-1",
          key: "PHD1",
          name: "Main project",
          role: "editor"
        },
        {
          id: "project-2",
          key: "PHD2",
          name: "Second project",
          role: "reader"
        }
      ]
    });
  });

  it("does not allow removing the last active admin", async () => {
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      isActive: true,
      createdAt: new Date(),
      globalRole: GlobalRole.ADMIN,
      projectMemberships: []
    });
    prisma.user.count.mockResolvedValue(1);

    await expect(
      service.updateUser(
        "admin-1",
        {
          globalRole: "editor",
          projectAccess: []
        },
        {
          userId: "admin-2",
          email: "admin2@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns a blocked hard-delete check for authored history and the last remaining admin", async () => {
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: "admin-1",
      globalRole: GlobalRole.ADMIN,
      projectMemberships: []
    });
    prisma.user.count.mockResolvedValue(1);
    prisma.project.count.mockResolvedValue(2);
    prisma.wikiRevision.count.mockResolvedValue(3);

    await expect(
      service.getHardDeleteCheck("admin-1", {
        userId: "admin-2",
        email: "admin2@example.com",
        globalRole: "admin"
      })
    ).resolves.toEqual({
      userId: "admin-1",
      allowed: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "last_active_admin", count: 1 }),
        expect.objectContaining({ code: "projects_created", count: 2 }),
        expect.objectContaining({ code: "wiki_revisions_created", count: 3 })
      ])
    });
  });

  it("returns an allowed hard-delete check when the user has no restrictive records", async () => {
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-3",
      globalRole: GlobalRole.READER,
      projectMemberships: []
    });

    await expect(
      service.getHardDeleteCheck("user-3", {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      })
    ).resolves.toEqual({
      userId: "user-3",
      allowed: true,
      blockers: []
    });
  });

  it("forbids self-delete", async () => {
    const { service } = makeService();

    await expect(
      service.deleteUser("admin-1", {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      })
    ).rejects.toThrow("Admins cannot delete their own account");
  });

  it("soft deletes a user, removes access artifacts, and disconnects realtime", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const disconnectUser = jest.fn();
    jest.spyOn(collaborationRegistry, "getDocumentsCollaborationServer").mockReturnValue({
      disconnectUser
    } as any);

    prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-3",
      globalRole: GlobalRole.READER,
      projectMemberships: [{ projectId: "project-1" }]
    });
    prisma.user.update.mockResolvedValue({
      id: "user-3",
      globalRole: GlobalRole.READER,
      deletedAt: new Date("2026-03-30T12:00:00.000Z")
    });

    const result = await service.deleteUser(
      "user-3",
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      },
      "soft"
    );

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-3" } });
    expect(prisma.projectMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-3" } });
    expect(prisma.userPinnedProject.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-3" } });
    expect(prisma.gitLabConnection.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-3" } });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.delete",
        entityId: "user-3"
      })
    );
    expect(disconnectUser).toHaveBeenCalledWith("user-3", "Account removed by an administrator");
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("project-1");
    expect(result).toEqual({
      id: "user-3",
      mode: "soft",
      deletedAt: "2026-03-30T12:00:00.000Z"
    });
  });

  it("hard deletes a user when the preflight passes", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const disconnectUser = jest.fn();
    jest.spyOn(collaborationRegistry, "getDocumentsCollaborationServer").mockReturnValue({
      disconnectUser
    } as any);

    prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-4",
      globalRole: GlobalRole.READER,
      projectMemberships: [{ projectId: "project-2" }]
    });
    prisma.user.delete.mockResolvedValue({
      id: "user-4",
      globalRole: GlobalRole.READER
    });

    const result = await service.deleteUser(
      "user-4",
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      },
      "hard"
    );

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-4" } });
    expect(prisma.projectMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-4" } });
    expect(prisma.userPinnedProject.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-4" } });
    expect(prisma.gitLabConnection.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-4" } });
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: {
        id: "user-4"
      },
      select: {
        id: true,
        globalRole: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.hard_delete",
        entityId: "user-4"
      })
    );
    expect(disconnectUser).toHaveBeenCalledWith("user-4", "Account permanently removed by an administrator");
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("project-2");
    expect(result).toEqual({
      id: "user-4",
      mode: "hard",
      deletedAt: null
    });
  });

  it("blocks hard delete when the user still owns restrictive records", async () => {
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-5",
      globalRole: GlobalRole.READER,
      projectMemberships: []
    });
    prisma.document.count.mockResolvedValue(1);

    await expect(
      service.deleteUser(
        "user-5",
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        },
        "hard"
      )
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("rejects updates for missing users", async () => {
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateUser(
        "missing-user",
        {
          globalRole: "reader",
          projectAccess: []
        },
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
