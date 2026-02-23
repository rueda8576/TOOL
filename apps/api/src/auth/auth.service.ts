import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { InviteStatus, NotificationEventType, NotificationStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { JwtService } from "@nestjs/jwt";

import { AuditService } from "../audit/audit.service";
import { generateSecureToken, hashValue } from "../common/crypto";
import { apiRoleToPrismaRole, pickHigherRole, prismaRoleToApiRole } from "../common/role-map";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queues/queue.service";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import { InviteDto } from "./dto/invite.dto";
import { LoginDto } from "./dto/login.dto";
import { PasswordResetDto } from "./dto/password-reset.dto";

@Injectable()
export class AuthService {
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

    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, deletedAt: null },
        select: { id: true }
      });

      if (!project) {
        throw new BadRequestException("Project not found");
      }
    }

    const invite = await this.prisma.invite.create({
      data: {
        email: dto.email.toLowerCase(),
        tokenHash,
        senderId,
        projectId: dto.projectId,
        globalRole: apiRoleToPrismaRole(dto.globalRole ?? "reader"),
        status: InviteStatus.PENDING,
        expiresAt
      }
    });

    await this.queueService.enqueueEmail({
      directEmail: {
        to: invite.email,
        subject: "Doctoral Platform invitation",
        text: [
          "You have been invited to Doctoral Platform.",
          "",
          `Invite token: ${token}`,
          `Expires at: ${expiresAt.toISOString()}`,
          "",
          "Use this token in POST /auth/accept-invite."
        ].join("\n")
      }
    });

    await this.auditService.log({
      userId: senderId,
      projectId: dto.projectId,
      entityType: "invite",
      entityId: invite.id,
      action: "auth.invite.create",
      metadata: { email: invite.email, role: dto.globalRole ?? "reader" }
    });

    return {
      inviteId: invite.id,
      token,
      expiresAt
    };
  }

  async acceptInvite(dto: AcceptInviteDto): Promise<{ token: string; userId: string; projectId?: string | null }> {
    const now = new Date();
    const invite = await this.prisma.invite.findFirst({
      where: {
        tokenHash: hashValue(dto.token),
        status: InviteStatus.PENDING
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

    if (invite.projectId) {
      await this.prisma.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: invite.projectId,
            userId: user.id
          }
        },
        create: {
          projectId: invite.projectId,
          userId: user.id
        },
        update: {}
      });
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
      projectId: invite.projectId ?? undefined,
      entityType: "invite",
      entityId: invite.id,
      action: "auth.invite.accept"
    });

    return { token, userId: user.id, projectId: invite.projectId };
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
}
