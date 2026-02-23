import { BadRequestException } from "@nestjs/common";
import { TaskPriority, TaskStatus } from "@prisma/client";

import { TasksService } from "./tasks.service";

describe("TasksService", () => {
  const makeService = (): {
    service: TasksService;
    prisma: any;
    accessService: any;
    auditService: any;
  } => {
    const prisma: any = {
      task: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      taskDependency: {
        upsert: jest.fn(),
        findFirst: jest.fn()
      },
      notificationEvent: {
        create: jest.fn()
      },
      projectMember: {
        findUnique: jest.fn()
      }
    };

    const accessService: any = {
      ensureProjectWritable: jest.fn(),
      ensureProjectReadable: jest.fn()
    };

    const queueService: any = {
      enqueueEmail: jest.fn()
    };

    const auditService: any = {
      log: jest.fn()
    };

    return {
      service: new TasksService(prisma, accessService, queueService, auditService),
      prisma,
      accessService,
      auditService
    };
  };

  it("rejects self dependency", async () => {
    const { service } = makeService();

    await expect(
      service.addDependency(
        "task-id",
        {
          dependsOnTaskId: "task-id"
        },
        {
          userId: "u1",
          email: "u1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("lists root tasks by default and maps enum/date fields", async () => {
    const { service, prisma, accessService } = makeService();
    const createdAt = new Date("2026-02-20T10:00:00.000Z");
    const updatedAt = new Date("2026-02-20T12:00:00.000Z");
    const startDate = new Date("2026-02-22T09:30:00.000Z");

    prisma.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        projectId: "project-1",
        title: "Root task",
        description: "Description",
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.CRITICAL,
        assigneeId: "user-2",
        assignee: {
          id: "user-2",
          name: "Alice",
          email: "alice@example.com"
        },
        startDate,
        dueDate: null,
        parentTaskId: null,
        createdAt,
        updatedAt
      }
    ]);

    const result = await service.listTasks(
      "project-1",
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "reader"
      }
    );

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("user-1", "reader", "project-1");
    expect(accessService.ensureProjectWritable).not.toHaveBeenCalled();
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          deletedAt: null,
          parentTaskId: null
        }),
        orderBy: { createdAt: "desc" }
      })
    );
    expect(result).toEqual([
      {
        id: "task-1",
        projectId: "project-1",
        title: "Root task",
        description: "Description",
        status: "in_progress",
        priority: "critical",
        assigneeId: "user-2",
        assignee: {
          id: "user-2",
          name: "Alice",
          email: "alice@example.com"
        },
        startDate: startDate.toISOString(),
        dueDate: null,
        parentTaskId: null,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString()
      }
    ]);
  });

  it("includes subtasks when includeSubtasks=true", async () => {
    const { service, prisma } = makeService();
    prisma.task.findMany.mockResolvedValue([]);

    await service.listTasks(
      "project-1",
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      },
      true
    );

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          deletedAt: null
        }
      })
    );
  });

  it("rejects assignee outside project membership", async () => {
    const { service, prisma } = makeService();
    prisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(
      service.createTask(
        "project-1",
        {
          title: "Task",
          assigneeId: "user-2"
        },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("blocks deletion when active subtasks exist", async () => {
    const { service, prisma } = makeService();
    prisma.task.findFirst
      .mockResolvedValueOnce({
        id: "task-1",
        projectId: "project-1"
      })
      .mockResolvedValueOnce({
        id: "task-2"
      });

    await expect(
      service.deleteTask("task-1", {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("blocks deletion when active dependencies exist", async () => {
    const { service, prisma } = makeService();
    prisma.task.findFirst
      .mockResolvedValueOnce({
        id: "task-1",
        projectId: "project-1"
      })
      .mockResolvedValueOnce(null);
    prisma.taskDependency.findFirst.mockResolvedValue({
      id: "dep-1"
    });

    await expect(
      service.deleteTask("task-1", {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("soft deletes task when no blockers exist", async () => {
    const { service, prisma, auditService } = makeService();
    const deletedAt = new Date("2026-02-22T12:00:00.000Z");

    prisma.task.findFirst
      .mockResolvedValueOnce({
        id: "task-1",
        projectId: "project-1"
      })
      .mockResolvedValueOnce(null);
    prisma.taskDependency.findFirst.mockResolvedValue(null);
    prisma.task.update.mockResolvedValue({
      id: "task-1",
      deletedAt
    });

    const result = await service.deleteTask("task-1", {
      userId: "user-1",
      email: "user-1@example.com",
      globalRole: "editor"
    });

    expect(result).toEqual({
      id: "task-1",
      deletedAt: deletedAt.toISOString()
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "task.delete",
        taskId: "task-1"
      })
    );
  });
});
