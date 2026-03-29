import { ForbiddenException, NotFoundException } from "@nestjs/common";

import { ProjectsService } from "./projects.service";

describe("ProjectsService", () => {
  const makeService = (): {
    service: ProjectsService;
    prisma: any;
    accessService: any;
    auditService: any;
  } => {
    const prisma: any = {
      project: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn()
      },
      projectMember: {
        findMany: jest.fn(),
        upsert: jest.fn()
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
      ensureProjectReadable: jest.fn(),
      ensureProjectWritable: jest.fn()
    };

    const auditService: any = {
      log: jest.fn()
    };

    return {
      service: new ProjectsService(prisma, accessService, auditService),
      prisma,
      accessService,
      auditService
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
    const { service, prisma, auditService } = makeService();

    prisma.project.findUnique.mockResolvedValue(null);
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
          createdById: "admin-1"
        })
      })
    );
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
    const { service, prisma, auditService } = makeService();
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
});
