import { ForbiddenException } from "@nestjs/common";

import { ProjectAccessService } from "./project-access.service";

describe("ProjectAccessService", () => {
  it("blocks reader from writable operations", async () => {
    const prisma: any = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "p1" })
      },
      projectMember: {
        findUnique: jest.fn().mockResolvedValue({ id: "m1" })
      }
    };

    const service = new ProjectAccessService(prisma);

    await expect(service.ensureProjectWritable("u1", "reader", "p1")).rejects.toBeInstanceOf(ForbiddenException);
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
});
