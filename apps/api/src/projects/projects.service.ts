import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CompileStatus, MeetingActionStatus, Prisma, ProjectRole, TaskPriority, TaskStatus } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { GitlabService } from "../gitlab/gitlab.service";
import { PrismaService } from "../prisma/prisma.service";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";
import { CreateProjectDto } from "./dto/create-project.dto";

export type ProjectOverviewSeverity = "danger" | "warning" | "info";
export type ProjectOverviewModule = "wiki" | "documents" | "code" | "tasks" | "meetings" | "project";

export type ProjectOverviewAttentionItem = {
  id: string;
  severity: ProjectOverviewSeverity;
  module: ProjectOverviewModule;
  title: string;
  detail: string;
  href: string;
  date: string | null;
};

export type ProjectOverviewActivityItem = {
  id: string;
  module: ProjectOverviewModule;
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
};

export type ProjectOverview = {
  project: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  };
  access: {
    isAdmin: boolean;
    projectRole: "admin" | "editor" | "reader";
    canWrite: boolean;
  };
  attention: ProjectOverviewAttentionItem[];
  modules: {
    wiki: {
      publishedPages: number;
      draftPages: number;
      latestUpdatedAt: string | null;
      recentPages: Array<{ id: string; title: string; path: string; updatedAt: string; isDraft: boolean }>;
    };
    documents: {
      total: number;
      failedCompiles: number;
      runningCompiles: number;
      latestUpdatedAt: string | null;
      recent: Array<{ id: string; title: string; type: string; updatedAt: string; compileStatus: string | null }>;
    };
    code: {
      connected: boolean;
      pathWithNamespace: string | null;
      defaultBranch: string | null;
      lastActivityAt: string | null;
    };
    tasks: {
      open: number;
      inProgress: number;
      blocked: number;
      overdue: number;
      critical: number;
      next: Array<{ id: string; title: string; priority: string; status: string; dueDate: string | null; assigneeName: string | null }>;
    };
    meetings: {
      thisMonth: number;
      upcoming: number;
      openActions: number;
      next: Array<{ id: string; title: string; scheduledAt: string; scheduledDate: string; location: string | null; actionsCount: number }>;
    };
  };
  activity: ProjectOverviewActivityItem[];
};

const ATTENTION_LIMIT = 8;
const ACTIVITY_LIMIT = 10;
const SEVERITY_ORDER: Record<ProjectOverviewSeverity, number> = {
  danger: 0,
  warning: 1,
  info: 2
};

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

function mapCompileStatus(status: CompileStatus | null | undefined): string | null {
  if (!status) {
    return null;
  }
  return status.toLowerCase();
}

function mapTaskStatus(status: TaskStatus): string {
  return status.toLowerCase();
}

function mapTaskPriority(priority: TaskPriority): string {
  return priority.toLowerCase();
}

function mapDocumentType(type: string): string {
  return type.toLowerCase();
}

function moduleHref(projectId: string, module: ProjectOverviewModule): string {
  switch (module) {
    case "wiki":
      return `/projects/${projectId}/wiki`;
    case "documents":
      return `/projects/${projectId}/documents`;
    case "code":
      return `/projects/${projectId}/code`;
    case "tasks":
      return `/projects/${projectId}/tasks`;
    case "meetings":
      return `/projects/${projectId}/meetings`;
    default:
      return `/projects/${projectId}`;
  }
}

function activityModule(action: string, entityType: string): ProjectOverviewModule {
  if (action.startsWith("wiki.") || entityType.startsWith("wiki")) {
    return "wiki";
  }
  if (action.startsWith("document.") || entityType.startsWith("document")) {
    return "documents";
  }
  if (action.startsWith("project.repository")) {
    return "code";
  }
  if (action.startsWith("task.") || entityType === "task") {
    return "tasks";
  }
  if (action.startsWith("meeting.") || entityType === "meeting") {
    return "meetings";
  }
  return "project";
}

function activityTitle(action: string): string {
  const titles: Record<string, string> = {
    "document.create": "Document created",
    "document.delete": "Document deleted",
    "document.branch.create": "Document branch created",
    "document.version.create": "Document version added",
    "document.version.compile_queued": "Document compile queued",
    "document.version.latex_file.update": "LaTeX file updated",
    "wiki.page.create": "Wiki page created",
    "wiki.page.import": "Wiki pages imported",
    "wiki.page.draft.save": "Wiki draft saved",
    "wiki.page.publish": "Wiki page published",
    "wiki.page.delete": "Wiki page deleted",
    "wiki.asset.upload": "Wiki asset uploaded",
    "project.repository.provision": "Repository provisioned",
    "project.repository.branch.create": "Repository branch created",
    "project.repository.merge_request.create": "Merge request created",
    "task.create": "Task created",
    "task.update": "Task updated",
    "task.delete": "Task deleted",
    "task.dependency.add": "Task dependency added",
    "task.subtask.create": "Subtask created",
    "meeting.create": "Meeting created",
    "meeting.update": "Meeting updated",
    "meeting.delete": "Meeting deleted",
    "meeting.action.create": "Meeting action created",
    "meeting.action.link_task": "Meeting action linked to task",
    "project.member.add": "Project member added",
    "project.pin": "Project pinned",
    "project.unpin": "Project unpinned"
  };
  return titles[action] ?? action.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService,
    private readonly gitlabService: GitlabService
  ) {}

  async createProject(dto: CreateProjectDto, user: AuthenticatedUser): Promise<{
    id: string;
    key: string;
    name: string;
    description: string | null;
  }> {
    if (user.globalRole !== "admin") {
      throw new ForbiddenException("Only admins can create projects");
    }

    const key = dto.key.trim().toUpperCase();

    const existing = await this.prisma.project.findUnique({
      where: { key },
      select: { id: true }
    });

    if (existing) {
      throw new BadRequestException("Project key already exists");
    }

    const provisionedRepository = await this.gitlabService.provisionManagedRemoteRepository(key, dto.name);
    let project: {
      id: string;
      key: string;
      name: string;
      description: string | null;
    };

    try {
      project = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const createdProject = await tx.project.create({
          data: {
            key,
            name: dto.name,
            description: dto.description,
            createdById: user.userId,
            members: {
              create: {
                userId: user.userId,
                role: ProjectRole.EDITOR
              }
            }
          },
          select: {
            id: true,
            key: true,
            name: true,
            description: true
          }
        });

        await tx.projectRepository.create({
          data: {
            projectId: createdProject.id,
            gitlabProjectId: provisionedRepository.gitlabProjectId,
            pathWithNamespace: provisionedRepository.pathWithNamespace,
            webUrl: provisionedRepository.webUrl,
            defaultBranch: provisionedRepository.defaultBranch,
            connectedByUserId: user.userId
          }
        });

        return createdProject;
      });
    } catch (error) {
      await this.gitlabService.rollbackManagedRemoteProvision(provisionedRepository.gitlabProjectId);
      throw error;
    }

    try {
      await this.gitlabService.syncProjectRepositoryAccess(project.id);
    } catch (error) {
      await this.prisma.project.delete({
        where: {
          id: project.id
        }
      });
      await this.gitlabService.rollbackManagedRemoteProvision(provisionedRepository.gitlabProjectId);
      throw error;
    }

    await this.auditService.log({
      userId: user.userId,
      projectId: project.id,
      entityType: "project",
      entityId: project.id,
      action: "project.create"
    });
    await this.auditService.log({
      userId: user.userId,
      projectId: project.id,
      entityType: "project_repository",
      entityId: provisionedRepository.gitlabProjectId,
      action: "project.repository.provision",
      metadata: {
        gitlabProjectId: provisionedRepository.gitlabProjectId,
        pathWithNamespace: provisionedRepository.pathWithNamespace
      }
    });

    return project;
  }

  async deleteProject(projectId: string, user: AuthenticatedUser): Promise<{ id: string; deletedAt: string }> {
    if (user.globalRole !== "admin") {
      throw new ForbiddenException("Only admins can delete projects");
    }

    const deletedProject = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const project = await tx.project.findFirst({
        where: {
          id: projectId,
          deletedAt: null
        },
        select: {
          id: true
        }
      });

      if (!project) {
        throw new NotFoundException("Project not found");
      }

      return tx.project.update({
        where: {
          id: projectId
        },
        data: {
          deletedAt: new Date()
        },
        select: {
          id: true,
          deletedAt: true
        }
      });
    });

    try {
      await this.gitlabService.archiveManagedRepository(projectId);
      await this.gitlabService.syncProjectRepositoryAccess(projectId);
    } catch (error) {
      await this.prisma.project.update({
        where: {
          id: projectId
        },
        data: {
          deletedAt: null
        }
      });
      await this.gitlabService.unarchiveManagedRepository(projectId);
      throw error;
    }

    await this.auditService.log({
      userId: user.userId,
      projectId: deletedProject.id,
      entityType: "project",
      entityId: deletedProject.id,
      action: "project.delete"
    });

    const deletedAt = deletedProject.deletedAt;
    if (!deletedAt) {
      throw new Error("Project soft delete did not persist deletedAt");
    }

    return {
      id: deletedProject.id,
      deletedAt: deletedAt.toISOString()
    };
  }

  async listProjects(user: AuthenticatedUser): Promise<Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    createdAt: string;
    isPinned: boolean;
  }>> {
    const where = user.globalRole === "admin"
      ? { deletedAt: null }
      : {
          deletedAt: null,
          members: {
            some: {
              userId: user.userId
            }
          }
        };

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        createdAt: true,
        pinnedByUsers: {
          where: {
            userId: user.userId
          },
          select: {
            id: true
          }
        }
      }
    });

    return projects.map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt.toISOString(),
      isPinned: project.pinnedByUsers.length > 0
    }));
  }

  async getProjectAccess(projectId: string, user: AuthenticatedUser): Promise<{
    isAdmin: boolean;
    projectRole: "admin" | "editor" | "reader";
    canWrite: boolean;
  }> {
    return this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);
  }

  async getProjectOverview(projectId: string, user: AuthenticatedUser): Promise<ProjectOverview> {
    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);

    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null
      },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        repository: {
          select: {
            pathWithNamespace: true,
            defaultBranch: true,
            updatedAt: true
          }
        }
      }
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const monthStart = startOfUtcMonth(now);
    const nextMonthStart = endOfUtcMonth(now);
    const nextWeekEnd = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [documents, wikiPages, tasks, meetingsThisMonth, upcomingMeetings, openMeetingActions, auditLogs] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          projectId,
          deletedAt: null
        },
        orderBy: {
          updatedAt: "desc"
        },
        select: {
          id: true,
          title: true,
          type: true,
          updatedAt: true,
          versions: {
            where: {
              deletedAt: null,
              branch: {
                name: "main",
                deletedAt: null
              }
            },
            orderBy: {
              versionNumber: "desc"
            },
            take: 1,
            select: {
              compileStatus: true,
              createdAt: true
            }
          }
        }
      }),
      this.prisma.wikiPage.findMany({
        where: {
          projectId,
          deletedAt: null,
          ...(access.canWrite ? {} : { currentRevisionId: { not: null } })
        },
        orderBy: {
          updatedAt: "desc"
        },
        select: {
          id: true,
          title: true,
          path: true,
          currentRevisionId: true,
          updatedAt: true,
          draft: {
            select: {
              updatedAt: true
            }
          }
        }
      }),
      this.prisma.task.findMany({
        where: {
          projectId,
          deletedAt: null
        },
        orderBy: [
          {
            dueDate: "asc"
          },
          {
            updatedAt: "desc"
          }
        ],
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          updatedAt: true,
          assignee: {
            select: {
              name: true
            }
          }
        }
      }),
      this.prisma.meeting.findMany({
        where: {
          projectId,
          deletedAt: null,
          scheduledAt: {
            gte: monthStart,
            lt: nextMonthStart
          }
        },
        select: {
          id: true
        }
      }),
      this.prisma.meeting.findMany({
        where: {
          projectId,
          deletedAt: null,
          scheduledAt: {
            gte: todayStart,
            lt: nextWeekEnd
          }
        },
        orderBy: {
          scheduledAt: "asc"
        },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          location: true,
          actions: {
            where: {
              status: {
                notIn: [MeetingActionStatus.DONE, MeetingActionStatus.CANCELED]
              }
            },
            select: {
              id: true
            }
          }
        }
      }),
      this.prisma.meetingAction.count({
        where: {
          status: {
            notIn: [MeetingActionStatus.DONE, MeetingActionStatus.CANCELED]
          },
          meeting: {
            projectId,
            deletedAt: null
          }
        }
      }),
      this.prisma.auditLog.findMany({
        where: {
          projectId
        },
        orderBy: {
          createdAt: "desc"
        },
        take: ACTIVITY_LIMIT,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          action: true,
          createdAt: true
        }
      })
    ]);

    const failedDocuments = documents.filter((document) => {
      const status = document.versions[0]?.compileStatus;
      return status === CompileStatus.FAILED || status === CompileStatus.TIMEOUT;
    });
    const runningDocuments = documents.filter((document) => document.versions[0]?.compileStatus === CompileStatus.RUNNING);
    const openTasks = tasks.filter((task) => task.status !== TaskStatus.DONE);
    const inProgressTasks = tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS);
    const blockedTasks = tasks.filter((task) => task.status === TaskStatus.BLOCKED);
    const overdueTasks = openTasks.filter((task) => task.dueDate !== null && task.dueDate < todayStart);
    const criticalTasks = openTasks.filter((task) => task.priority === TaskPriority.CRITICAL);
    const criticalAttentionTasks = openTasks.filter(
      (task) => task.priority === TaskPriority.CRITICAL && task.status !== TaskStatus.BLOCKED && !overdueTasks.some((overdueTask) => overdueTask.id === task.id)
    );
    const nextTasks = [...openTasks]
      .sort((left, right) => {
        const leftTime = left.dueDate ? left.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.dueDate ? right.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .slice(0, 5);
    const writableWikiDrafts = access.canWrite
      ? wikiPages.filter((page) => page.currentRevisionId === null || page.draft !== null)
      : [];
    const publishedWikiPages = wikiPages.filter((page) => page.currentRevisionId !== null);

    const attention: ProjectOverviewAttentionItem[] = [];
    if (!project.repository) {
      attention.push({
        id: "repository-missing",
        severity: "danger",
        module: "code",
        title: "Repository is not provisioned",
        detail: "Code workspace needs a managed GitLab repository before project code can be traced.",
        href: moduleHref(projectId, "code"),
        date: null
      });
    }

    for (const document of failedDocuments.slice(0, 3)) {
      const status = document.versions[0]?.compileStatus === CompileStatus.TIMEOUT ? "timed out" : "failed";
      attention.push({
        id: `document-compile-${document.id}`,
        severity: "danger",
        module: "documents",
        title: `${document.title} compile ${status}`,
        detail: "Open the document workspace to inspect logs and regenerate the PDF.",
        href: `/projects/${projectId}/documents/${document.id}`,
        date: document.updatedAt.toISOString()
      });
    }

    for (const task of overdueTasks.slice(0, 3)) {
      attention.push({
        id: `task-overdue-${task.id}`,
        severity: "danger",
        module: "tasks",
        title: `${task.title} is overdue`,
        detail: task.assignee?.name ? `Assigned to ${task.assignee.name}.` : "No assignee is set.",
        href: moduleHref(projectId, "tasks"),
        date: toIso(task.dueDate)
      });
    }

    for (const task of blockedTasks.slice(0, 2)) {
      attention.push({
        id: `task-blocked-${task.id}`,
        severity: "warning",
        module: "tasks",
        title: `${task.title} is blocked`,
        detail: task.assignee?.name ? `Assigned to ${task.assignee.name}.` : "Review dependencies before continuing.",
        href: moduleHref(projectId, "tasks"),
        date: toIso(task.updatedAt)
      });
    }

    for (const task of criticalAttentionTasks.slice(0, 2)) {
      attention.push({
        id: `task-critical-${task.id}`,
        severity: "warning",
        module: "tasks",
        title: `${task.title} is critical`,
        detail: task.dueDate ? `Due ${toDayKey(task.dueDate)}.` : "Critical task without a due date.",
        href: moduleHref(projectId, "tasks"),
        date: toIso(task.dueDate ?? task.updatedAt)
      });
    }

    if (writableWikiDrafts.length > 0) {
      attention.push({
        id: "wiki-drafts",
        severity: "warning",
        module: "wiki",
        title: `${writableWikiDrafts.length} wiki page${writableWikiDrafts.length === 1 ? "" : "s"} need review`,
        detail: "Draft or unpublished knowledge should be reviewed so the archive stays traceable.",
        href: moduleHref(projectId, "wiki"),
        date: toIso(writableWikiDrafts[0]?.draft?.updatedAt ?? writableWikiDrafts[0]?.updatedAt)
      });
    }

    for (const meeting of upcomingMeetings.slice(0, 2)) {
      attention.push({
        id: `meeting-upcoming-${meeting.id}`,
        severity: "info",
        module: "meetings",
        title: `${meeting.title} is scheduled`,
        detail: meeting.location ? `Location: ${meeting.location}.` : "Review agenda and actions before the session.",
        href: `/projects/${projectId}/meetings?view=calendar&date=${toDayKey(meeting.scheduledAt)}`,
        date: meeting.scheduledAt.toISOString()
      });
    }

    const orderedAttention = attention
      .sort((left, right) => {
        const severityDelta = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
        if (severityDelta !== 0) {
          return severityDelta;
        }
        const leftTime = left.date ? Date.parse(left.date) : Number.MAX_SAFE_INTEGER;
        const rightTime = right.date ? Date.parse(right.date) : Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.title.localeCompare(right.title);
      })
      .slice(0, ATTENTION_LIMIT);

    return {
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString()
      },
      access,
      attention: orderedAttention,
      modules: {
        wiki: {
          publishedPages: publishedWikiPages.length,
          draftPages: access.canWrite ? writableWikiDrafts.length : 0,
          latestUpdatedAt: toIso(wikiPages[0]?.updatedAt),
          recentPages: wikiPages.slice(0, 3).map((page) => ({
            id: page.id,
            title: page.title,
            path: page.path,
            updatedAt: page.updatedAt.toISOString(),
            isDraft: page.currentRevisionId === null || page.draft !== null
          }))
        },
        documents: {
          total: documents.length,
          failedCompiles: failedDocuments.length,
          runningCompiles: runningDocuments.length,
          latestUpdatedAt: toIso(documents[0]?.updatedAt),
          recent: documents.slice(0, 3).map((document) => ({
            id: document.id,
            title: document.title,
            type: mapDocumentType(document.type),
            updatedAt: document.updatedAt.toISOString(),
            compileStatus: mapCompileStatus(document.versions[0]?.compileStatus)
          }))
        },
        code: {
          connected: Boolean(project.repository),
          pathWithNamespace: project.repository?.pathWithNamespace ?? null,
          defaultBranch: project.repository?.defaultBranch ?? null,
          lastActivityAt: toIso(project.repository?.updatedAt)
        },
        tasks: {
          open: openTasks.length,
          inProgress: inProgressTasks.length,
          blocked: blockedTasks.length,
          overdue: overdueTasks.length,
          critical: criticalTasks.length,
          next: nextTasks.map((task) => ({
            id: task.id,
            title: task.title,
            priority: mapTaskPriority(task.priority),
            status: mapTaskStatus(task.status),
            dueDate: toIso(task.dueDate),
            assigneeName: task.assignee?.name ?? null
          }))
        },
        meetings: {
          thisMonth: meetingsThisMonth.length,
          upcoming: upcomingMeetings.length,
          openActions: openMeetingActions,
          next: upcomingMeetings.slice(0, 5).map((meeting) => ({
            id: meeting.id,
            title: meeting.title,
            scheduledAt: meeting.scheduledAt.toISOString(),
            scheduledDate: toDayKey(meeting.scheduledAt),
            location: meeting.location,
            actionsCount: meeting.actions.length
          }))
        }
      },
      activity: auditLogs.map((entry) => {
        const module = activityModule(entry.action, entry.entityType);
        return {
          id: entry.id,
          module,
          title: activityTitle(entry.action),
          detail: `${entry.entityType} ${entry.entityId}`,
          href: moduleHref(projectId, module),
          occurredAt: entry.createdAt.toISOString()
        };
      })
    };
  }

  async pinProject(projectId: string, user: AuthenticatedUser): Promise<{ projectId: string; pinned: true; pinnedAt: string }> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const pinned = await this.prisma.userPinnedProject.upsert({
      where: {
        userId_projectId: {
          userId: user.userId,
          projectId
        }
      },
      create: {
        userId: user.userId,
        projectId
      },
      update: {},
      select: {
        projectId: true,
        createdAt: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_pin",
      entityId: `${projectId}:${user.userId}`,
      action: "project.pin"
    });

    return {
      projectId: pinned.projectId,
      pinned: true,
      pinnedAt: pinned.createdAt.toISOString()
    };
  }

  async unpinProject(projectId: string, user: AuthenticatedUser): Promise<{ projectId: string; pinned: false }> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    await this.prisma.userPinnedProject.deleteMany({
      where: {
        userId: user.userId,
        projectId
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_pin",
      entityId: `${projectId}:${user.userId}`,
      action: "project.unpin"
    });

    return {
      projectId,
      pinned: false
    };
  }

  async listMembers(projectId: string, user: AuthenticatedUser): Promise<Array<{ userId: string; name: string; email: string }>> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        user: {
          deletedAt: null
        }
      },
      orderBy: {
        createdAt: "asc"
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

    return members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email
    }));
  }

  async addMember(projectId: string, dto: AddProjectMemberDto, user: AuthenticatedUser): Promise<{ projectId: string; userId: string }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    const member = dto.userId
      ? await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } })
      : await this.prisma.user.findUnique({ where: { email: dto.email?.toLowerCase() }, select: { id: true } });

    if (!member) {
      throw new NotFoundException("User not found");
    }

    const projectMember = await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId,
          userId: member.id
        }
      },
      create: {
        projectId,
        userId: member.id,
        role: ProjectRole.READER
      },
      update: {},
      select: {
        projectId: true,
        userId: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "project_member",
      entityId: `${projectId}:${member.id}`,
      action: "project.member.add"
    });

    await this.gitlabService.syncProjectRepositoryAccess(projectId);

    return projectMember;
  }
}
