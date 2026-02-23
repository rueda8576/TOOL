import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  NotificationEventType,
  NotificationStatus,
  TaskPriority,
  TaskStatus
} from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queues/queue.service";
import { AddTaskDependencyDto } from "./dto/add-task-dependency.dto";
import { CreateSubtaskDto } from "./dto/create-subtask.dto";
import { CreateTaskDto } from "./dto/create-task.dto";
import { TaskListItem, TaskPriorityValue, TaskStatusValue } from "./task.types";
import { UpdateTaskDto } from "./dto/update-task.dto";

const mapStatus = (status?: string): TaskStatus => {
  switch (status) {
    case "in_progress":
      return TaskStatus.IN_PROGRESS;
    case "blocked":
      return TaskStatus.BLOCKED;
    case "done":
      return TaskStatus.DONE;
    case "todo":
    default:
      return TaskStatus.TODO;
  }
};

const mapPriority = (priority?: string): TaskPriority => {
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
};

const mapStatusValue = (status: TaskStatus): TaskStatusValue => {
  switch (status) {
    case TaskStatus.IN_PROGRESS:
      return "in_progress";
    case TaskStatus.BLOCKED:
      return "blocked";
    case TaskStatus.DONE:
      return "done";
    case TaskStatus.TODO:
    default:
      return "todo";
  }
};

const mapPriorityValue = (priority: TaskPriority): TaskPriorityValue => {
  switch (priority) {
    case TaskPriority.LOW:
      return "low";
    case TaskPriority.HIGH:
      return "high";
    case TaskPriority.CRITICAL:
      return "critical";
    case TaskPriority.MEDIUM:
    default:
      return "medium";
  }
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly queueService: QueueService,
    private readonly auditService: AuditService
  ) {}

  private async queueAssigneeNotification(taskId: string, assigneeId?: string): Promise<void> {
    if (!assigneeId) {
      return;
    }

    const event = await this.prisma.notificationEvent.create({
      data: {
        userId: assigneeId,
        type: NotificationEventType.TASK_ASSIGNED,
        status: NotificationStatus.PENDING,
        payload: {
          taskId
        }
      }
    });

    await this.queueService.enqueueEmail({ notificationEventId: event.id });
  }

  private async ensureAssigneeIsProjectMember(projectId: string, assigneeId?: string | null): Promise<void> {
    if (!assigneeId) {
      return;
    }

    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: assigneeId
        }
      },
      select: { userId: true }
    });

    if (!membership) {
      throw new BadRequestException("Assignee must be a member of the project");
    }
  }

  async listTasks(projectId: string, user: AuthenticatedUser, includeSubtasks = false): Promise<TaskListItem[]> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(includeSubtasks ? {} : { parentTaskId: null })
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        assigneeId: true,
        assignee: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        startDate: true,
        dueDate: true,
        parentTaskId: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return tasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: mapStatusValue(task.status),
      priority: mapPriorityValue(task.priority),
      assigneeId: task.assigneeId,
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            name: task.assignee.name,
            email: task.assignee.email
          }
        : null,
      startDate: task.startDate?.toISOString() ?? null,
      dueDate: task.dueDate?.toISOString() ?? null,
      parentTaskId: task.parentTaskId,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString()
    }));
  }

  async createTask(projectId: string, dto: CreateTaskDto, user: AuthenticatedUser): Promise<{
    id: string;
    projectId: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    parentTaskId: string | null;
  }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    if (dto.parentTaskId) {
      const parent = await this.prisma.task.findFirst({
        where: {
          id: dto.parentTaskId,
          projectId,
          deletedAt: null
        },
        select: { id: true }
      });

      if (!parent) {
        throw new BadRequestException("Parent task not found in project");
      }
    }

    await this.ensureAssigneeIsProjectMember(projectId, dto.assigneeId);

    const task = await this.prisma.task.create({
      data: {
        projectId,
        title: dto.title,
        description: dto.description,
        status: mapStatus(dto.status),
        priority: mapPriority(dto.priority),
        assigneeId: dto.assigneeId,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        parentTaskId: dto.parentTaskId,
        createdById: user.userId
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        priority: true,
        parentTaskId: true
      }
    });

    await this.queueAssigneeNotification(task.id, dto.assigneeId);

    await this.auditService.log({
      userId: user.userId,
      projectId,
      taskId: task.id,
      entityType: "task",
      entityId: task.id,
      action: "task.create"
    });

    return task;
  }

  async updateTask(taskId: string, dto: UpdateTaskDto, user: AuthenticatedUser): Promise<{
    id: string;
    projectId: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId: string | null;
  }> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, task.projectId);
    await this.ensureAssigneeIsProjectMember(task.projectId, dto.assigneeId);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status ? mapStatus(dto.status) : undefined,
        priority: dto.priority ? mapPriority(dto.priority) : undefined,
        assigneeId: dto.assigneeId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        priority: true,
        assigneeId: true
      }
    });

    if (dto.assigneeId) {
      await this.queueAssigneeNotification(updated.id, dto.assigneeId);
    }

    await this.auditService.log({
      userId: user.userId,
      projectId: task.projectId,
      taskId,
      entityType: "task",
      entityId: taskId,
      action: "task.update"
    });

    return updated;
  }

  async deleteTask(taskId: string, user: AuthenticatedUser): Promise<{ id: string; deletedAt: string }> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, task.projectId);

    const activeSubtask = await this.prisma.task.findFirst({
      where: {
        parentTaskId: taskId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (activeSubtask) {
      throw new BadRequestException("Cannot delete task with active subtasks");
    }

    const activeDependent = await this.prisma.taskDependency.findFirst({
      where: {
        dependsOnTaskId: taskId,
        task: {
          deletedAt: null
        }
      },
      select: { id: true }
    });

    if (activeDependent) {
      throw new BadRequestException("Cannot delete task with active dependencies");
    }

    const deleted = await this.prisma.task.update({
      where: { id: taskId },
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
      projectId: task.projectId,
      taskId,
      entityType: "task",
      entityId: taskId,
      action: "task.delete"
    });

    return {
      id: deleted.id,
      deletedAt: deleted.deletedAt?.toISOString() ?? new Date().toISOString()
    };
  }

  async addDependency(taskId: string, dto: AddTaskDependencyDto, user: AuthenticatedUser): Promise<{
    id: string;
    taskId: string;
    dependsOnTaskId: string;
  }> {
    if (taskId === dto.dependsOnTaskId) {
      throw new BadRequestException("Task cannot depend on itself");
    }

    const [task, dependsOnTask] = await Promise.all([
      this.prisma.task.findFirst({
        where: { id: taskId, deletedAt: null },
        select: { id: true, projectId: true }
      }),
      this.prisma.task.findFirst({
        where: { id: dto.dependsOnTaskId, deletedAt: null },
        select: { id: true, projectId: true }
      })
    ]);

    if (!task || !dependsOnTask) {
      throw new NotFoundException("Task not found");
    }

    if (task.projectId !== dependsOnTask.projectId) {
      throw new BadRequestException("Dependencies must belong to the same project");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, task.projectId);

    const dependency = await this.prisma.taskDependency.upsert({
      where: {
        taskId_dependsOnTaskId: {
          taskId,
          dependsOnTaskId: dto.dependsOnTaskId
        }
      },
      create: {
        taskId,
        dependsOnTaskId: dto.dependsOnTaskId,
        createdById: user.userId
      },
      update: {},
      select: {
        id: true,
        taskId: true,
        dependsOnTaskId: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: task.projectId,
      taskId,
      entityType: "task_dependency",
      entityId: dependency.id,
      action: "task.dependency.add"
    });

    return dependency;
  }

  async addSubtask(taskId: string, dto: CreateSubtaskDto, user: AuthenticatedUser): Promise<{
    id: string;
    parentTaskId: string | null;
    projectId: string;
    title: string;
  }> {
    const parentTask = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!parentTask) {
      throw new NotFoundException("Parent task not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, parentTask.projectId);
    await this.ensureAssigneeIsProjectMember(parentTask.projectId, dto.assigneeId);

    const task = await this.prisma.task.create({
      data: {
        projectId: parentTask.projectId,
        title: dto.title,
        description: dto.description,
        status: TaskStatus.TODO,
        priority: mapPriority(dto.priority),
        assigneeId: dto.assigneeId,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        parentTaskId: parentTask.id,
        createdById: user.userId
      },
      select: {
        id: true,
        parentTaskId: true,
        projectId: true,
        title: true
      }
    });

    await this.queueAssigneeNotification(task.id, dto.assigneeId);

    await this.auditService.log({
      userId: user.userId,
      projectId: parentTask.projectId,
      taskId: task.id,
      entityType: "task",
      entityId: task.id,
      action: "task.subtask.create",
      metadata: {
        parentTaskId: parentTask.id
      }
    });

    return task;
  }
}
