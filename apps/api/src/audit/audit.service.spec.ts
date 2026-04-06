import { AuditService } from "./audit.service";

describe("AuditService", () => {
  it("writes audit logs without metadata", async () => {
    const prisma: any = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    };
    const service = new AuditService(prisma);

    await service.log({
      userId: "user-1",
      entityType: "project",
      entityId: "project-1",
      action: "project.create"
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        projectId: undefined,
        taskId: undefined,
        entityType: "project",
        entityId: "project-1",
        action: "project.create",
        metadata: undefined
      }
    });
  });

  it("passes JSON metadata through to Prisma", async () => {
    const prisma: any = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined)
      }
    };
    const service = new AuditService(prisma);

    await service.log({
      entityType: "project_repository",
      entityId: "repo-1",
      action: "project.repository.provision",
      metadata: {
        gitlabProjectId: "123",
        pathWithNamespace: "atlasium/nav"
      }
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          gitlabProjectId: "123",
          pathWithNamespace: "atlasium/nav"
        }
      })
    });
  });
});
