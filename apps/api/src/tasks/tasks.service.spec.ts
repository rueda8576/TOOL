import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TaskPriority, TaskStatus } from "@prisma/client";

import { TasksService } from "./tasks.service";

describe("TasksService", () => {
  const makeService = (): {
    service: TasksService;
    prisma: any;
    accessService: any;
    queueService: any;
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
      queueService,
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

  it("creates a task, maps enums, queues assignee notification, and writes audit log", async () => {
    const { service, prisma, accessService, queueService, auditService } = makeService();
    prisma.projectMember.findUnique.mockResolvedValue({ userId: "user-2" });
    prisma.task.create.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task title",
      status: TaskStatus.BLOCKED,
      priority: TaskPriority.HIGH,
      parentTaskId: null
    });
    prisma.notificationEvent.create.mockResolvedValue({ id: "event-1" });

    const result = await service.createTask(
      "project-1",
      {
        title: "Task title",
        description: "Task description",
        status: "blocked",
        priority: "high",
        assigneeId: "user-2",
        startDate: "2026-04-06T09:00:00.000Z",
        dueDate: "2026-04-08T18:00:00.000Z"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Task title",
          description: "Task description",
          status: TaskStatus.BLOCKED,
          priority: TaskPriority.HIGH,
          assigneeId: "user-2",
          startDate: new Date("2026-04-06T09:00:00.000Z"),
          dueDate: new Date("2026-04-08T18:00:00.000Z"),
          createdById: "user-1"
        })
      })
    );
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: {
        userId: "user-2",
        type: "TASK_ASSIGNED",
        status: "PENDING",
        payload: {
          taskId: "task-1"
        }
      }
    });
    expect(queueService.enqueueEmail).toHaveBeenCalledWith({ notificationEventId: "event-1" });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "task.create",
        taskId: "task-1"
      })
    );
    expect(result).toEqual({
      id: "task-1",
      projectId: "project-1",
      title: "Task title",
      status: TaskStatus.BLOCKED,
      priority: TaskPriority.HIGH,
      parentTaskId: null
    });
  });

  it("creates a subtask under the parent task and queues assignee notification", async () => {
    const { service, prisma, queueService, auditService } = makeService();
    prisma.task.findFirst.mockResolvedValue({
      id: "task-parent",
      projectId: "project-1"
    });
    prisma.projectMember.findUnique.mockResolvedValue({ userId: "user-2" });
    prisma.task.create.mockResolvedValue({
      id: "task-sub",
      parentTaskId: "task-parent",
      projectId: "project-1",
      title: "Subtask"
    });
    prisma.notificationEvent.create.mockResolvedValue({ id: "event-2" });

    const result = await service.addSubtask(
      "task-parent",
      {
        title: "Subtask",
        description: "Nested work",
        priority: "critical",
        assigneeId: "user-2",
        startDate: "2026-04-07T08:00:00.000Z",
        dueDate: "2026-04-08T08:00:00.000Z"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          parentTaskId: "task-parent",
          title: "Subtask",
          priority: TaskPriority.CRITICAL,
          status: TaskStatus.TODO,
          assigneeId: "user-2"
        })
      })
    );
    expect(queueService.enqueueEmail).toHaveBeenCalledWith({ notificationEventId: "event-2" });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "task.subtask.create",
        metadata: {
          parentTaskId: "task-parent"
        }
      })
    );
    expect(result).toEqual({
      id: "task-sub",
      parentTaskId: "task-parent",
      projectId: "project-1",
      title: "Subtask"
    });
  });

  it("rejects subtask creation when the parent task is missing", async () => {
    const { service, prisma } = makeService();
    prisma.task.findFirst.mockResolvedValue(null);

    await expect(
      service.addSubtask(
        "missing-parent",
        {
          title: "Subtask"
        },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates a dependency between tasks in the same project", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    prisma.task.findFirst
      .mockResolvedValueOnce({
        id: "task-1",
        projectId: "project-1"
      })
      .mockResolvedValueOnce({
        id: "task-2",
        projectId: "project-1"
      });
    prisma.taskDependency.upsert.mockResolvedValue({
      id: "dep-1",
      taskId: "task-1",
      dependsOnTaskId: "task-2"
    });

    const result = await service.addDependency(
      "task-1",
      {
        dependsOnTaskId: "task-2"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(prisma.taskDependency.upsert).toHaveBeenCalledWith({
      where: {
        taskId_dependsOnTaskId: {
          taskId: "task-1",
          dependsOnTaskId: "task-2"
        }
      },
      create: {
        taskId: "task-1",
        dependsOnTaskId: "task-2",
        createdById: "user-1"
      },
      update: {},
      select: {
        id: true,
        taskId: true,
        dependsOnTaskId: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "task.dependency.add" }));
    expect(result).toEqual({
      id: "dep-1",
      taskId: "task-1",
      dependsOnTaskId: "task-2"
    });
  });

  it("updates task fields, remaps enums, and queues a notification for the assignee", async () => {
    const { service, prisma, queueService, auditService } = makeService();
    prisma.task.findFirst.mockResolvedValue({
      id: "task-1",
      projectId: "project-1"
    });
    prisma.projectMember.findUnique.mockResolvedValue({ userId: "user-2" });
    prisma.task.update.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Renamed task",
      status: TaskStatus.DONE,
      priority: TaskPriority.CRITICAL,
      assigneeId: "user-2"
    });
    prisma.notificationEvent.create.mockResolvedValue({ id: "event-3" });

    const result = await service.updateTask(
      "task-1",
      {
        title: "Renamed task",
        description: "Updated description",
        status: "done",
        priority: "critical",
        assigneeId: "user-2",
        startDate: "2026-04-08T09:00:00.000Z",
        dueDate: "2026-04-10T09:00:00.000Z"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        title: "Renamed task",
        description: "Updated description",
        status: TaskStatus.DONE,
        priority: TaskPriority.CRITICAL,
        assigneeId: "user-2",
        startDate: new Date("2026-04-08T09:00:00.000Z"),
        dueDate: new Date("2026-04-10T09:00:00.000Z")
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        priority: true,
        assigneeId: true
      }
    });
    expect(queueService.enqueueEmail).toHaveBeenCalledWith({ notificationEventId: "event-3" });
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "task.update" }));
    expect(result).toEqual({
      id: "task-1",
      projectId: "project-1",
      title: "Renamed task",
      status: TaskStatus.DONE,
      priority: TaskPriority.CRITICAL,
      assigneeId: "user-2"
    });
  });

  it("rejects task update when the task does not exist", async () => {
    const { service, prisma } = makeService();
    prisma.task.findFirst.mockResolvedValue(null);

    await expect(
      service.updateTask(
        "missing-task",
        {
          status: "done"
        },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects task update when the new assignee is outside project membership", async () => {
    const { service, prisma } = makeService();
    prisma.task.findFirst.mockResolvedValue({
      id: "task-1",
      projectId: "project-1"
    });
    prisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(
      service.updateTask(
        "task-1",
        {
          assigneeId: "user-9"
        },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not queue an assignment notification when updateTask leaves the task unassigned", async () => {
    const { service, prisma, queueService } = makeService();
    prisma.task.findFirst.mockResolvedValue({
      id: "task-1",
      projectId: "project-1"
    });
    prisma.task.update.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Still task",
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      assigneeId: null
    });

    await service.updateTask(
      "task-1",
      {
        title: "Still task"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(queueService.enqueueEmail).not.toHaveBeenCalled();
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
