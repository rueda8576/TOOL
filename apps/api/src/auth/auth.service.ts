import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { InviteAccessMode, InviteStatus, NotificationEventType, NotificationStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { JwtService } from "@nestjs/jwt";

import { AuditService } from "../audit/audit.service";
import { generateSecureToken, hashValue } from "../common/crypto";
import { apiRoleToPrismaRole, pickHigherRole, prismaRoleToApiRole } from "../common/role-map";
import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queues/queue.service";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import { InviteDto } from "./dto/invite.dto";
import { LoginDto } from "./dto/login.dto";
import { PasswordResetDto } from "./dto/password-reset.dto";

@Injectable()
export class AuthService {
  private readonly appBaseUrl = getEnv().APP_BASE_URL.replace(/\/+$/, "");

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly queueService: QueueService,
    private readonly auditService: AuditService
  ) {}

  async login(dto: LoginDto): Promise<{
    token: string;
    expiresAt: Date;
    user: { id: string; email: string; name: string; globalRole: "admin" | "editor" | "reader" };
  }> {
    const email = dto.email.toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
        isActive: true
      }
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const validPassword = await bcrypt.compare(dto.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: prismaRoleToApiRole(user.globalRole)
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashValue(token),
        expiresAt
      }
    });

    await this.auditService.log({
      userId: user.id,
      entityType: "session",
      entityId: user.id,
      action: "auth.login"
    });

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        globalRole: prismaRoleToApiRole(user.globalRole)
      }
    };
  }

  async invite(dto: InviteDto, senderId: string): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
    const token = generateSecureToken(24);
    const tokenHash = hashValue(token);
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? 7) * 24 * 60 * 60 * 1000);
    const access = await this.resolveInviteAccess(dto);
    const canonicalRole = dto.globalRole ?? "reader";

    const invite = await this.prisma.invite.create({
      data: {
        email: dto.email.toLowerCase(),
        tokenHash,
        senderId,
        accessMode: access.accessMode,
        projectId: access.projectIds.length === 1 ? access.projectIds[0] : undefined,
        inviteProjects:
          access.projectIds.length > 0
            ? {
                create: access.projectIds.map((projectId) => ({ projectId }))
              }
            : undefined,
        globalRole: apiRoleToPrismaRole(canonicalRole),
        status: InviteStatus.PENDING,
        expiresAt
      }
    });

    const inviteUrl = `${this.appBaseUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    const scopeSummary =
      access.accessMode === InviteAccessMode.ALL_CURRENT_PROJECTS
        ? "all current projects at acceptance time"
        : access.projects.map((project) => `${project.key} - ${project.name}`).join(", ");

    await this.queueService.enqueueEmail({
      directEmail: {
        to: invite.email,
        subject: "Atlasium invitation",
        text: [
          "You have been invited to Atlasium.",
          "",
          `Accept invite: ${inviteUrl}`,
          `Access scope: ${scopeSummary}`,
          "",
          `Invite token: ${token}`,
          `Expires at: ${expiresAt.toISOString()}`,
          "",
          "You can also accept manually with POST /auth/accept-invite."
        ].join("\n")
      }
    });

    await this.auditService.log({
      userId: senderId,
      projectId: access.projectIds.length === 1 ? access.projectIds[0] : undefined,
      entityType: "invite",
      entityId: invite.id,
      action: "auth.invite.create",
      metadata: {
        email: invite.email,
        role: canonicalRole,
        accessMode: access.accessMode,
        projectIds: access.projectIds
      }
    });

    return {
      inviteId: invite.id,
      token,
      expiresAt
    };
  }

  async acceptInvite(dto: AcceptInviteDto): Promise<{
    token: string;
    userId: string;
    projectId?: string | null;
    projectIds: string[];
  }> {
    const now = new Date();
    const invite = await this.prisma.invite.findFirst({
      where: {
        tokenHash: hashValue(dto.token),
        status: InviteStatus.PENDING
      },
      include: {
        inviteProjects: {
          select: {
            projectId: true
          }
        }
      }
    });

    if (!invite || invite.expiresAt < now) {
      throw new BadRequestException("Invite token is invalid or expired");
    }

    let user = await this.prisma.user.findUnique({
      where: { email: invite.email }
    });

    const invitedRole = prismaRoleToApiRole(invite.globalRole);

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          name: dto.name,
          passwordHash: await bcrypt.hash(dto.password, 10),
          globalRole: invite.globalRole
        }
      });

      await this.prisma.notificationPreference.create({
        data: {
          userId: user.id
        }
      });
    } else {
      const mergedRole = pickHigherRole(prismaRoleToApiRole(user.globalRole), invitedRole);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          name: dto.name,
          globalRole: apiRoleToPrismaRole(mergedRole)
        }
      });
    }

    const targetProjectIds = await this.resolveInviteProjectAssignments(invite);
    if (targetProjectIds.length > 0) {
      await this.prisma.$transaction(
        targetProjectIds.map((projectId) =>
          this.prisma.projectMember.upsert({
            where: {
              projectId_userId: {
                projectId,
                userId: user.id
              }
            },
            create: {
              projectId,
              userId: user.id
            },
            update: {}
          })
        )
      );
    }

    await this.prisma.invite.update({
      where: { id: invite.id },
      data: {
        status: InviteStatus.ACCEPTED,
        acceptedById: user.id,
        acceptedAt: now
      }
    });

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: prismaRoleToApiRole(user.globalRole)
    });

    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashValue(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    await this.auditService.log({
      userId: user.id,
      projectId: targetProjectIds[0] ?? invite.projectId ?? undefined,
      entityType: "invite",
      entityId: invite.id,
      action: "auth.invite.accept",
      metadata: {
        accessMode: invite.accessMode,
        projectIds: targetProjectIds
      }
    });

    return { token, userId: user.id, projectId: invite.projectId, projectIds: targetProjectIds };
  }

  async requestPasswordReset(dto: PasswordResetDto): Promise<{ accepted: true }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true }
    });

    if (!user) {
      return { accepted: true };
    }

    const resetToken = generateSecureToken(20);

    const event = await this.prisma.notificationEvent.create({
      data: {
        userId: user.id,
        type: NotificationEventType.PASSWORD_RESET,
        status: NotificationStatus.PENDING,
        payload: {
          template: "password-reset",
          resetToken
        }
      }
    });

    await this.queueService.enqueueEmail({ notificationEventId: event.id });

    await this.auditService.log({
      userId: user.id,
      entityType: "user",
      entityId: user.id,
      action: "auth.password.reset_requested"
    });

    return { accepted: true };
  }

  private async resolveInviteAccess(dto: InviteDto): Promise<{
    accessMode: InviteAccessMode;
    projectIds: string[];
    projects: Array<{ id: string; key: string; name: string }>;
  }> {
    const legacyProjectId = dto.projectId?.trim();
    const projectIds = Array.from(new Set((dto.projectIds ?? []).map((projectId) => projectId.trim()).filter(Boolean)));

    if (dto.accessMode === "all") {
      if (legacyProjectId || projectIds.length > 0) {
        throw new BadRequestException("accessMode 'all' does not accept projectId or projectIds");
      }

      return {
        accessMode: InviteAccessMode.ALL_CURRENT_PROJECTS,
        projectIds: [],
        projects: []
      };
    }

    const selectedProjectIds = [...projectIds];
    if (legacyProjectId && !selectedProjectIds.includes(legacyProjectId)) {
      selectedProjectIds.push(legacyProjectId);
    }

    if (dto.accessMode === "selected" && selectedProjectIds.length === 0) {
      throw new BadRequestException("projectIds must contain at least one project when accessMode is 'selected'");
    }

    if (!dto.accessMode && selectedProjectIds.length === 0) {
      throw new BadRequestException("accessMode is required and must be either 'all' or 'selected'");
    }

    if (selectedProjectIds.length === 0) {
      throw new BadRequestException("projectIds must contain at least one project");
    }

    const projects = await this.prisma.project.findMany({
      where: {
        id: { in: selectedProjectIds },
        deletedAt: null
      },
      select: {
        id: true,
        key: true,
        name: true
      }
    });

    if (projects.length !== selectedProjectIds.length) {
      throw new BadRequestException("One or more selected projects are missing or archived");
    }

    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const orderedProjects = selectedProjectIds.map((projectId) => projectsById.get(projectId)).filter(Boolean) as Array<{
      id: string;
      key: string;
      name: string;
    }>;

    return {
      accessMode: InviteAccessMode.SELECTED_PROJECTS,
      projectIds: selectedProjectIds,
      projects: orderedProjects
    };
  }

  private async resolveInviteProjectAssignments(invite: {
    accessMode: InviteAccessMode;
    projectId: string | null;
    inviteProjects: Array<{ projectId: string }>;
  }): Promise<string[]> {
    if (invite.accessMode === InviteAccessMode.ALL_CURRENT_PROJECTS) {
      const allProjects = await this.prisma.project.findMany({
        where: {
          deletedAt: null
        },
        select: {
          id: true
        }
      });

      return allProjects.map((project) => project.id);
    }

    const selectedProjectIds = Array.from(new Set(invite.inviteProjects.map((item) => item.projectId)));
    if (selectedProjectIds.length === 0 && invite.projectId) {
      selectedProjectIds.push(invite.projectId);
    }
    if (selectedProjectIds.length === 0) {
      return [];
    }

    const activeProjects = await this.prisma.project.findMany({
      where: {
        id: { in: selectedProjectIds },
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    const activeProjectIds = new Set(activeProjects.map((project) => project.id));
    return selectedProjectIds.filter((projectId) => activeProjectIds.has(projectId));
  }
}
