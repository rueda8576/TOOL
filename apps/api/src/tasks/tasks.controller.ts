import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { AddTaskDependencyDto } from "./dto/add-task-dependency.dto";
import { CreateSubtaskDto } from "./dto/create-subtask.dto";
import { CreateTaskDto } from "./dto/create-task.dto";
import { TaskListItem } from "./task.types";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TasksService } from "./tasks.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get("projects/:projectId/tasks")
  listTasks(
    @Param("projectId") projectId: string,
    @Query("includeSubtasks") includeSubtasks: string | undefined,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<TaskListItem[]> {
    return this.tasksService.listTasks(projectId, user, includeSubtasks === "true");
  }

  @Post("projects/:projectId/tasks")
  createTask(
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; projectId: string; title: string; status: string; priority: string; parentTaskId: string | null }> {
    return this.tasksService.createTask(projectId, dto, user);
  }

  @Patch("tasks/:taskId")
  updateTask(
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; projectId: string; title: string; status: string; priority: string; assigneeId: string | null }> {
    return this.tasksService.updateTask(taskId, dto, user);
  }

  @Delete("tasks/:taskId")
  deleteTask(
    @Param("taskId") taskId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; deletedAt: string }> {
    return this.tasksService.deleteTask(taskId, user);
  }

  @Post("tasks/:taskId/dependencies")
  addDependency(
    @Param("taskId") taskId: string,
    @Body() dto: AddTaskDependencyDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; taskId: string; dependsOnTaskId: string }> {
    return this.tasksService.addDependency(taskId, dto, user);
  }

  @Post("tasks/:taskId/subtasks")
  addSubtask(
    @Param("taskId") taskId: string,
    @Body() dto: CreateSubtaskDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; parentTaskId: string | null; projectId: string; title: string }> {
    return this.tasksService.addSubtask(taskId, dto, user);
  }
}
