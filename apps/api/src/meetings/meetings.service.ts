import { createHash } from "crypto";

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MeetingAutomationStatus, TaskStatus } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queues/queue.service";
import { CreateMeetingActionDto } from "./dto/create-meeting-action.dto";
import { CreateMeetingDto } from "./dto/create-meeting.dto";
import { ListMeetingsQueryDto } from "./dto/list-meetings-query.dto";
import { LinkActionTaskDto } from "./dto/link-action-task.dto";
import { UpdateMeetingDto } from "./dto/update-meeting.dto";
import {
  MeetingAutomationStatusValue,
  MeetingListItem,
  MeetingRecordResponse
} from "./meeting.types";

type MeetingAutomationRunRow = {
  id: string;
  status: MeetingAutomationStatus;
  createdTaskCount: number;
  createdActionCount: number;
  errorMessage: string | null;
  completedAt: Date | null;
  updatedAt: Date;
};

type MeetingRow = {
  id: string;
  projectId: string;
  title: string;
  scheduledAt: Date;
  location: string | null;
  doneMarkdown: string | null;
  toDiscussMarkdown: string | null;
  toDoMarkdown: string | null;
  createdAt: Date;
  updatedAt: Date;
  automationRuns?: MeetingAutomationRunRow[];
};

type MeetingListRow = MeetingRow & {
  _count: {
    actions: number;
  };
};

function isDayOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatScheduledDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseScheduledAtInput(rawValue: string): Date {
  const normalizedRawValue = rawValue.trim();
  const parsed = isDayOnly(normalizedRawValue)
    ? new Date(`${normalizedRawValue}T12:00:00.000Z`)
    : new Date(normalizedRawValue);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("Invalid scheduledAt value");
  }

  return parsed;
}

function parseDateFilter(rawValue: string, mode: "start" | "end"): Date {
  const normalizedRawValue = rawValue.trim();
  const parsed = isDayOnly(normalizedRawValue)
    ? new Date(
        mode === "start"
          ? `${normalizedRawValue}T00:00:00.000Z`
          : `${normalizedRawValue}T23:59:59.999Z`
      )
    : new Date(normalizedRawValue);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid ${mode === "start" ? "from" : "to"} filter`);
  }

  return parsed;
}

function mapAutomationStatus(status: MeetingAutomationStatus): MeetingAutomationStatusValue {
  switch (status) {
    case MeetingAutomationStatus.RUNNING:
      return "running";
    case MeetingAutomationStatus.COMPLETED:
      return "completed";
    case MeetingAutomationStatus.FAILED:
      return "failed";
    case MeetingAutomationStatus.STALE:
      return "stale";
    case MeetingAutomationStatus.QUEUED:
    default:
      return "queued";
  }
}

function toAutomationSummary(automationRuns?: MeetingAutomationRunRow[]): MeetingRecordResponse["automation"] {
  const run = automationRuns?.[0] ?? null;
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    status: mapAutomationStatus(run.status),
    createdTaskCount: run.createdTaskCount,
    createdActionCount: run.createdActionCount,
    errorMessage: run.errorMessage,
    completedAt: run.completedAt?.toISOString() ?? null,
    updatedAt: run.updatedAt.toISOString()
  };
}

function toMeetingRecordResponse(meeting: MeetingRow): MeetingRecordResponse {
  return {
    id: meeting.id,
    projectId: meeting.projectId,
    title: meeting.title,
    scheduledAt: meeting.scheduledAt.toISOString(),
    scheduledDate: formatScheduledDate(meeting.scheduledAt),
    location: meeting.location,
    doneMarkdown: meeting.doneMarkdown,
    toDiscussMarkdown: meeting.toDiscussMarkdown,
    toDoMarkdown: meeting.toDoMarkdown,
    automation: toAutomationSummary(meeting.automationRuns),
    createdAt: meeting.createdAt.toISOString(),
    updatedAt: meeting.updatedAt.toISOString()
  };
}

function toMeetingListItem(meeting: MeetingListRow): MeetingListItem {
  return {
    ...toMeetingRecordResponse(meeting),
    actionsCount: meeting._count.actions
  };
}

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

function normalizeMarkdownForStorage(value?: string | null): string | null {
  return hasMeaningfulMarkdown(value) ? value ?? null : null;
}

function normalizeMarkdownForCreate(value?: string): string | undefined {
  return normalizeMarkdownForStorage(value) ?? undefined;
}

function hashMeetingAutomationInput(meeting: { id: string; updatedAt: Date; toDoMarkdown: string | null }): string {
  return createHash("sha256")
    .update(`${meeting.id}:${meeting.updatedAt.toISOString()}:${meeting.toDoMarkdown ?? ""}`)
    .digest("hex");
}

function completedTasksSection(tasks: Array<{
  title: string;
  completedAt: Date | null;
  assignee: { name: string } | null;
}>): string {
  const lines = tasks.map((task) => {
    const parts = [`- [x] ${task.title}`];
    if (task.assignee?.name) {
      parts.push(`assignee: ${task.assignee.name}`);
    }
    if (task.completedAt) {
      parts.push(`completed: ${task.completedAt.toISOString().slice(0, 10)}`);
    }
    return parts.length === 1 ? parts[0] : `${parts[0]} (${parts.slice(1).join(", ")})`;
  });

  return `### Completed tasks since previous minute\n\n${lines.join("\n")}`;
}

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService,
    private readonly queueService: QueueService
  ) {}

  private async buildDoneMarkdown(projectId: string, scheduledAt: Date, doneMarkdown?: string): Promise<string | undefined> {
    const normalizedDoneMarkdown = normalizeMarkdownForCreate(doneMarkdown);
    const previousMeeting = await this.prisma.meeting.findFirst({
      where: {
        projectId,
        deletedAt: null,
        scheduledAt: {
          lt: scheduledAt
        }
      },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
      select: {
        scheduledAt: true
      }
    });

    if (!previousMeeting) {
      return normalizedDoneMarkdown;
    }

    const completedTasks = await this.prisma.task.findMany({
      where: {
        projectId,
        deletedAt: null,
        status: TaskStatus.DONE,
        completedAt: {
          gt: previousMeeting.scheduledAt,
          lte: scheduledAt
        }
      },
      orderBy: [{ completedAt: "asc" }, { createdAt: "asc" }],
      select: {
        title: true,
        completedAt: true,
        assignee: {
          select: {
            name: true
          }
        }
      }
    });

    if (completedTasks.length === 0) {
      return normalizedDoneMarkdown;
    }

    const generatedSection = completedTasksSection(completedTasks);
    if (!normalizedDoneMarkdown) {
      return generatedSection;
    }

    return `${normalizedDoneMarkdown.trimEnd()}\n\n${generatedSection}`;
  }

  private async enqueueAutomationForMeeting(
    meeting: MeetingRow,
    requestedById: string
  ): Promise<MeetingAutomationRunRow | null> {
    if (!getEnv().AI_MEETING_AUTOMATION_ENABLED || !hasMeaningfulMarkdown(meeting.toDoMarkdown)) {
      return null;
    }

    const run = await this.prisma.meetingAutomationRun.create({
      data: {
        meetingId: meeting.id,
        projectId: meeting.projectId,
        requestedById,
        status: MeetingAutomationStatus.QUEUED,
        inputHash: hashMeetingAutomationInput(meeting)
      },
      select: {
        id: true,
        status: true,
        createdTaskCount: true,
        createdActionCount: true,
        errorMessage: true,
        completedAt: true,
        updatedAt: true
      }
    });

    try {
      const queueJobId = await this.queueService.enqueueMeetingAutomation({
        runId: run.id,
        meetingId: meeting.id
      });

      return await this.prisma.meetingAutomationRun.update({
        where: {
          id: run.id
        },
        data: {
          queueJobId
        },
        select: {
          id: true,
          status: true,
          createdTaskCount: true,
          createdActionCount: true,
          errorMessage: true,
          completedAt: true,
          updatedAt: true
        }
      });
    } catch (error) {
      return await this.prisma.meetingAutomationRun.update({
        where: {
          id: run.id
        },
        data: {
          status: MeetingAutomationStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date()
        },
        select: {
          id: true,
          status: true,
          createdTaskCount: true,
          createdActionCount: true,
          errorMessage: true,
          completedAt: true,
          updatedAt: true
        }
      });
    }
  }

  async listMeetings(
    projectId: string,
    query: ListMeetingsQueryDto,
    user: AuthenticatedUser
  ): Promise<MeetingListItem[]> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const where: {
      projectId: string;
      deletedAt: null;
      scheduledAt?: { gte?: Date; lte?: Date };
    } = {
      projectId,
      deletedAt: null
    };

    if (query.from || query.to) {
      where.scheduledAt = {};
      if (query.from) {
        where.scheduledAt.gte = parseDateFilter(query.from, "start");
      }
      if (query.to) {
        where.scheduledAt.lte = parseDateFilter(query.to, "end");
      }
    }

    const meetings = await this.prisma.meeting.findMany({
      where,
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        projectId: true,
        title: true,
        scheduledAt: true,
        location: true,
        doneMarkdown: true,
        toDiscussMarkdown: true,
        toDoMarkdown: true,
        automationRuns: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1,
          select: {
            id: true,
            status: true,
            createdTaskCount: true,
            createdActionCount: true,
            errorMessage: true,
            completedAt: true,
            updatedAt: true
          }
        },
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            actions: true
          }
        }
      }
    });

    return meetings.map((meeting) => toMeetingListItem(meeting));
  }

  async createMeeting(projectId: string, dto: CreateMeetingDto, user: AuthenticatedUser): Promise<MeetingRecordResponse> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    const scheduledAt = parseScheduledAtInput(dto.scheduledAt);
    const doneMarkdown = await this.buildDoneMarkdown(projectId, scheduledAt, dto.doneMarkdown);
    const toDiscussMarkdown = normalizeMarkdownForCreate(dto.toDiscussMarkdown);
    const toDoMarkdown = normalizeMarkdownForCreate(dto.toDoMarkdown);

    const meeting = await this.prisma.meeting.create({
      data: {
        projectId,
        title: dto.title,
        scheduledAt,
        location: dto.location,
        doneMarkdown,
        toDiscussMarkdown,
        toDoMarkdown,
        createdById: user.userId
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        scheduledAt: true,
        location: true,
        doneMarkdown: true,
        toDiscussMarkdown: true,
        toDoMarkdown: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "meeting",
      entityId: meeting.id,
      action: "meeting.create"
    });

    const automationRun = await this.enqueueAutomationForMeeting(meeting, user.userId);
    if (automationRun) {
      await this.auditService.log({
        userId: user.userId,
        projectId,
        entityType: "meeting_automation",
        entityId: automationRun.id,
        action: "meeting.ai.extract_queued",
        metadata: {
          meetingId: meeting.id
        }
      });
    }

    return toMeetingRecordResponse({
      ...meeting,
      automationRuns: automationRun ? [automationRun] : []
    });
  }

  async updateMeeting(meetingId: string, dto: UpdateMeetingDto, user: AuthenticatedUser): Promise<MeetingRecordResponse> {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, meeting.projectId);

    const nextData: {
      title?: string;
      scheduledAt?: Date;
      location?: string;
      doneMarkdown?: string | null;
      toDiscussMarkdown?: string | null;
      toDoMarkdown?: string | null;
    } = {};

    if (dto.title !== undefined) {
      nextData.title = dto.title;
    }

    if (dto.scheduledAt !== undefined) {
      nextData.scheduledAt = parseScheduledAtInput(dto.scheduledAt);
    }

    if (dto.location !== undefined) {
      nextData.location = dto.location;
    }

    if (dto.doneMarkdown !== undefined) {
      nextData.doneMarkdown = normalizeMarkdownForStorage(dto.doneMarkdown);
    }

    if (dto.toDiscussMarkdown !== undefined) {
      nextData.toDiscussMarkdown = normalizeMarkdownForStorage(dto.toDiscussMarkdown);
    }

    if (dto.toDoMarkdown !== undefined) {
      nextData.toDoMarkdown = normalizeMarkdownForStorage(dto.toDoMarkdown);
    }

    const updatedMeeting = await this.prisma.meeting.update({
      where: {
        id: meeting.id
      },
      data: nextData,
      select: {
        id: true,
        projectId: true,
        title: true,
        scheduledAt: true,
        location: true,
        doneMarkdown: true,
        toDiscussMarkdown: true,
        toDoMarkdown: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: meeting.projectId,
      entityType: "meeting",
      entityId: meeting.id,
      action: "meeting.update"
    });

    return toMeetingRecordResponse(updatedMeeting);
  }

  async deleteMeeting(meetingId: string, user: AuthenticatedUser): Promise<{ id: string; deletedAt: string }> {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, meeting.projectId);

    const deletedMeeting = await this.prisma.meeting.update({
      where: {
        id: meeting.id
      },
      data: {
        deletedAt: new Date()
      },
      select: {
        id: true,
        deletedAt: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: meeting.projectId,
      entityType: "meeting",
      entityId: meeting.id,
      action: "meeting.delete"
    });

    return {
      id: deletedMeeting.id,
      deletedAt: deletedMeeting.deletedAt?.toISOString() ?? new Date().toISOString()
    };
  }

  async retryAutomation(meetingId: string, user: AuthenticatedUser): Promise<MeetingRecordResponse> {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        scheduledAt: true,
        location: true,
        doneMarkdown: true,
        toDiscussMarkdown: true,
        toDoMarkdown: true,
        createdAt: true,
        updatedAt: true,
        automationRuns: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1,
          select: {
            id: true,
            status: true,
            createdTaskCount: true,
            createdActionCount: true,
            errorMessage: true,
            completedAt: true,
            updatedAt: true
          }
        }
      }
    });

    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, meeting.projectId);

    if (!getEnv().AI_MEETING_AUTOMATION_ENABLED) {
      throw new BadRequestException("Meeting AI automation is disabled");
    }

    if (!hasMeaningfulMarkdown(meeting.toDoMarkdown)) {
      throw new BadRequestException("Meeting TO DO is empty");
    }

    const latestRun = meeting.automationRuns[0] ?? null;
    if (!latestRun) {
      throw new BadRequestException("No failed or stale automation run to retry");
    }

    if (
      latestRun.status !== MeetingAutomationStatus.FAILED &&
      latestRun.status !== MeetingAutomationStatus.STALE
    ) {
      throw new BadRequestException("Only failed or stale automation runs can be retried");
    }

    const automationRun = await this.enqueueAutomationForMeeting(meeting, user.userId);
    if (!automationRun) {
      throw new BadRequestException("Meeting automation could not be queued");
    }

    await this.auditService.log({
      userId: user.userId,
      projectId: meeting.projectId,
      entityType: "meeting_automation",
      entityId: automationRun.id,
      action: "meeting.ai.extract_queued",
      metadata: {
        meetingId: meeting.id,
        retriedRunId: latestRun?.id ?? null
      }
    });

    return toMeetingRecordResponse({
      ...meeting,
      automationRuns: [automationRun]
    });
  }

  async createAction(meetingId: string, dto: CreateMeetingActionDto, user: AuthenticatedUser): Promise<{
    id: string;
    meetingId: string;
    title: string;
    linkedTaskId: string | null;
  }> {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, meeting.projectId);

    if (dto.linkedTaskId) {
      const task = await this.prisma.task.findFirst({
        where: {
          id: dto.linkedTaskId,
          projectId: meeting.projectId,
          deletedAt: null
        },
        select: { id: true }
      });

      if (!task) {
        throw new BadRequestException("Linked task not found in meeting project");
      }
    }

    const action = await this.prisma.meetingAction.create({
      data: {
        meetingId,
        title: dto.title,
        description: dto.description,
        ownerId: dto.ownerId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        linkedTaskId: dto.linkedTaskId
      },
      select: {
        id: true,
        meetingId: true,
        title: true,
        linkedTaskId: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: meeting.projectId,
      entityType: "meeting_action",
      entityId: action.id,
      action: "meeting.action.create",
      metadata: {
        meetingId
      }
    });

    return action;
  }

  async linkActionToTask(
    meetingId: string,
    actionId: string,
    dto: LinkActionTaskDto,
    user: AuthenticatedUser
  ): Promise<{ actionId: string; linkedTaskId: string }> {
    const action = await this.prisma.meetingAction.findFirst({
      where: {
        id: actionId,
        meetingId
      },
      select: {
        id: true,
        meetingId: true,
        meeting: {
          select: {
            projectId: true,
            deletedAt: true
          }
        }
      }
    });

    if (!action) {
      throw new NotFoundException("Meeting action not found");
    }

    if (action.meeting.deletedAt) {
      throw new NotFoundException("Meeting not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, action.meeting.projectId);

    const task = await this.prisma.task.findFirst({
      where: {
        id: dto.taskId,
        projectId: action.meeting.projectId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!task) {
      throw new BadRequestException("Task not found in the same project");
    }

    await this.prisma.meetingAction.update({
      where: {
        id: action.id
      },
      data: {
        linkedTaskId: dto.taskId
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: action.meeting.projectId,
      entityType: "meeting_action",
      entityId: action.id,
      action: "meeting.action.link_task",
      metadata: { taskId: dto.taskId }
    });

    return {
      actionId: action.id,
      linkedTaskId: dto.taskId
    };
  }
}
