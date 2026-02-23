import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { CreateMeetingActionDto } from "./dto/create-meeting-action.dto";
import { CreateMeetingDto } from "./dto/create-meeting.dto";
import { ListMeetingsQueryDto } from "./dto/list-meetings-query.dto";
import { LinkActionTaskDto } from "./dto/link-action-task.dto";
import { UpdateMeetingDto } from "./dto/update-meeting.dto";
import { MeetingListItem, MeetingRecordResponse } from "./meeting.types";
import { MeetingsService } from "./meetings.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get("projects/:projectId/meetings")
  listMeetings(
    @Param("projectId") projectId: string,
    @Query() query: ListMeetingsQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<MeetingListItem[]> {
    return this.meetingsService.listMeetings(projectId, query, user);
  }

  @Post("projects/:projectId/meetings")
  createMeeting(
    @Param("projectId") projectId: string,
    @Body() dto: CreateMeetingDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<MeetingRecordResponse> {
    return this.meetingsService.createMeeting(projectId, dto, user);
  }

  @Patch("meetings/:meetingId")
  updateMeeting(
    @Param("meetingId") meetingId: string,
    @Body() dto: UpdateMeetingDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<MeetingRecordResponse> {
    return this.meetingsService.updateMeeting(meetingId, dto, user);
  }

  @Delete("meetings/:meetingId")
  deleteMeeting(
    @Param("meetingId") meetingId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; deletedAt: string }> {
    return this.meetingsService.deleteMeeting(meetingId, user);
  }

  @Post("meetings/:meetingId/actions")
  createAction(
    @Param("meetingId") meetingId: string,
    @Body() dto: CreateMeetingActionDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; meetingId: string; title: string; linkedTaskId: string | null }> {
    return this.meetingsService.createAction(meetingId, dto, user);
  }

  @Post("meetings/:meetingId/actions/:actionId/link-task")
  linkTask(
    @Param("meetingId") meetingId: string,
    @Param("actionId") actionId: string,
    @Body() dto: LinkActionTaskDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ actionId: string; linkedTaskId: string }> {
    return this.meetingsService.linkActionToTask(meetingId, actionId, dto, user);
  }
}
