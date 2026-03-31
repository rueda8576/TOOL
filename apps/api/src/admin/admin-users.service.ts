import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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

  async deleteUser(userId: string, actor: AuthenticatedUser): Promise<{ id: string; deletedAt: string }> {
    this.ensureAdminActor(actor);

    if (userId === actor.userId) {
      throw new ForbiddenException("Admins cannot delete their own account");
    }

    const { deletedUser, previousProjectIds } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
      deletedAt: deletedUser.deletedAt.toISOString()
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

    return repositories.map((repository) => repository.projectId);
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
