import { BadRequestException, NotFoundException } from "@nestjs/common";

import { MeetingsService } from "./meetings.service";

describe("MeetingsService", () => {
  const makeService = (): {
    service: MeetingsService;
    prisma: any;
    accessService: any;
    auditService: any;
    queueService: any;
  } => {
    const prisma: any = {
      meeting: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      meetingAction: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn()
      },
      meetingAutomationRun: {
        create: jest.fn(),
        update: jest.fn()
      },
      task: {
        findFirst: jest.fn(),
        findMany: jest.fn()
      }
    };

    const accessService: any = {
      ensureProjectReadable: jest.fn(),
      ensureProjectWritable: jest.fn()
    };

    const auditService: any = {
      log: jest.fn()
    };

    const queueService: any = {
      enqueueMeetingAutomation: jest.fn()
    };

    return {
      service: new MeetingsService(prisma, accessService, auditService, queueService),
      prisma,
      accessService,
      auditService,
      queueService
    };
  };

  it("lists meetings with readable access and from/to date filter", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.meeting.findMany.mockResolvedValue([]);

    await service.listMeetings(
      "project-1",
      {
        from: "2026-02-20",
        to: "2026-02-21"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "reader"
      }
    );

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("user-1", "reader", "project-1");
    expect(prisma.meeting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "project-1",
          deletedAt: null,
          scheduledAt: {
            gte: expect.any(Date),
            lte: expect.any(Date)
          }
        },
        orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }]
      })
    );

    const listCall = prisma.meeting.findMany.mock.calls[0][0];
    expect(listCall.where.scheduledAt.gte.toISOString()).toBe("2026-02-20T00:00:00.000Z");
    expect(listCall.where.scheduledAt.lte.toISOString()).toBe("2026-02-21T23:59:59.999Z");
  });

  it("normalizes day-only scheduledAt and returns scheduledDate on create", async () => {
    const { service, prisma, queueService } = makeService();
    const createdAt = new Date("2026-02-22T09:00:00.000Z");
    const updatedAt = new Date("2026-02-22T09:00:00.000Z");

    prisma.meeting.findFirst.mockResolvedValue(null);
    prisma.meeting.create.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1",
      title: "Minutes 2026-02-22",
      scheduledAt: new Date("2026-02-22T12:00:00.000Z"),
      location: null,
      doneMarkdown: "Done",
      toDiscussMarkdown: "To discuss",
      toDoMarkdown: "To do",
      createdAt,
      updatedAt
    });
    prisma.meetingAutomationRun.create.mockResolvedValue({
      id: "run-1",
      status: "QUEUED",
      createdTaskCount: 0,
      createdActionCount: 0,
      errorMessage: null,
      completedAt: null,
      updatedAt
    });
    prisma.meetingAutomationRun.update.mockResolvedValue({
      id: "run-1",
      status: "QUEUED",
      createdTaskCount: 0,
      createdActionCount: 0,
      errorMessage: null,
      completedAt: null,
      updatedAt
    });
    queueService.enqueueMeetingAutomation.mockResolvedValue("run-1");

    const result = await service.createMeeting(
      "project-1",
      {
        title: "Minutes 2026-02-22",
        scheduledAt: "2026-02-22",
        doneMarkdown: "Done",
        toDiscussMarkdown: "To discuss",
        toDoMarkdown: "To do"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    const createCall = prisma.meeting.create.mock.calls[0][0];
    expect(createCall.data.scheduledAt.toISOString()).toBe("2026-02-22T12:00:00.000Z");
    expect(queueService.enqueueMeetingAutomation).toHaveBeenCalledWith({
      runId: "run-1",
      meetingId: "meeting-1"
    });
    expect(result.scheduledDate).toBe("2026-02-22");
    expect(result.scheduledAt).toBe("2026-02-22T12:00:00.000Z");
    expect(result.automation?.status).toBe("queued");
  });

  it("appends completed project tasks to DONE when a previous minute exists", async () => {
    const { service, prisma } = makeService();
    const createdAt = new Date("2026-02-22T09:00:00.000Z");
    const updatedAt = new Date("2026-02-22T09:00:00.000Z");
    prisma.meeting.findFirst.mockResolvedValue({
      scheduledAt: new Date("2026-02-15T12:00:00.000Z")
    });
    prisma.task.findMany.mockResolvedValue([
      {
        title: "Finish protocol",
        completedAt: new Date("2026-02-20T10:00:00.000Z"),
        assignee: { name: "Alice" }
      }
    ]);
    prisma.meeting.create.mockImplementation(async (args: any) => ({
      id: "meeting-1",
      projectId: "project-1",
      title: args.data.title,
      scheduledAt: args.data.scheduledAt,
      location: null,
      doneMarkdown: args.data.doneMarkdown,
      toDiscussMarkdown: null,
      toDoMarkdown: null,
      createdAt,
      updatedAt
    }));

    const result = await service.createMeeting(
      "project-1",
      {
        title: "Minutes 2026-02-22",
        scheduledAt: "2026-02-22",
        doneMarkdown: "- Manual note",
        toDoMarkdown: "- "
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(result.doneMarkdown).toContain("- Manual note");
    expect(result.doneMarkdown).toContain("### Completed tasks since previous minute");
    expect(result.doneMarkdown).toContain("- [x] Finish protocol");
  });

  it("does not queue automation for placeholder-only TO DO markdown", async () => {
    const { service, prisma, queueService } = makeService();
    const createdAt = new Date("2026-02-22T09:00:00.000Z");
    const updatedAt = new Date("2026-02-22T09:00:00.000Z");
    prisma.meeting.findFirst.mockResolvedValue(null);
    prisma.meeting.create.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1",
      title: "Minutes 2026-02-22",
      scheduledAt: new Date("2026-02-22T12:00:00.000Z"),
      location: null,
      doneMarkdown: null,
      toDiscussMarkdown: null,
      toDoMarkdown: null,
      createdAt,
      updatedAt
    });

    await service.createMeeting(
      "project-1",
      {
        title: "Minutes 2026-02-22",
        scheduledAt: "2026-02-22",
        toDoMarkdown: "- "
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(prisma.meetingAutomationRun.create).not.toHaveBeenCalled();
    expect(queueService.enqueueMeetingAutomation).not.toHaveBeenCalled();
  });

  it("updates title/date/location/agenda/notes", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    const createdAt = new Date("2026-02-20T08:00:00.000Z");
    const updatedAt = new Date("2026-02-23T11:00:00.000Z");

    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1"
    });
    prisma.meeting.update.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1",
      title: "Updated minute",
      scheduledAt: new Date("2026-02-25T12:00:00.000Z"),
      location: "Room B",
      doneMarkdown: "Updated done",
      toDiscussMarkdown: "Updated to discuss",
      toDoMarkdown: "Updated to do",
      createdAt,
      updatedAt
    });

    const result = await service.updateMeeting(
      "meeting-1",
      {
        title: "Updated minute",
        scheduledAt: "2026-02-25",
        location: "Room B",
        doneMarkdown: "Updated done",
        toDiscussMarkdown: "Updated to discuss",
        toDoMarkdown: "Updated to do"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(prisma.meeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Updated minute",
          location: "Room B",
          doneMarkdown: "Updated done",
          toDiscussMarkdown: "Updated to discuss",
          toDoMarkdown: "Updated to do",
          scheduledAt: expect.any(Date)
        })
      })
    );
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.update" }));
    expect(result.scheduledDate).toBe("2026-02-25");
  });

  it("normalizes placeholder-only markdown sections to empty on update", async () => {
    const { service, prisma } = makeService();
    const createdAt = new Date("2026-02-20T08:00:00.000Z");
    const updatedAt = new Date("2026-02-23T11:00:00.000Z");

    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1"
    });
    prisma.meeting.update.mockImplementation(async (args: any) => ({
      id: "meeting-1",
      projectId: "project-1",
      title: "Updated minute",
      scheduledAt: new Date("2026-02-25T12:00:00.000Z"),
      location: "Room B",
      doneMarkdown: args.data.doneMarkdown,
      toDiscussMarkdown: args.data.toDiscussMarkdown,
      toDoMarkdown: args.data.toDoMarkdown,
      createdAt,
      updatedAt
    }));

    const result = await service.updateMeeting(
      "meeting-1",
      {
        doneMarkdown: "- ",
        toDiscussMarkdown: "1. ",
        toDoMarkdown: "- [ ] "
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(prisma.meeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          doneMarkdown: null,
          toDiscussMarkdown: null,
          toDoMarkdown: null
        })
      })
    );
    expect(result.doneMarkdown).toBeNull();
    expect(result.toDiscussMarkdown).toBeNull();
    expect(result.toDoMarkdown).toBeNull();
  });

  it("queues a new automation run when retrying a failed run", async () => {
    const { service, prisma, queueService, auditService } = makeService();
    const createdAt = new Date("2026-02-20T08:00:00.000Z");
    const updatedAt = new Date("2026-02-23T11:00:00.000Z");

    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1",
      title: "Minutes 2026-02-20",
      scheduledAt: new Date("2026-02-20T12:00:00.000Z"),
      location: null,
      doneMarkdown: null,
      toDiscussMarkdown: null,
      toDoMarkdown: "- Prepare protocol",
      createdAt,
      updatedAt,
      automationRuns: [
        {
          id: "failed-run",
          status: "FAILED",
          createdTaskCount: 0,
          createdActionCount: 0,
          errorMessage: "OpenAI failed",
          completedAt: new Date("2026-02-20T12:05:00.000Z"),
          updatedAt
        }
      ]
    });
    prisma.meetingAutomationRun.create.mockResolvedValue({
      id: "run-2",
      status: "QUEUED",
      createdTaskCount: 0,
      createdActionCount: 0,
      errorMessage: null,
      completedAt: null,
      updatedAt
    });
    prisma.meetingAutomationRun.update.mockResolvedValue({
      id: "run-2",
      status: "QUEUED",
      createdTaskCount: 0,
      createdActionCount: 0,
      errorMessage: null,
      completedAt: null,
      updatedAt
    });
    queueService.enqueueMeetingAutomation.mockResolvedValue("run-2");

    const result = await service.retryAutomation("meeting-1", {
      userId: "user-1",
      email: "user-1@example.com",
      globalRole: "editor"
    });

    expect(queueService.enqueueMeetingAutomation).toHaveBeenCalledWith({
      runId: "run-2",
      meetingId: "meeting-1"
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "meeting.ai.extract_queued",
        metadata: expect.objectContaining({
          retriedRunId: "failed-run"
        })
      })
    );
    expect(result.automation?.status).toBe("queued");
  });

  it("rejects automation retry when there is no failed or stale run", async () => {
    const { service, prisma, queueService } = makeService();
    const createdAt = new Date("2026-02-20T08:00:00.000Z");
    const updatedAt = new Date("2026-02-23T11:00:00.000Z");

    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1",
      title: "Minutes 2026-02-20",
      scheduledAt: new Date("2026-02-20T12:00:00.000Z"),
      location: null,
      doneMarkdown: null,
      toDiscussMarkdown: null,
      toDoMarkdown: "- Prepare protocol",
      createdAt,
      updatedAt,
      automationRuns: []
    });

    await expect(
      service.retryAutomation("meeting-1", {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      })
    ).rejects.toThrow("No failed or stale automation run to retry");

    expect(queueService.enqueueMeetingAutomation).not.toHaveBeenCalled();
  });

  it("soft deletes meeting and writes audit log", async () => {
    const { service, prisma, auditService } = makeService();
    const deletedAt = new Date("2026-02-22T12:00:00.000Z");
    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1"
    });
    prisma.meeting.update.mockResolvedValue({
      id: "meeting-1",
      deletedAt
    });

    const result = await service.deleteMeeting("meeting-1", {
      userId: "user-1",
      email: "user-1@example.com",
      globalRole: "editor"
    });

    expect(result).toEqual({
      id: "meeting-1",
      deletedAt: deletedAt.toISOString()
    });
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.delete" }));
  });

  it("rejects link action when the parent meeting is soft-deleted", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.meetingAction.findFirst.mockResolvedValue({
      id: "action-1",
      meetingId: "meeting-1",
      meeting: {
        projectId: "project-1",
        deletedAt: new Date("2026-02-20T10:00:00.000Z")
      }
    });

    await expect(
      service.linkActionToTask(
        "meeting-1",
        "action-1",
        { taskId: "task-1" },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(accessService.ensureProjectWritable).not.toHaveBeenCalled();
  });

  it("creates a meeting action linked to an existing task in the same project", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1"
    });
    prisma.task.findFirst.mockResolvedValue({ id: "task-1" });
    prisma.meetingAction.create.mockResolvedValue({
      id: "action-1",
      meetingId: "meeting-1",
      title: "Write follow-up",
      linkedTaskId: "task-1"
    });

    const result = await service.createAction(
      "meeting-1",
      {
        title: "Write follow-up",
        description: "Capture final action",
        linkedTaskId: "task-1",
        dueDate: "2026-02-28T10:00:00.000Z"
      },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(prisma.meetingAction.create).toHaveBeenCalledWith({
      data: {
        meetingId: "meeting-1",
        title: "Write follow-up",
        description: "Capture final action",
        ownerId: undefined,
        dueDate: new Date("2026-02-28T10:00:00.000Z"),
        linkedTaskId: "task-1"
      },
      select: {
        id: true,
        meetingId: true,
        title: true,
        linkedTaskId: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "meeting.action.create",
        metadata: {
          meetingId: "meeting-1"
        }
      })
    );
    expect(result).toEqual({
      id: "action-1",
      meetingId: "meeting-1",
      title: "Write follow-up",
      linkedTaskId: "task-1"
    });
  });

  it("rejects action creation when the linked task is outside the meeting project", async () => {
    const { service, prisma } = makeService();
    prisma.meeting.findFirst.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1"
    });
    prisma.task.findFirst.mockResolvedValue(null);

    await expect(
      service.createAction(
        "meeting-1",
        {
          title: "Write follow-up",
          linkedTaskId: "missing-task"
        },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("links an existing meeting action to a task in the same project", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    prisma.meetingAction.findFirst.mockResolvedValue({
      id: "action-1",
      meetingId: "meeting-1",
      meeting: {
        projectId: "project-1",
        deletedAt: null
      }
    });
    prisma.task.findFirst.mockResolvedValue({ id: "task-1" });
    prisma.meetingAction.update.mockResolvedValue({});

    const result = await service.linkActionToTask(
      "meeting-1",
      "action-1",
      { taskId: "task-1" },
      {
        userId: "user-1",
        email: "user-1@example.com",
        globalRole: "editor"
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", "editor", "project-1");
    expect(prisma.meetingAction.update).toHaveBeenCalledWith({
      where: {
        id: "action-1"
      },
      data: {
        linkedTaskId: "task-1"
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "meeting.action.link_task",
        metadata: { taskId: "task-1" }
      })
    );
    expect(result).toEqual({
      actionId: "action-1",
      linkedTaskId: "task-1"
    });
  });

  it("rejects link action when the action does not exist", async () => {
    const { service, prisma } = makeService();
    prisma.meetingAction.findFirst.mockResolvedValue(null);

    await expect(
      service.linkActionToTask(
        "meeting-1",
        "missing-action",
        { taskId: "task-1" },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects link action when the task belongs to another project or is missing", async () => {
    const { service, prisma } = makeService();
    prisma.meetingAction.findFirst.mockResolvedValue({
      id: "action-1",
      meetingId: "meeting-1",
      meeting: {
        projectId: "project-1",
        deletedAt: null
      }
    });
    prisma.task.findFirst.mockResolvedValue(null);

    await expect(
      service.linkActionToTask(
        "meeting-1",
        "action-1",
        { taskId: "task-2" },
        {
          userId: "user-1",
          email: "user-1@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
