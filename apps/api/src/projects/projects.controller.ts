import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { ProjectsService } from "./projects.service";

@Controller("projects")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  createProject(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; key: string; name: string; description: string | null }> {
    return this.projectsService.createProject(dto, user);
  }

  @Get()
  listProjects(@CurrentUser() user: AuthenticatedUser): Promise<Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    createdAt: string;
    isPinned: boolean;
  }>> {
    return this.projectsService.listProjects(user);
  }

  @Post(":projectId/pin")
  pinProject(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ projectId: string; pinned: true; pinnedAt: string }> {
    return this.projectsService.pinProject(projectId, user);
  }

  @Delete(":projectId/pin")
  unpinProject(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ projectId: string; pinned: false }> {
    return this.projectsService.unpinProject(projectId, user);
  }

  @Get(":projectId/members")
  listMembers(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<Array<{ userId: string; name: string; email: string }>> {
    return this.projectsService.listMembers(projectId, user);
  }

  @Post(":projectId/members")
  addMember(
    @Param("projectId") projectId: string,
    @Body() dto: AddProjectMemberDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ projectId: string; userId: string }> {
    return this.projectsService.addMember(projectId, dto, user);
  }
}
