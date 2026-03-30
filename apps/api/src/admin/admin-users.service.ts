import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { GlobalRole, Prisma, type Project, type User } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { apiRoleToPrismaRole, prismaRoleToApiRole } from "../common/role-map";
import { getDocumentsCollaborationServer } from "../documents/collaboration-server-registry";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

type UserSummaryRecord = Pick<User, "id" | "name" | "email" | "isActive" | "createdAt" | "globalRole"> & {
  projectMemberships: Array<{
    project: Pick<Project, "id" | "key" | "name">;
  }>;
};

export type AdminUserSummary = {
  id: string;
  name: string;
  email: string;
  globalRole: "admin" | "editor" | "reader";
  isActive: boolean;
  createdAt: string;
  projectAccessMode: "all_projects" | "selected_projects";
  projects: Array<{ id: string; key: string; name: string }>;
};

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  async listUsers(user: AuthenticatedUser): Promise<AdminUserSummary[]> {
    this.ensureAdminActor(user);

    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true
      },
      orderBy: [
        { name: "asc" },
        { email: "asc" }
      ],
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

    return users.map((targetUser) => this.mapUserSummary(targetUser));
  }

  async updateUser(userId: string, dto: UpdateAdminUserDto, actor: AuthenticatedUser): Promise<AdminUserSummary> {
    this.ensureAdminActor(actor);

    const nextRole = apiRoleToPrismaRole(dto.globalRole);
    const normalizedProjectIds = this.normalizeProjectIds(dto.projectIds);

    const updatedUser = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const targetUser = await tx.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
          isActive: true
        },
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

      if (!targetUser) {
        throw new NotFoundException("User not found");
      }

      if (targetUser.globalRole === GlobalRole.ADMIN && nextRole !== GlobalRole.ADMIN) {
        await this.ensureAdminWillRemain(tx, targetUser.id);
      }

      if (nextRole !== GlobalRole.ADMIN) {
        await this.ensureProjectsExist(tx, normalizedProjectIds);
        await tx.projectMember.deleteMany({
          where: {
            userId: targetUser.id
          }
        });

        if (normalizedProjectIds.length > 0) {
          await tx.projectMember.createMany({
            data: normalizedProjectIds.map((projectId) => ({
              projectId,
              userId: targetUser.id
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

      if (!refreshedUser) {
        throw new NotFoundException("User not found");
      }

      return {
        refreshedUser,
        roleChanged
      };
    });

    await this.auditService.log({
      userId: actor.userId,
      entityType: "user",
      entityId: userId,
      action: "user.update",
      metadata: {
        globalRole: dto.globalRole,
        projectIds: dto.globalRole === "admin" ? [] : normalizedProjectIds
      }
    });

    this.disconnectUser(userId, "Permissions updated by an administrator");

    return this.mapUserSummary(updatedUser.refreshedUser);
  }

  async deleteUser(userId: string, actor: AuthenticatedUser): Promise<{ id: string; deletedAt: string }> {
    this.ensureAdminActor(actor);

    if (userId === actor.userId) {
      throw new ForbiddenException("Admins cannot delete their own account");
    }

    const deletedUser = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const targetUser = await tx.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
          isActive: true
        },
        select: {
          id: true,
          globalRole: true
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

      return tx.user.update({
        where: {
          id: targetUser.id
        },
        data: {
          isActive: false,
          deletedAt: new Date()
        },
        select: {
          id: true,
          deletedAt: true
        }
      });
    });

    await this.auditService.log({
      userId: actor.userId,
      entityType: "user",
      entityId: deletedUser.id,
      action: "user.delete"
    });

    this.disconnectUser(userId, "Account removed by an administrator");

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

  private normalizeProjectIds(projectIds: string[] | undefined): string[] {
    return Array.from(
      new Set(
        (projectIds ?? [])
          .map((projectId) => projectId.trim())
          .filter((projectId) => projectId.length > 0)
      )
    );
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
        name: membership.project.name
      }))
    };
  }
}
