import { createHash } from "crypto";

import {
  MeetingAutomationStatus,
  NotificationEventType,
  NotificationStatus,
  PrismaClient,
  TaskPriority,
  TaskStatus
} from "@prisma/client";
import type { Job, Queue } from "bullmq";
import OpenAI from "openai";
import { z } from "zod";

import { getEnv } from "../config/env";

type MeetingAutomationJobPayload = {
  runId: string;
  meetingId: string;
};

const ExtractedTaskSchema = z.object({
  sourceText: z.string().max(1_000).default(""),
  title: z.string().min(1).max(300),
  description: z.string().max(5_000).default(""),
  assigneeEmail: z.string().max(320).default(""),
  assigneeName: z.string().max(300).default(""),
  dueDate: z.string().max(10).default(""),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium")
});

const ExtractedTasksResponseSchema = z.object({
  tasks: z.array(ExtractedTaskSchema).max(50)
});

type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;

const OPENAI_TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceText", "title", "description", "assigneeEmail", "assigneeName", "dueDate", "priority"],
        properties: {
          sourceText: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          assigneeEmail: { type: "string" },
          assigneeName: { type: "string" },
          dueDate: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] }
        }
      }
    }
  }
} as const;

function hasMeaningfulMarkdown(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  return value
    .split("\n")
    .some((line) => {
      const withoutMarker = line
        .replace(/^\s*[-+*]\s*(?:\[(?: |x|X)\]\s*)?/, "")
        .replace(/^\s*\d+\.\s*/, "")
        .trim();
      return withoutMarker.length > 0;
    });
}

function hashMeetingAutomationInput(meeting: { id: string; updatedAt: Date; toDoMarkdown: string | null }): string {
  return createHash("sha256")
    .update(`${meeting.id}:${meeting.updatedAt.toISOString()}:${meeting.toDoMarkdown ?? ""}`)
    .digest("hex");
}

function hashSourceItem(params: { meetingId: string; inputHash: string; sourceText: string; title: string }): string {
  return createHash("sha256")
    .update(`${params.meetingId}:${params.inputHash}:${params.sourceText.trim()}:${params.title.trim()}`)
    .digest("hex");
}

function mapPriority(priority: ExtractedTask["priority"]): TaskPriority {
  switch (priority) {
    case "low":
      return TaskPriority.LOW;
    case "high":
      return TaskPriority.HIGH;
    case "critical":
      return TaskPriority.CRITICAL;
    case "medium":
    default:
      return TaskPriority.MEDIUM;
  }
}

function normalizeDueDate(rawValue: string): Date | null {
  const value = rawValue.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }

  return parsed;
}

function trimToLength(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trimEnd() : trimmed;
}

function parseOpenAiTasks(rawText: string): ExtractedTask[] {
  const parsed = ExtractedTasksResponseSchema.parse(JSON.parse(rawText));
  return parsed.tasks
    .map((task) => ({
      ...task,
      sourceText: trimToLength(task.sourceText, 1_000),
      title: trimToLength(task.title, 200),
      description: trimToLength(task.description, 5_000),
      assigneeEmail: task.assigneeEmail.trim().toLowerCase(),
      assigneeName: task.assigneeName.trim(),
      dueDate: task.dueDate.trim()
    }))
    .filter((task) => task.title.length > 0);
}

async function extractTasksWithOpenAi(toDoMarkdown: string, projectMembers: Array<{ name: string; email: string }>): Promise<ExtractedTask[]> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for meeting automation");
  }

  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    timeout: env.OPENAI_TIMEOUT_MS
  });

  const boundedToDoMarkdown = toDoMarkdown.slice(0, env.AI_MAX_INPUT_CHARS);
  const response = await client.responses.create({
    model: env.OPENAI_MODEL,
    store: false,
    input: [
      {
        role: "system",
        content:
          "Extract actionable project tasks from meeting TO DO Markdown. Preserve the source language. Return only concrete tasks. Use assigneeEmail or assigneeName only when the text clearly names one of the provided project members. Use dueDate only for explicit calendar dates in YYYY-MM-DD form."
      },
      {
        role: "user",
        content: JSON.stringify({
          projectMembers,
          toDoMarkdown: boundedToDoMarkdown
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "meeting_task_extraction",
        strict: true,
        schema: OPENAI_TASK_SCHEMA
      },
      verbosity: "low"
    },
    reasoning: {
      effort: "low"
    }
  });

  return parseOpenAiTasks(response.output_text);
}

function resolveAssigneeId(
  task: ExtractedTask,
  members: Array<{ userId: string; user: { name: string; email: string } }>
): string | null {
  const email = task.assigneeEmail.trim().toLowerCase();
  if (email) {
    const member = members.find((entry) => entry.user.email.toLowerCase() === email);
    if (member) {
      return member.userId;
    }
  }

  const name = task.assigneeName.trim().toLowerCase();
  if (name) {
    const member = members.find((entry) => entry.user.name.toLowerCase() === name);
    if (member) {
      return member.userId;
    }
  }

  return null;
}

export const processMeetingAutomationJob = async (
  prisma: PrismaClient,
  emailQueue: Queue,
  job: Job<MeetingAutomationJobPayload>
): Promise<void> => {
  const env = getEnv();
  const run = await prisma.meetingAutomationRun.findUnique({
    where: {
      id: job.data.runId
    },
    include: {
      meeting: true
    }
  });

  if (!run) {
    return;
  }

  if (!env.AI_MEETING_AUTOMATION_ENABLED) {
    await prisma.meetingAutomationRun.update({
      where: { id: run.id },
      data: {
        status: MeetingAutomationStatus.FAILED,
        errorMessage: "Meeting AI automation is disabled",
        completedAt: new Date()
      }
    });
    return;
  }

  if (run.status === MeetingAutomationStatus.COMPLETED || run.status === MeetingAutomationStatus.STALE) {
    return;
  }

  await prisma.meetingAutomationRun.update({
    where: { id: run.id },
    data: {
      status: MeetingAutomationStatus.RUNNING,
      startedAt: run.startedAt ?? new Date(),
      errorMessage: null
    }
  });

  const meeting = await prisma.meeting.findFirst({
    where: {
      id: job.data.meetingId,
      deletedAt: null
    },
    select: {
      id: true,
      projectId: true,
      createdById: true,
      updatedAt: true,
      toDoMarkdown: true
    }
  });

  if (!meeting) {
    await prisma.meetingAutomationRun.update({
      where: { id: run.id },
      data: {
        status: MeetingAutomationStatus.STALE,
        errorMessage: "Meeting no longer exists",
        completedAt: new Date()
      }
    });
    return;
  }

  if (hashMeetingAutomationInput(meeting) !== run.inputHash) {
    await prisma.meetingAutomationRun.update({
      where: { id: run.id },
      data: {
        status: MeetingAutomationStatus.STALE,
        errorMessage: "Meeting TO DO changed after automation was queued",
        completedAt: new Date()
      }
    });
    return;
  }

  if (!hasMeaningfulMarkdown(meeting.toDoMarkdown)) {
    await prisma.meetingAutomationRun.update({
      where: { id: run.id },
      data: {
        status: MeetingAutomationStatus.COMPLETED,
        createdTaskCount: 0,
        createdActionCount: 0,
        completedAt: new Date()
      }
    });
    return;
  }

  try {
    const members = await prisma.projectMember.findMany({
      where: {
        projectId: meeting.projectId,
        user: {
          deletedAt: null
        }
      },
      select: {
        userId: true,
        user: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });

    const extractedTasks = await extractTasksWithOpenAi(
      meeting.toDoMarkdown ?? "",
      members.map((member) => ({
        name: member.user.name,
        email: member.user.email
      }))
    );

    let createdTaskCount = 0;
    let createdActionCount = 0;
    const notificationEvents: Array<{ id: string }> = [];

    for (const extractedTask of extractedTasks) {
      const sourceText = extractedTask.sourceText || extractedTask.title;
      const sourceHash = hashSourceItem({
        meetingId: meeting.id,
        inputHash: run.inputHash,
        sourceText,
        title: extractedTask.title
      });

      const existingAction = await prisma.meetingAction.findUnique({
        where: {
          aiSourceHash: sourceHash
        },
        select: {
          id: true
        }
      });

      if (existingAction) {
        continue;
      }

      const assigneeId = resolveAssigneeId(extractedTask, members);
      const dueDate = normalizeDueDate(extractedTask.dueDate);
      const createdById = run.requestedById ?? meeting.createdById;

      const result = await prisma.$transaction(async (tx) => {
        const task = await tx.task.create({
          data: {
            projectId: meeting.projectId,
            title: extractedTask.title,
            description: extractedTask.description || null,
            status: TaskStatus.TODO,
            priority: mapPriority(extractedTask.priority),
            assigneeId,
            dueDate,
            createdById
          },
          select: {
            id: true
          }
        });

        const action = await tx.meetingAction.create({
          data: {
            meetingId: meeting.id,
            title: extractedTask.title,
            description: extractedTask.description || null,
            ownerId: assigneeId,
            dueDate,
            linkedTaskId: task.id,
            automationRunId: run.id,
            aiSourceHash: sourceHash,
            aiSourceText: sourceText
          },
          select: {
            id: true
          }
        });

        const notificationEvent = assigneeId
          ? await tx.notificationEvent.create({
              data: {
                userId: assigneeId,
                type: NotificationEventType.TASK_ASSIGNED,
                status: NotificationStatus.PENDING,
                payload: {
                  taskId: task.id,
                  meetingId: meeting.id,
                  meetingActionId: action.id,
                  automationRunId: run.id
                }
              },
              select: {
                id: true
              }
            })
          : null;

        await tx.auditLog.createMany({
          data: [
            {
              userId: createdById,
              projectId: meeting.projectId,
              taskId: task.id,
              entityType: "task",
              entityId: task.id,
              action: "task.create",
              metadata: {
                source: "meeting_ai",
                meetingId: meeting.id,
                meetingActionId: action.id,
                automationRunId: run.id
              }
            },
            {
              userId: createdById,
              projectId: meeting.projectId,
              taskId: task.id,
              entityType: "meeting_action",
              entityId: action.id,
              action: "meeting.action.create",
              metadata: {
                source: "meeting_ai",
                meetingId: meeting.id,
                linkedTaskId: task.id,
                automationRunId: run.id
              }
            }
          ]
        });

        return {
          notificationEvent
        };
      });

      createdTaskCount += 1;
      createdActionCount += 1;
      if (result.notificationEvent) {
        notificationEvents.push(result.notificationEvent);
      }
    }

    for (const event of notificationEvents) {
      await emailQueue.add(
        "send-email",
        {
          notificationEventId: event.id
        },
        {
          attempts: 5,
          removeOnComplete: 500,
          removeOnFail: 500
        }
      );
    }

    await prisma.meetingAutomationRun.update({
      where: { id: run.id },
      data: {
        status: MeetingAutomationStatus.COMPLETED,
        createdTaskCount,
        createdActionCount,
        errorMessage: null,
        completedAt: new Date()
      }
    });
  } catch (error) {
    await prisma.meetingAutomationRun.update({
      where: { id: run.id },
      data: {
        status: MeetingAutomationStatus.FAILED,
        errorMessage: (error as Error).message,
        completedAt: new Date()
      }
    });

    throw error;
  }
};

export const __private__ = {
  parseOpenAiTasks,
  hashMeetingAutomationInput,
  hashSourceItem,
  hasMeaningfulMarkdown
};
