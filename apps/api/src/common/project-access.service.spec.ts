import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProjectRole } from "@prisma/client";

import { ProjectAccessService } from "./project-access.service";

describe("ProjectAccessService", () => {
  it("blocks non-admin users from writable operations when their project role is reader", async () => {
    const prisma: any = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "p1" })
      },
      projectMember: {
        findUnique: jest.fn().mockResolvedValue({ role: ProjectRole.READER })
      }
    };

    const service = new ProjectAccessService(prisma);

    await expect(service.ensureProjectWritable("u1", "reader", "p1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows writable access when the membership role is editor", async () => {
    const prisma: any = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "p1" })
      },
      projectMember: {
        findUnique: jest.fn().mockResolvedValue({ role: ProjectRole.EDITOR })
      }
    };

    const service = new ProjectAccessService(prisma);

    await expect(service.ensureProjectWritable("u1", "reader", "p1")).resolves.toBeUndefined();
  });

  it("allows admin readable access without membership lookup", async () => {
    const prisma: any = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "p1" })
      },
      projectMember: {
        findUnique: jest.fn()
      }
    };

    const service = new ProjectAccessService(prisma);
    await expect(service.ensureProjectReadable("u1", "admin", "p1")).resolves.toBeUndefined();
    expect(prisma.projectMember.findUnique).not.toHaveBeenCalled();
  });

  it("returns access context for non-admin project members", async () => {
    const prisma: any = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "p1" })
      },
      projectMember: {
        findUnique: jest.fn().mockResolvedValue({ role: ProjectRole.EDITOR })
      }
    };

    const service = new ProjectAccessService(prisma);

    await expect(service.getProjectAccess("u1", "reader", "p1")).resolves.toEqual({
      isAdmin: false,
      projectRole: "editor",
      canWrite: true
    });
  });

  it("treats soft-deleted projects as not found", async () => {
    const prisma: any = {
      project: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      projectMember: {
        findUnique: jest.fn()
      }
    };

    const service = new ProjectAccessService(prisma);

    await expect(service.ensureProjectReadable("u1", "admin", "p1")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: "p1",
        deletedAt: null
      },
      select: { id: true }
    });
  });
});
