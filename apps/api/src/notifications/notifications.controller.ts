import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";
import { NotificationsService } from "./notifications.service";

@Controller("users/me/notification-preferences")
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getPreferences(@CurrentUser() user: AuthenticatedUser): Promise<{
    emailEnabled: boolean;
    taskAssigned: boolean;
    taskDue: boolean;
    mentionInWiki: boolean;
    mentionInTaskComments: boolean;
    taskDueLeadHours: number;
  }> {
    return this.notificationsService.getPreferences(user);
  }

  @Put()
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto
  ): Promise<{
    emailEnabled: boolean;
    taskAssigned: boolean;
    taskDue: boolean;
    mentionInWiki: boolean;
    mentionInTaskComments: boolean;
    taskDueLeadHours: number;
  }> {
    return this.notificationsService.updatePreferences(user, dto);
  }
}
