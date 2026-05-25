import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { GlobalRole, Prisma, ProjectRole } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { apiRoleToPrismaRole, prismaRoleToApiRole } from "../common/role-map";
import { getDocumentsCollaborationServer } from "../documents/collaboration-server-registry";
import { GitlabService } from "../gitlab/gitlab.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateAdminUserDto, UpdateAdminUserProjectAccessDto } from "./dto/update-admin-user.dto";

const adminUserSummaryArgs = Prisma.validator<Prisma.UserDefaultArgs>()({
  select: {
    id: true,
    name: true,
    email: true,
    isActive: true,
    createdAt: true,
    globalRole: true,
    projectMemberships: {
      where: {
        project: {
          deletedAt: null
        }
      },
      orderBy: {
        project: {
          key: "asc"
        }
      },
      select: {
        role: true,
        project: {
          select: {
            id: true,
            key: true,
            name: true
          }
        }
      }
    }
  }
});

type UserSummaryRecord = Prisma.UserGetPayload<typeof adminUserSummaryArgs>;

type DeleteTargetRecord = {
  id: string;
  globalRole: GlobalRole;
  projectMemberships: Array<{ projectId: string }>;
};

type AdminUsersQueryClient = Pick<
  Prisma.TransactionClient,
  | "user"
  | "project"
  | "projectRepository"
  | "document"
  | "documentBranch"
  | "documentVersion"
  | "wikiPage"
  | "wikiRevision"
  | "wikiDraft"
  | "wikiAsset"
  | "task"
  | "taskDependency"
  | "meeting"
  | "invite"
>;

export type AdminUserSummary = {
  id: string;
  name: string;
  email: string;
  globalRole: "admin" | "editor" | "reader";
  isActive: boolean;
  createdAt: string;
  projectAccessMode: "all_projects" | "selected_projects";
  projects: Array<{ id: string; key: string; name: string; role: "editor" | "reader" }>;
};

export type AdminUserDeleteMode = "soft" | "hard";

export type AdminUserHardDeleteBlockerCode =
  | "self_delete_forbidden"
  | "last_active_admin"
  | "projects_created"
  | "connected_project_repositories"
  | "documents_created"
  | "document_branches_created"
  | "document_versions_created"
  | "wiki_pages_created"
  | "wiki_revisions_created"
  | "wiki_drafts_updated"
  | "wiki_assets_uploaded"
  | "tasks_created"
  | "task_dependencies_created"
  | "meetings_created"
  | "invites_sent";

export type AdminUserHardDeleteBlocker = {
  code: AdminUserHardDeleteBlockerCode;
  label: string;
  count: number;
};

export type AdminUserHardDeleteCheck = {
  userId: string;
  allowed: boolean;
  blockers: AdminUserHardDeleteBlocker[];
};

export type AdminUserDeleteResult = {
  id: string;
  mode: AdminUserDeleteMode;
  deletedAt: string | null;
};

const HARD_DELETE_BLOCKER_LABELS: Record<AdminUserHardDeleteBlockerCode, string> = {
  self_delete_forbidden: "Admins cannot hard delete their own account",
  last_active_admin: "At least one active admin must remain",
  projects_created: "Created projects",
  connected_project_repositories: "Connected project repositories",
  documents_created: "Created documents",
  document_branches_created: "Created document branches",
  document_versions_created: "Created document versions",
  wiki_pages_created: "Created wiki pages",
  wiki_revisions_created: "Published wiki revisions",
  wiki_drafts_updated: "Updated wiki drafts",
  wiki_assets_uploaded: "Uploaded wiki assets",
  tasks_created: "Created tasks",
  task_dependencies_created: "Created task dependencies",
  meetings_created: "Created meetings",
  invites_sent: "Sent invites"
};

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly gitlabService: GitlabService
  ) {}

  async listUsers(user: AuthenticatedUser): Promise<AdminUserSummary[]> {
    this.ensureAdminActor(user);

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true
      },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      ...adminUserSummaryArgs
    });

    return users.map((targetUser) => this.mapUserSummary(targetUser));
  }

  async updateUser(userId: string, dto: UpdateAdminUserDto, actor: AuthenticatedUser): Promise<AdminUserSummary> {
    this.ensureAdminActor(actor);

    const nextRole = apiRoleToPrismaRole(dto.globalRole);
    const normalizedProjectAccess = this.normalizeProjectAccess(dto.projectAccess);

    const { updatedUser, previousProjectIds, previousRole } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const targetUser = await tx.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
          isActive: true
        },
        ...adminUserSummaryArgs
      });

      if (!targetUser) {
        throw new NotFoundException("User not found");
      }

      const previousProjectIds = targetUser.projectMemberships.map((membership) => membership.project.id);

      if (targetUser.globalRole === GlobalRole.ADMIN && nextRole !== GlobalRole.ADMIN) {
        await this.ensureAdminWillRemain(tx, targetUser.id);
      }

      if (nextRole !== GlobalRole.ADMIN) {
        await this.ensureProjectsExist(
          tx,
          normalizedProjectAccess.map((projectAccess) => projectAccess.projectId)
        );
        await tx.projectMember.deleteMany({
          where: {
            userId: targetUser.id
          }
        });

        if (normalizedProjectAccess.length > 0) {
          await tx.projectMember.createMany({
            data: normalizedProjectAccess.map((projectAccess) => ({
              projectId: projectAccess.projectId,
              userId: targetUser.id,
              role: projectAccess.role
            })),
            skipDuplicates: true
          });
        }
      }

      const roleChanged = targetUser.globalRole !== nextRole;

      await tx.user.update({
        where: {
          id: targetUser.id
        },
        data: {
          globalRole: nextRole
        }
      });

      if (roleChanged) {
        await tx.session.deleteMany({
          where: {
            userId: targetUser.id
          }
        });
      }

      const refreshedUser = await tx.user.findUnique({
        where: {
          id: targetUser.id
        },
        ...adminUserSummaryArgs
      });

      if (!refreshedUser) {
        throw new NotFoundException("User not found");
      }

      return {
        updatedUser: refreshedUser,
        previousProjectIds,
        previousRole: targetUser.globalRole
      };
    });

    await this.auditService.log({
      userId: actor.userId,
      entityType: "user",
      entityId: userId,
      action: "user.update",
      metadata: {
        globalRole: dto.globalRole,
        projectAccess:
          dto.globalRole === "admin"
            ? []
            : normalizedProjectAccess.map((projectAccess) => ({
                projectId: projectAccess.projectId,
                role: this.projectRoleToApi(projectAccess.role)
              }))
      }
    });

    this.disconnectUser(userId, "Permissions updated by an administrator");
    await this.syncAffectedRepositories(
      previousRole,
      updatedUser.globalRole,
      previousProjectIds,
      normalizedProjectAccess.map((entry) => entry.projectId)
    );

    return this.mapUserSummary(updatedUser);
  }

  async getHardDeleteCheck(userId: string, actor: AuthenticatedUser): Promise<AdminUserHardDeleteCheck> {
    this.ensureAdminActor(actor);

    const targetUser = await this.findDeleteTarget(this.prisma, userId);
    return this.buildHardDeleteCheck(this.prisma, targetUser, actor.userId);
  }

  async deleteUser(
    userId: string,
    actor: AuthenticatedUser,
    mode: AdminUserDeleteMode = "soft"
  ): Promise<AdminUserDeleteResult> {
    this.ensureAdminActor(actor);

    if (userId === actor.userId) {
      throw new ForbiddenException("Admins cannot delete their own account");
    }

    return mode === "hard" ? this.hardDeleteUser(userId, actor) : this.softDeleteUser(userId, actor);
  }

  private async softDeleteUser(userId: string, actor: AuthenticatedUser): Promise<AdminUserDeleteResult> {
    const { deletedUser, previousProjectIds } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const targetUser = await this.findDeleteTarget(tx, userId);

      if (targetUser.globalRole === GlobalRole.ADMIN) {
        await this.ensureAdminWillRemain(tx, targetUser.id);
      }

      await tx.session.deleteMany({
        where: {
          userId: targetUser.id
        }
      });
      await tx.projectMember.deleteMany({
        where: {
          userId: targetUser.id
        }
      });
      await tx.userPinnedProject.deleteMany({
        where: {
          userId: targetUser.id
        }
      });
      await tx.gitLabConnection.deleteMany({
        where: {
          userId: targetUser.id
        }
      });

      const deletedUser = await tx.user.update({
        where: {
          id: targetUser.id
        },
        data: {
          isActive: false,
          deletedAt: new Date()
        },
        select: {
          id: true,
          deletedAt: true,
          globalRole: true
        }
      });

      return {
        deletedUser,
        previousProjectIds: targetUser.projectMemberships.map((membership) => membership.projectId)
      };
    });

    await this.auditService.log({
      userId: actor.userId,
      entityType: "user",
      entityId: deletedUser.id,
      action: "user.delete"
    });

    this.disconnectUser(userId, "Account removed by an administrator");
    await this.syncAffectedRepositories(
      deletedUser.globalRole,
      deletedUser.globalRole,
      previousProjectIds,
      []
    );

    if (!deletedUser.deletedAt) {
      throw new Error("User soft delete did not persist deletedAt");
    }

    return {
      id: deletedUser.id,
      mode: "soft",
      deletedAt: deletedUser.deletedAt.toISOString()
    };
  }

  private async hardDeleteUser(userId: string, actor: AuthenticatedUser): Promise<AdminUserDeleteResult> {
    const { deletedUser, previousProjectIds } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const targetUser = await this.findDeleteTarget(tx, userId);
      const check = await this.buildHardDeleteCheck(tx, targetUser, actor.userId);

      if (!check.allowed) {
        throw new ConflictException({
          message: "Hard delete is not allowed for this user",
          blockers: check.blockers
        });
      }

      await tx.session.deleteMany({
        where: {
          userId: targetUser.id
        }
      });
      await tx.projectMember.deleteMany({
        where: {
          userId: targetUser.id
        }
      });
      await tx.userPinnedProject.deleteMany({
        where: {
          userId: targetUser.id
        }
      });
      await tx.gitLabConnection.deleteMany({
        where: {
          userId: targetUser.id
        }
      });

      const deletedUser = await tx.user.delete({
        where: {
          id: targetUser.id
        },
        select: {
          id: true,
          globalRole: true
        }
      });

      return {
        deletedUser,
        previousProjectIds: targetUser.projectMemberships.map((membership) => membership.projectId)
      };
    });

    await this.auditService.log({
      userId: actor.userId,
      entityType: "user",
      entityId: deletedUser.id,
      action: "user.hard_delete"
    });

    this.disconnectUser(userId, "Account permanently removed by an administrator");
    await this.syncAffectedRepositories(
      deletedUser.globalRole,
      deletedUser.globalRole,
      previousProjectIds,
      []
    );

    return {
      id: deletedUser.id,
      mode: "hard",
      deletedAt: null
    };
  }

  private ensureAdminActor(actor: AuthenticatedUser): void {
    if (actor.globalRole !== "admin") {
      throw new ForbiddenException("Only admins can manage users");
    }
  }

  private normalizeProjectAccess(
    projectAccess: UpdateAdminUserProjectAccessDto[] | undefined
  ): Array<{ projectId: string; role: ProjectRole }> {
    const normalized = new Map<string, ProjectRole>();

    (projectAccess ?? []).forEach((entry) => {
      const projectId = entry.projectId.trim();
      if (!projectId) {
        return;
      }

      normalized.set(projectId, this.apiProjectRoleToPrisma(entry.role));
    });

    return Array.from(normalized.entries()).map(([projectId, role]) => ({
      projectId,
      role
    }));
  }

  private async ensureProjectsExist(tx: Prisma.TransactionClient, projectIds: string[]): Promise<void> {
    if (projectIds.length === 0) {
      return;
    }

    const projects = await tx.project.findMany({
      where: {
        id: {
          in: projectIds
        },
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (projects.length !== projectIds.length) {
      throw new BadRequestException("One or more selected projects no longer exist");
    }
  }

  private async ensureAdminWillRemain(tx: Prisma.TransactionClient, targetUserId: string): Promise<void> {
    const activeAdminCount = await tx.user.count({
      where: {
        deletedAt: null,
        isActive: true,
        globalRole: GlobalRole.ADMIN
      }
    });

    if (activeAdminCount <= 1) {
      throw new ForbiddenException("At least one active admin must remain");
    }

    const targetAdmin = await tx.user.findFirst({
      where: {
        id: targetUserId,
        deletedAt: null,
        isActive: true,
        globalRole: GlobalRole.ADMIN
      },
      select: {
        id: true
      }
    });

    if (!targetAdmin) {
      throw new ForbiddenException("Target admin is no longer active");
    }
  }

  private async findDeleteTarget(tx: AdminUsersQueryClient, userId: string): Promise<DeleteTargetRecord> {
    const targetUser = await tx.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        globalRole: true,
        projectMemberships: {
          select: {
            projectId: true
          }
        }
      }
    });

    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    return targetUser;
  }

  private async buildHardDeleteCheck(
    tx: AdminUsersQueryClient,
    targetUser: DeleteTargetRecord,
    actorUserId: string
  ): Promise<AdminUserHardDeleteCheck> {
    const blockers: AdminUserHardDeleteBlocker[] = [];

    if (targetUser.id === actorUserId) {
      blockers.push(this.createHardDeleteBlocker("self_delete_forbidden", 1));
    }

    if (targetUser.globalRole === GlobalRole.ADMIN) {
      const activeAdminCount = await tx.user.count({
        where: {
          deletedAt: null,
          isActive: true,
          globalRole: GlobalRole.ADMIN
        }
      });

      if (activeAdminCount <= 1) {
        blockers.push(this.createHardDeleteBlocker("last_active_admin", 1));
      }
    }

    const blockerCounts = await Promise.all([
      this.countHardDeleteBlocker(tx.project.count({ where: { createdById: targetUser.id } }), "projects_created"),
      this.countHardDeleteBlocker(
        tx.projectRepository.count({ where: { connectedByUserId: targetUser.id } }),
        "connected_project_repositories"
      ),
      this.countHardDeleteBlocker(tx.document.count({ where: { createdById: targetUser.id } }), "documents_created"),
      this.countHardDeleteBlocker(
        tx.documentBranch.count({ where: { createdById: targetUser.id } }),
        "document_branches_created"
      ),
      this.countHardDeleteBlocker(
        tx.documentVersion.count({ where: { createdById: targetUser.id } }),
        "document_versions_created"
      ),
      this.countHardDeleteBlocker(tx.wikiPage.count({ where: { createdById: targetUser.id } }), "wiki_pages_created"),
      this.countHardDeleteBlocker(
        tx.wikiRevision.count({ where: { createdById: targetUser.id } }),
        "wiki_revisions_created"
      ),
      this.countHardDeleteBlocker(tx.wikiDraft.count({ where: { updatedById: targetUser.id } }), "wiki_drafts_updated"),
      this.countHardDeleteBlocker(tx.wikiAsset.count({ where: { uploadedById: targetUser.id } }), "wiki_assets_uploaded"),
      this.countHardDeleteBlocker(tx.task.count({ where: { createdById: targetUser.id } }), "tasks_created"),
      this.countHardDeleteBlocker(
        tx.taskDependency.count({ where: { createdById: targetUser.id } }),
        "task_dependencies_created"
      ),
      this.countHardDeleteBlocker(tx.meeting.count({ where: { createdById: targetUser.id } }), "meetings_created"),
      this.countHardDeleteBlocker(tx.invite.count({ where: { senderId: targetUser.id } }), "invites_sent")
    ]);

    blockerCounts.forEach((blocker) => {
      if (blocker) {
        blockers.push(blocker);
      }
    });

    return {
      userId: targetUser.id,
      allowed: blockers.length === 0,
      blockers
    };
  }

  private async countHardDeleteBlocker(
    countPromise: Promise<number>,
    code: AdminUserHardDeleteBlockerCode
  ): Promise<AdminUserHardDeleteBlocker | null> {
    const count = await countPromise;
    if (count < 1) {
      return null;
    }

    return this.createHardDeleteBlocker(code, count);
  }

  private createHardDeleteBlocker(code: AdminUserHardDeleteBlockerCode, count: number): AdminUserHardDeleteBlocker {
    return {
      code,
      label: HARD_DELETE_BLOCKER_LABELS[code],
      count
    };
  }

  private disconnectUser(userId: string, reason: string): void {
    const collaborationServer = getDocumentsCollaborationServer();
    collaborationServer?.disconnectUser(userId, reason);
  }

  private async syncAffectedRepositories(
    previousRole: GlobalRole,
    nextRole: GlobalRole,
    previousProjectIds: string[],
    nextProjectIds: string[]
  ): Promise<void> {
    const affectedProjectIds = new Set([...previousProjectIds, ...nextProjectIds]);

    if (previousRole === GlobalRole.ADMIN || nextRole === GlobalRole.ADMIN) {
      const allProjectIds = await this.listRepositoryProjectIds();
      allProjectIds.forEach((projectId) => affectedProjectIds.add(projectId));
    }

    await Promise.all(Array.from(affectedProjectIds).map((projectId) => this.gitlabService.syncProjectRepositoryAccess(projectId)));
  }

  private async listRepositoryProjectIds(): Promise<string[]> {
    const repositories = await this.prisma.projectRepository.findMany({
      select: {
        projectId: true
      }
    });

    return Array.from(new Set(repositories.map((repository) => repository.projectId)));
  }

  private mapUserSummary(user: UserSummaryRecord): AdminUserSummary {
    if (user.globalRole === GlobalRole.ADMIN) {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        globalRole: "admin",
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        projectAccessMode: "all_projects",
        projects: []
      };
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      globalRole: prismaRoleToApiRole(user.globalRole),
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      projectAccessMode: "selected_projects",
      projects: user.projectMemberships.map((membership) => ({
        id: membership.project.id,
        key: membership.project.key,
        name: membership.project.name,
        role: this.projectRoleToApi(membership.role)
      }))
    };
  }

  private apiProjectRoleToPrisma(role: "editor" | "reader"): ProjectRole {
    return role === "editor" ? ProjectRole.EDITOR : ProjectRole.READER;
  }

  private projectRoleToApi(role: ProjectRole): "editor" | "reader" {
    return role === ProjectRole.EDITOR ? "editor" : "reader";
  }
}
