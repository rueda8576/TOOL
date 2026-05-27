import { createHash } from "crypto";

import { MeetingAutomationStatus, TaskPriority, TaskStatus } from "@prisma/client";

const responsesCreate = jest.fn();

const makeInputHash = (meeting: { id: string; updatedAt: Date; toDoMarkdown: string | null }): string =>
  createHash("sha256")
    .update(`${meeting.id}:${meeting.updatedAt.toISOString()}:${meeting.toDoMarkdown ?? ""}`)
    .digest("hex");

describe("processMeetingAutomationJob", () => {
  const loadJob = async (envOverrides: Record<string, unknown> = {}) => {
    jest.resetModules();
    responsesCreate.mockReset();

    const openAiConstructor = jest.fn().mockImplementation(() => ({
      responses: {
        create: responsesCreate
      }
    }));

    jest.doMock("openai", () => ({
      __esModule: true,
      default: openAiConstructor
    }));
    jest.doMock("../config/env", () => ({
      getEnv: () => ({
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-test",
        OPENAI_BASE_URL: undefined,
        OPENAI_TIMEOUT_MS: 45000,
        AI_MAX_INPUT_CHARS: 50000,
        AI_MEETING_AUTOMATION_ENABLED: true,
        ...envOverrides
      })
    }));

    const jobModule = await import("./meeting-automation.job");
    return {
      ...jobModule,
      openAiConstructor
    };
  };

  const makePrisma = (params: {
    run: Record<string, unknown> | null;
    meeting: Record<string, unknown> | null;
    members?: Array<Record<string, unknown>>;
    existingAction?: Record<string, unknown> | null;
  }) => {
    const tx = {
      task: {
        create: jest.fn().mockResolvedValue({ id: "task-1" })
      },
      meetingAction: {
        create: jest.fn().mockResolvedValue({ id: "action-1" })
      },
      notificationEvent: {
        create: jest.fn().mockResolvedValue({ id: "event-1" })
      },
      auditLog: {
        createMany: jest.fn().mockResolvedValue({ count: 2 })
      }
    };

    const prisma = {
      meetingAutomationRun: {
        findUnique: jest.fn().mockResolvedValue(params.run),
        update: jest.fn().mockResolvedValue(undefined)
      },
      meeting: {
        findFirst: jest.fn().mockResolvedValue(params.meeting)
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue(params.members ?? [])
      },
      meetingAction: {
        findUnique: jest.fn().mockResolvedValue(params.existingAction ?? null)
      },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
    };

    return {
      prisma,
      tx
    };
  };

  const makeMeeting = (overrides: Record<string, unknown> = {}) => ({
    id: "meeting-1",
    projectId: "project-1",
    createdById: "creator-1",
    updatedAt: new Date("2026-05-20T10:00:00.000Z"),
    toDoMarkdown: "- Prepare protocol",
    ...overrides
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("creates linked tasks and meeting actions from validated OpenAI output once", async () => {
    const { processMeetingAutomationJob, openAiConstructor } = await loadJob();
    const meeting = {
      id: "meeting-1",
      projectId: "project-1",
      createdById: "creator-1",
      updatedAt: new Date("2026-05-20T10:00:00.000Z"),
      toDoMarkdown: "- Alice prepares the protocol by 2026-06-01"
    };
    const inputHash = makeInputHash(meeting);
    const { prisma, tx } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash,
        requestedById: "requester-1",
        startedAt: null
      },
      meeting,
      members: [
        {
          userId: "user-2",
          user: {
            name: "Alice",
            email: "alice@example.com"
          }
        }
      ]
    });
    const emailQueue = {
      add: jest.fn().mockResolvedValue(undefined)
    };
    responsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        tasks: [
          {
            sourceText: "- Alice prepares the protocol by 2026-06-01",
            title: "Prepare the protocol",
            description: "Prepare the protocol discussed in the meeting.",
            assigneeEmail: "alice@example.com",
            assigneeName: "",
            dueDate: "2026-06-01",
            priority: "high"
          }
        ]
      })
    });

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "run-1", meetingId: "meeting-1" }
    } as never);

    expect(openAiConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        timeout: 45000
      })
    );
    expect(responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test",
        store: false,
        text: expect.objectContaining({
          format: expect.objectContaining({
            type: "json_schema",
            strict: true
          })
        })
      })
    );
    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        title: "Prepare the protocol",
        status: TaskStatus.TODO,
        priority: TaskPriority.HIGH,
        assigneeId: "user-2",
        dueDate: new Date("2026-06-01T12:00:00.000Z"),
        createdById: "requester-1"
      }),
      select: {
        id: true
      }
    });
    expect(tx.meetingAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        meetingId: "meeting-1",
        title: "Prepare the protocol",
        ownerId: "user-2",
        linkedTaskId: "task-1",
        automationRunId: "run-1",
        aiSourceText: "- Alice prepares the protocol by 2026-06-01"
      }),
      select: {
        id: true
      }
    });
    expect(emailQueue.add).toHaveBeenCalledWith(
      "send-email",
      { notificationEventId: "event-1" },
      {
        attempts: 5,
        removeOnComplete: 500,
        removeOnFail: 500
      }
    );
    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.COMPLETED,
        createdTaskCount: 1,
        createdActionCount: 1,
        errorMessage: null,
        completedAt: expect.any(Date)
      })
    });
  });

  it("returns without work when the automation run no longer exists", async () => {
    const { processMeetingAutomationJob } = await loadJob();
    const { prisma } = makePrisma({
      run: null,
      meeting: null
    });
    const emailQueue = {
      add: jest.fn()
    };

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "missing-run", meetingId: "meeting-1" }
    } as never);

    expect(prisma.meetingAutomationRun.update).not.toHaveBeenCalled();
    expect(prisma.meeting.findFirst).not.toHaveBeenCalled();
    expect(responsesCreate).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  it("marks runs failed when meeting automation is disabled", async () => {
    const { processMeetingAutomationJob } = await loadJob({
      AI_MEETING_AUTOMATION_ENABLED: false
    });
    const meeting = makeMeeting();
    const { prisma } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash: makeInputHash(meeting),
        requestedById: null,
        startedAt: null
      },
      meeting
    });
    const emailQueue = {
      add: jest.fn()
    };

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "run-1", meetingId: "meeting-1" }
    } as never);

    expect(prisma.meeting.findFirst).not.toHaveBeenCalled();
    expect(responsesCreate).not.toHaveBeenCalled();
    expect(prisma.meetingAutomationRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.FAILED,
        errorMessage: "Meeting AI automation is disabled",
        completedAt: expect.any(Date)
      })
    });
  });

  it.each([MeetingAutomationStatus.COMPLETED, MeetingAutomationStatus.STALE])(
    "returns without work when the run is already %s",
    async (status) => {
      const { processMeetingAutomationJob } = await loadJob();
      const meeting = makeMeeting();
      const { prisma } = makePrisma({
        run: {
          id: "run-1",
          status,
          inputHash: makeInputHash(meeting),
          requestedById: null,
          startedAt: null
        },
        meeting
      });
      const emailQueue = {
        add: jest.fn()
      };

      await processMeetingAutomationJob(prisma as never, emailQueue as never, {
        data: { runId: "run-1", meetingId: "meeting-1" }
      } as never);

      expect(prisma.meetingAutomationRun.update).not.toHaveBeenCalled();
      expect(prisma.meeting.findFirst).not.toHaveBeenCalled();
      expect(responsesCreate).not.toHaveBeenCalled();
      expect(emailQueue.add).not.toHaveBeenCalled();
    }
  );

  it("marks runs stale when the meeting was deleted before processing", async () => {
    const { processMeetingAutomationJob } = await loadJob();
    const meeting = makeMeeting();
    const { prisma } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash: makeInputHash(meeting),
        requestedById: null,
        startedAt: null
      },
      meeting: null
    });
    const emailQueue = {
      add: jest.fn()
    };

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "run-1", meetingId: "meeting-1" }
    } as never);

    expect(responsesCreate).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.STALE,
        errorMessage: "Meeting no longer exists",
        completedAt: expect.any(Date)
      })
    });
  });

  it.each([
    ["null", null],
    ["placeholder", "- [ ] "]
  ])("marks runs completed with zero counts for %s TO DO markdown", async (_label, toDoMarkdown) => {
    const { processMeetingAutomationJob } = await loadJob();
    const meeting = makeMeeting({ toDoMarkdown });
    const { prisma } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash: makeInputHash(meeting),
        requestedById: null,
        startedAt: null
      },
      meeting
    });
    const emailQueue = {
      add: jest.fn()
    };

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "run-1", meetingId: "meeting-1" }
    } as never);

    expect(responsesCreate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.COMPLETED,
        createdTaskCount: 0,
        createdActionCount: 0,
        completedAt: expect.any(Date)
      })
    });
  });

  it("marks runs failed and rethrows when the OpenAI key is missing", async () => {
    const { processMeetingAutomationJob, openAiConstructor } = await loadJob({
      OPENAI_API_KEY: ""
    });
    const meeting = makeMeeting();
    const { prisma } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash: makeInputHash(meeting),
        requestedById: null,
        startedAt: null
      },
      meeting
    });
    const emailQueue = {
      add: jest.fn()
    };

    await expect(
      processMeetingAutomationJob(prisma as never, emailQueue as never, {
        data: { runId: "run-1", meetingId: "meeting-1" }
      } as never)
    ).rejects.toThrow("OPENAI_API_KEY is required for meeting automation");

    expect(openAiConstructor).not.toHaveBeenCalled();
    expect(responsesCreate).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.FAILED,
        errorMessage: "OPENAI_API_KEY is required for meeting automation",
        completedAt: expect.any(Date)
      })
    });
  });

  it("marks malformed OpenAI output as failed and lets BullMQ retry", async () => {
    const { processMeetingAutomationJob } = await loadJob();
    const meeting = {
      id: "meeting-1",
      projectId: "project-1",
      createdById: "creator-1",
      updatedAt: new Date("2026-05-20T10:00:00.000Z"),
      toDoMarkdown: "- Prepare protocol"
    };
    const { prisma } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash: makeInputHash(meeting),
        requestedById: null,
        startedAt: null
      },
      meeting
    });
    const emailQueue = {
      add: jest.fn()
    };
    responsesCreate.mockResolvedValue({
      output_text: "not-json"
    });

    await expect(
      processMeetingAutomationJob(prisma as never, emailQueue as never, {
        data: { runId: "run-1", meetingId: "meeting-1" }
      } as never)
    ).rejects.toThrow();

    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.FAILED,
        errorMessage: expect.any(String),
        completedAt: expect.any(Date)
      })
    });
    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  it("creates unassigned and name-assigned tasks with validation fallbacks", async () => {
    const { processMeetingAutomationJob } = await loadJob();
    const meeting = makeMeeting({
      toDoMarkdown: "- Unassigned low task\n- Bob owns critical task\n- Medium task"
    });
    const { prisma, tx } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash: makeInputHash(meeting),
        requestedById: null,
        startedAt: new Date("2026-05-20T10:01:00.000Z")
      },
      meeting,
      members: [
        {
          userId: "user-3",
          user: {
            name: "Bob",
            email: "bob@example.com"
          }
        }
      ]
    });
    const emailQueue = {
      add: jest.fn().mockResolvedValue(undefined)
    };
    responsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        tasks: [
          {
            sourceText: "",
            title: "Unassigned low task",
            description: "",
            assigneeEmail: "nobody@example.com",
            assigneeName: "",
            dueDate: "not-a-date",
            priority: "low"
          },
          {
            sourceText: "Bob owns critical task",
            title: "Bob owns critical task",
            description: "Critical description",
            assigneeEmail: "",
            assigneeName: "Bob",
            dueDate: "2026-02-31",
            priority: "critical"
          },
          {
            sourceText: "Medium task",
            title: "Medium task",
            description: "",
            assigneeEmail: "",
            assigneeName: "",
            dueDate: "",
            priority: "medium"
          }
        ]
      })
    });

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "run-1", meetingId: "meeting-1" }
    } as never);

    expect(tx.task.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        title: "Unassigned low task",
        description: null,
        priority: TaskPriority.LOW,
        assigneeId: null,
        dueDate: null,
        createdById: "creator-1"
      }),
      select: { id: true }
    });
    expect(tx.meetingAction.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        title: "Unassigned low task",
        description: null,
        ownerId: null,
        aiSourceText: "Unassigned low task"
      }),
      select: { id: true }
    });
    expect(tx.task.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        title: "Bob owns critical task",
        description: "Critical description",
        priority: TaskPriority.CRITICAL,
        assigneeId: "user-3",
        dueDate: null,
        createdById: "creator-1"
      }),
      select: { id: true }
    });
    expect(tx.task.create).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({
        title: "Medium task",
        priority: TaskPriority.MEDIUM,
        assigneeId: null,
        dueDate: null
      }),
      select: { id: true }
    });
    expect(tx.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.COMPLETED,
        createdTaskCount: 3,
        createdActionCount: 3
      })
    });
  });

  it("trims parsed OpenAI task fields, truncates long titles, and drops blank titles", async () => {
    const { __private__ } = await loadJob();
    const boundedSource = ` ${"s".repeat(998)} `;
    const longTitle = ` ${"t".repeat(250)} `;
    const boundedDescription = ` ${"d".repeat(4_998)} `;

    const parsed = __private__.parseOpenAiTasks(
      JSON.stringify({
        tasks: [
          {
            sourceText: boundedSource,
            title: longTitle,
            description: boundedDescription,
            assigneeEmail: " ALICE@EXAMPLE.COM ",
            assigneeName: " Alice ",
            dueDate: "2026-06-01",
            priority: "medium"
          },
          {
            sourceText: "blank title source",
            title: "   ",
            description: "",
            assigneeEmail: "",
            assigneeName: "",
            dueDate: "",
            priority: "medium"
          }
        ]
      })
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].sourceText).toHaveLength(998);
    expect(parsed[0].title).toHaveLength(200);
    expect(parsed[0].description).toHaveLength(4_998);
    expect(parsed[0].assigneeEmail).toBe("alice@example.com");
    expect(parsed[0].assigneeName).toBe("Alice");
    expect(parsed[0].dueDate).toBe("2026-06-01");
  });

  it("skips duplicate extracted items on retry by source hash", async () => {
    const { processMeetingAutomationJob } = await loadJob();
    const meeting = {
      id: "meeting-1",
      projectId: "project-1",
      createdById: "creator-1",
      updatedAt: new Date("2026-05-20T10:00:00.000Z"),
      toDoMarkdown: "- Prepare protocol"
    };
    const { prisma, tx } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.FAILED,
        inputHash: makeInputHash(meeting),
        requestedById: null,
        startedAt: null
      },
      meeting,
      existingAction: {
        id: "existing-action"
      }
    });
    const emailQueue = {
      add: jest.fn()
    };
    responsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        tasks: [
          {
            sourceText: "- Prepare protocol",
            title: "Prepare protocol",
            description: "",
            assigneeEmail: "",
            assigneeName: "",
            dueDate: "",
            priority: "medium"
          }
        ]
      })
    });

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "run-1", meetingId: "meeting-1" }
    } as never);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.COMPLETED,
        createdTaskCount: 0,
        createdActionCount: 0
      })
    });
  });

  it("marks stale runs when the meeting TO DO changed after queueing", async () => {
    const { processMeetingAutomationJob } = await loadJob();
    const meeting = {
      id: "meeting-1",
      projectId: "project-1",
      createdById: "creator-1",
      updatedAt: new Date("2026-05-20T10:00:00.000Z"),
      toDoMarkdown: "- Current task"
    };
    const { prisma } = makePrisma({
      run: {
        id: "run-1",
        status: MeetingAutomationStatus.QUEUED,
        inputHash: "old-input-hash",
        requestedById: null,
        startedAt: null
      },
      meeting
    });
    const emailQueue = {
      add: jest.fn()
    };

    await processMeetingAutomationJob(prisma as never, emailQueue as never, {
      data: { runId: "run-1", meetingId: "meeting-1" }
    } as never);

    expect(responsesCreate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.meetingAutomationRun.update).toHaveBeenLastCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: MeetingAutomationStatus.STALE,
        errorMessage: "Meeting TO DO changed after automation was queued",
        completedAt: expect.any(Date)
      })
    });
  });
});
