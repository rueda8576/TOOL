import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateMeetingActionDto } from "./dto/create-meeting-action.dto";
import { CreateMeetingDto } from "./dto/create-meeting.dto";
import { ListMeetingsQueryDto } from "./dto/list-meetings-query.dto";
import { LinkActionTaskDto } from "./dto/link-action-task.dto";
import { UpdateMeetingDto } from "./dto/update-meeting.dto";
import { MeetingListItem, MeetingRecordResponse } from "./meeting.types";

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

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService
  ) {}

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

    const meeting = await this.prisma.meeting.create({
      data: {
        projectId,
        title: dto.title,
        scheduledAt,
        location: dto.location,
        doneMarkdown: dto.doneMarkdown,
        toDiscussMarkdown: dto.toDiscussMarkdown,
        toDoMarkdown: dto.toDoMarkdown,
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

    return toMeetingRecordResponse(meeting);
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
      doneMarkdown?: string;
      toDiscussMarkdown?: string;
      toDoMarkdown?: string;
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
      nextData.doneMarkdown = dto.doneMarkdown;
    }

    if (dto.toDiscussMarkdown !== undefined) {
      nextData.toDiscussMarkdown = dto.toDiscussMarkdown;
    }

    if (dto.toDoMarkdown !== undefined) {
      nextData.toDoMarkdown = dto.toDoMarkdown;
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
