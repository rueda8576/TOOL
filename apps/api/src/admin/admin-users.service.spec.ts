import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { GlobalRole, ProjectRole } from "@prisma/client";

import * as collaborationRegistry from "../documents/collaboration-server-registry";
import { AdminUsersService } from "./admin-users.service";

describe("AdminUsersService", () => {
  const makeService = (): { service: AdminUsersService; prisma: any; auditService: any } => {
    const prisma: any = {
      user: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn()
      },
      project: {
        findMany: jest.fn()
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
      $transaction: jest.fn()
    };

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));

    const auditService = {
      log: jest.fn()
    };

    return {
      service: new AdminUsersService(prisma, auditService as any),
      prisma,
      auditService
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
    const { service, prisma, auditService } = makeService();
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
    const { service, prisma, auditService } = makeService();
    const disconnectUser = jest.fn();
    jest.spyOn(collaborationRegistry, "getDocumentsCollaborationServer").mockReturnValue({
      disconnectUser
    } as any);

    prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-3",
      globalRole: GlobalRole.READER
    });
    prisma.user.update.mockResolvedValue({
      id: "user-3",
      deletedAt: new Date("2026-03-30T12:00:00.000Z")
    });

    const result = await service.deleteUser("user-3", {
      userId: "admin-1",
      email: "admin@example.com",
      globalRole: "admin"
    });

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-3" } });
    expect(prisma.projectMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-3" } });
    expect(prisma.userPinnedProject.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-3" } });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.delete",
        entityId: "user-3"
      })
    );
    expect(disconnectUser).toHaveBeenCalledWith("user-3", "Account removed by an administrator");
    expect(result).toEqual({
      id: "user-3",
      deletedAt: "2026-03-30T12:00:00.000Z"
    });
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
