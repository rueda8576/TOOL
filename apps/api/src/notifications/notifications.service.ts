import { Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  async getPreferences(user: AuthenticatedUser): Promise<{
    emailEnabled: boolean;
    taskAssigned: boolean;
    taskDue: boolean;
    mentionInWiki: boolean;
    mentionInTaskComments: boolean;
    taskDueLeadHours: number;
  }> {
    const preferences = await this.prisma.notificationPreference.upsert({
      where: {
        userId: user.userId
      },
      create: {
        userId: user.userId
      },
      update: {}
    });

    return {
      emailEnabled: preferences.emailEnabled,
      taskAssigned: preferences.taskAssigned,
      taskDue: preferences.taskDue,
      mentionInWiki: preferences.mentionInWiki,
      mentionInTaskComments: preferences.mentionInTaskComments,
      taskDueLeadHours: preferences.taskDueLeadHours
    };
  }

  async updatePreferences(
    user: AuthenticatedUser,
    dto: UpdateNotificationPreferencesDto
  ): Promise<{
    emailEnabled: boolean;
    taskAssigned: boolean;
    taskDue: boolean;
    mentionInWiki: boolean;
    mentionInTaskComments: boolean;
    taskDueLeadHours: number;
  }> {
    const updated = await this.prisma.notificationPreference.upsert({
      where: {
        userId: user.userId
      },
      create: {
        userId: user.userId,
        ...dto
      },
      update: {
        ...dto
      }
    });

    await this.auditService.log({
      userId: user.userId,
      entityType: "notification_preference",
      entityId: updated.id,
      action: "notification.preference.update"
    });

    return {
      emailEnabled: updated.emailEnabled,
      taskAssigned: updated.taskAssigned,
      taskDue: updated.taskDue,
      mentionInWiki: updated.mentionInWiki,
      mentionInTaskComments: updated.mentionInTaskComments,
      taskDueLeadHours: updated.taskDueLeadHours
    };
  }
}
