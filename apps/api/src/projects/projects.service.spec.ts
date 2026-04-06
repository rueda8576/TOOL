import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";

import { ProjectsService } from "./projects.service";

describe("ProjectsService", () => {
  const makeService = (): {
    service: ProjectsService;
    prisma: any;
    accessService: any;
    auditService: any;
    gitlabService: any;
  } => {
    const prisma: any = {
      project: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      },
      projectMember: {
        findMany: jest.fn(),
        upsert: jest.fn()
      },
      projectRepository: {
        create: jest.fn()
      },
      user: {
        findUnique: jest.fn()
      },
      userPinnedProject: {
        upsert: jest.fn(),
        deleteMany: jest.fn()
      },
      $transaction: jest.fn()
    };

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));

    const accessService: any = {
      getProjectAccess: jest.fn(),
      ensureProjectReadable: jest.fn(),
      ensureProjectWritable: jest.fn()
    };

    const auditService: any = {
      log: jest.fn()
    };

    const gitlabService: any = {
      provisionManagedRemoteRepository: jest.fn(),
      rollbackManagedRemoteProvision: jest.fn(),
      syncProjectRepositoryAccess: jest.fn(),
      archiveManagedRepository: jest.fn(),
      unarchiveManagedRepository: jest.fn()
    };

    return {
      service: new ProjectsService(prisma, accessService, auditService, gitlabService),
      prisma,
      accessService,
      auditService,
      gitlabService
    };
  };

  it("lists projects with createdAt/isPinned mapping for editor membership", async () => {
    const { service, prisma } = makeService();
    const createdAt = new Date("2026-03-03T10:00:00.000Z");

    prisma.project.findMany.mockResolvedValue([
      {
        id: "p1",
        key: "PHD1",
        name: "Main project",
        description: "desc",
        createdAt,
        pinnedByUsers: [{ id: "pin1" }]
      }
    ]);

    const result = await service.listProjects({
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          members: {
            some: {
              userId: "u1"
            }
          }
        },
        orderBy: { createdAt: "desc" }
      })
    );

    expect(result).toEqual([
      {
        id: "p1",
        key: "PHD1",
        name: "Main project",
        description: "desc",
        createdAt: "2026-03-03T10:00:00.000Z",
        isPinned: true
      }
    ]);
  });

  it("lists admin projects without membership filter", async () => {
    const { service, prisma } = makeService();
    prisma.project.findMany.mockResolvedValue([]);

    await service.listProjects({
      userId: "admin-1",
      email: "admin@example.com",
      globalRole: "admin"
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null }
      })
    );
  });

  it("allows admins to create projects and logs audit", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();

    prisma.project.findUnique.mockResolvedValue(null);
    gitlabService.provisionManagedRemoteRepository.mockResolvedValue({
      gitlabProjectId: "gl-1",
      pathWithNamespace: "atlasium/PHD1",
      webUrl: "https://git.atlasium.info/atlasium/PHD1",
      defaultBranch: "main"
    });
    prisma.project.create.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "desc"
    });

    const result = await service.createProject(
      {
        key: "phd1",
        name: "Main project",
        description: "desc"
      },
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      }
    );

    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: "PHD1",
          createdById: "admin-1",
          members: {
            create: {
              userId: "admin-1",
              role: ProjectRole.EDITOR
            }
          }
        })
      })
    );
    expect(prisma.projectRepository.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "p1",
        gitlabProjectId: "gl-1",
        connectedByUserId: "admin-1"
      })
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.create",
        entityType: "project"
      })
    );
    expect(result).toEqual({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "desc"
    });
  });

  it.each(["editor", "reader"] as const)("rejects project creation for %s role", async (role) => {
    const { service } = makeService();

    await expect(
      service.createProject(
        {
          key: "PHD1",
          name: "Main project"
        },
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: role
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects duplicate project keys before provisioning a managed repository", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.project.findUnique.mockResolvedValue({ id: "existing-project" });

    await expect(
      service.createProject(
        {
          key: "phd1",
          name: "Duplicate"
        },
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(gitlabService.provisionManagedRemoteRepository).not.toHaveBeenCalled();
  });

  it("rolls back the provisioned repository when project creation transaction fails", async () => {
    const { service, prisma, gitlabService } = makeService();

    prisma.project.findUnique.mockResolvedValue(null);
    gitlabService.provisionManagedRemoteRepository.mockResolvedValue({
      gitlabProjectId: "gl-rollback",
      pathWithNamespace: "atlasium/PHD2",
      webUrl: "https://git.atlasium.info/atlasium/PHD2",
      defaultBranch: "main"
    });
    prisma.$transaction.mockRejectedValue(new Error("db write failed"));

    await expect(
      service.createProject(
        {
          key: "PHD2",
          name: "Rollback project"
        },
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toThrow("db write failed");

    expect(gitlabService.rollbackManagedRemoteProvision).toHaveBeenCalledWith("gl-rollback");
    expect(gitlabService.syncProjectRepositoryAccess).not.toHaveBeenCalled();
  });

  it("deletes the created project and rolls back GitLab when repository access sync fails", async () => {
    const { service, prisma, gitlabService } = makeService();

    prisma.project.findUnique.mockResolvedValue(null);
    gitlabService.provisionManagedRemoteRepository.mockResolvedValue({
      gitlabProjectId: "gl-sync",
      pathWithNamespace: "atlasium/PHD3",
      webUrl: "https://git.atlasium.info/atlasium/PHD3",
      defaultBranch: "main"
    });
    prisma.project.create.mockResolvedValue({
      id: "p-sync",
      key: "PHD3",
      name: "Sync project",
      description: null
    });
    gitlabService.syncProjectRepositoryAccess.mockRejectedValue(new Error("sync failed"));

    await expect(
      service.createProject(
        {
          key: "PHD3",
          name: "Sync project"
        },
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toThrow("sync failed");

    expect(prisma.project.delete).toHaveBeenCalledWith({
      where: {
        id: "p-sync"
      }
    });
    expect(gitlabService.rollbackManagedRemoteProvision).toHaveBeenCalledWith("gl-sync");
  });

  it("pins project idempotently and logs audit", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    const createdAt = new Date("2026-03-03T11:00:00.000Z");

    prisma.userPinnedProject.upsert.mockResolvedValue({
      projectId: "p1",
      createdAt
    });

    const result = await service.pinProject("p1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "reader"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("u1", "reader", "p1");
    expect(prisma.userPinnedProject.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_projectId: {
            userId: "u1",
            projectId: "p1"
          }
        }
      })
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.pin",
        entityType: "project_pin"
      })
    );
    expect(result).toEqual({
      projectId: "p1",
      pinned: true,
      pinnedAt: "2026-03-03T11:00:00.000Z"
    });
  });

  it("returns project access context from the shared access service", async () => {
    const { service, accessService } = makeService();
    accessService.getProjectAccess.mockResolvedValue({
      isAdmin: false,
      projectRole: "editor",
      canWrite: true
    });

    await expect(
      service.getProjectAccess("p1", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual({
      isAdmin: false,
      projectRole: "editor",
      canWrite: true
    });

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("u1", "reader", "p1");
  });

  it("unpinned project is idempotent and logs audit", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    prisma.userPinnedProject.deleteMany.mockResolvedValue({ count: 0 });

    const result = await service.unpinProject("p1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(prisma.userPinnedProject.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        projectId: "p1"
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.unpin",
        entityType: "project_pin"
      })
    );
    expect(result).toEqual({
      projectId: "p1",
      pinned: false
    });
  });

  it("soft deletes project for admin and logs audit", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const deletedAt = new Date("2026-03-29T09:15:00.000Z");

    prisma.project.findFirst.mockResolvedValue({ id: "p1" });
    prisma.project.update.mockResolvedValue({
      id: "p1",
      deletedAt
    });

    const result = await service.deleteProject("p1", {
      userId: "admin-1",
      email: "admin@example.com",
      globalRole: "admin"
    });

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: "p1",
        deletedAt: null
      },
      select: {
        id: true
      }
    });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: {
        id: "p1"
      },
      data: {
        deletedAt: expect.any(Date)
      },
      select: {
        id: true,
        deletedAt: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.delete",
        entityType: "project",
        entityId: "p1"
      })
    );
    expect(result).toEqual({
      id: "p1",
        deletedAt: "2026-03-29T09:15:00.000Z"
    });
    expect(gitlabService.archiveManagedRepository).toHaveBeenCalledWith("p1");
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("p1");
  });

  it.each(["editor", "reader"] as const)("rejects project deletion for %s role", async (role) => {
    const { service } = makeService();

    await expect(
      service.deleteProject("p1", {
        userId: "user-1",
        email: "user@example.com",
        globalRole: role
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns not found when deleting an already deleted or missing project", async () => {
    const { service, prisma } = makeService();

    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteProject("missing-project", {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("restores the project when GitLab archive synchronization fails during deletion", async () => {
    const { service, prisma, gitlabService } = makeService();
    const deletedAt = new Date("2026-03-29T09:15:00.000Z");

    prisma.project.findFirst.mockResolvedValue({ id: "p-restore" });
    prisma.project.update
      .mockResolvedValueOnce({
        id: "p-restore",
        deletedAt
      })
      .mockResolvedValueOnce({
        id: "p-restore",
        deletedAt: null
      });
    gitlabService.archiveManagedRepository.mockRejectedValue(new Error("archive failed"));

    await expect(
      service.deleteProject("p-restore", {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      })
    ).rejects.toThrow("archive failed");

    expect(prisma.project.update).toHaveBeenNthCalledWith(2, {
      where: {
        id: "p-restore"
      },
      data: {
        deletedAt: null
      }
    });
    expect(gitlabService.unarchiveManagedRepository).toHaveBeenCalledWith("p-restore");
  });

  it("lists project members with user identity mapping", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.projectMember.findMany.mockResolvedValue([
      {
        userId: "user-1",
        user: {
          name: "Luis",
          email: "luis@example.com"
        }
      }
    ]);

    await expect(
      service.listMembers("project-1", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual([
      {
        userId: "user-1",
        name: "Luis",
        email: "luis@example.com"
      }
    ]);

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("reader-1", "reader", "project-1");
  });

  it("adds a member by normalized email, logs audit, and syncs repository access", async () => {
    const { service, prisma, accessService, auditService, gitlabService } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: "member-1" });
    prisma.projectMember.upsert.mockResolvedValue({
      projectId: "project-1",
      userId: "member-1"
    });

    await expect(
      service.addMember(
        "project-1",
        {
          email: "Member@Example.com"
        },
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).resolves.toEqual({
      projectId: "project-1",
      userId: "member-1"
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "member@example.com" },
      select: { id: true }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.member.add",
        entityType: "project_member"
      })
    );
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("project-1");
  });

  it("rejects member addition when the target user does not exist", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.addMember(
        "project-1",
        {
          userId: "missing-user"
        },
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
