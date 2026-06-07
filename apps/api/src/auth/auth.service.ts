import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { GlobalRole, InviteAccessMode, InviteStatus, NotificationEventType, NotificationStatus, ProjectRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { JwtService } from "@nestjs/jwt";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { generateSecureToken, hashValue } from "../common/crypto";
import { apiRoleToPrismaRole, pickHigherRole, prismaRoleToApiRole } from "../common/role-map";
import { deriveUsernameFromEmail, validateAtlasiumUsername } from "../common/username";
import { getEnv } from "../config/env";
import { GitlabService } from "../gitlab/gitlab.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queues/queue.service";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { CreateGitlabSshKeyDto } from "./dto/create-gitlab-ssh-key.dto";
import { InviteDto } from "./dto/invite.dto";
import { LoginDto } from "./dto/login.dto";
import { PasswordResetDto } from "./dto/password-reset.dto";
import { SyncGitlabHttpsPasswordDto } from "./dto/sync-gitlab-https-password.dto";
import { UpdateUsernameDto } from "./dto/update-username.dto";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

type GitlabOauthStatePayload = {
  sub?: string;
  purpose?: string;
};

@Injectable()
export class AuthService {
  private readonly appBaseUrl = getEnv().APP_BASE_URL.replace(/\/+$/, "");
  private readonly inviteExpiryFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
    timeZoneName: "short"
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly queueService: QueueService,
    private readonly auditService: AuditService,
    private readonly gitlabService: GitlabService
  ) {}

  private createSessionToken(params: { userId: string; email: string; globalRole: GlobalRole }): string {
    return this.jwtService.sign({
      sub: params.userId,
      email: params.email,
      role: prismaRoleToApiRole(params.globalRole),
      jti: generateSecureToken(12)
    });
  }

  async login(dto: LoginDto): Promise<{
    token: string;
    expiresAt: Date;
    user: { id: string; email: string; username: string; name: string; globalRole: "admin" | "editor" | "reader" };
  }> {
    const identifier = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: identifier }
        ],
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

    const token = this.createSessionToken({
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole
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
        username: user.username,
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
        defaultProjectRole: access.defaultProjectRole ?? undefined,
        projectId: access.projectAccess.length === 1 ? access.projectAccess[0]?.projectId : undefined,
        inviteProjects:
          access.projectAccess.length > 0
            ? {
                create: access.projectAccess.map((projectAccess) => ({
                  projectId: projectAccess.projectId,
                  role: projectAccess.role
                }))
              }
            : undefined,
        globalRole: apiRoleToPrismaRole(canonicalRole),
        status: InviteStatus.PENDING,
        expiresAt
      }
    });

    const inviteUrl = `${this.appBaseUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    const loginUrl = `${this.appBaseUrl}/login`;
    const formattedExpiresAt = this.inviteExpiryFormatter.format(expiresAt);
    const passwordSecurityNote =
      "Security note: Your password is never stored in plain text. Atlasium stores only a one-way bcrypt hash, so neither admins nor support can read your password.";
    const inviteEmailText = [
      "You have been invited to Atlasium.",
      "",
      `Accept invite: ${inviteUrl}`,
      `Sign in: ${loginUrl}`,
      "",
      passwordSecurityNote,
      "",
      `Invite token: ${token}`,
      `Expires at: ${formattedExpiresAt}`
    ].join("\n");
    const inviteEmailHtml = [
      "<p>You have been invited to <strong>Atlasium</strong>.</p>",
      `<p><a href="${escapeHtml(inviteUrl)}">Accept invite</a><br/><a href="${escapeHtml(loginUrl)}">Sign in</a></p>`,
      `<p>${escapeHtml(passwordSecurityNote)}</p>`,
      `<p><strong>Invite token:</strong> <code>${escapeHtml(token)}</code><br/><strong>Expires at:</strong> ${escapeHtml(formattedExpiresAt)}</p>`
    ].join("");

    await this.queueService.enqueueEmail({
      directEmail: {
        to: invite.email,
        subject: "Atlasium invitation",
        text: inviteEmailText,
        html: inviteEmailHtml
      }
    });

    await this.auditService.log({
      userId: senderId,
      projectId: access.projectAccess.length === 1 ? access.projectAccess[0]?.projectId : undefined,
      entityType: "invite",
      entityId: invite.id,
      action: "auth.invite.create",
      metadata: {
        email: invite.email,
        role: canonicalRole,
        accessMode: access.accessMode,
        defaultProjectRole: access.defaultProjectRole ? this.projectRoleToApi(access.defaultProjectRole) : null,
        projectAccess: access.projectAccess.map((projectAccess) => ({
          projectId: projectAccess.projectId,
          role: this.projectRoleToApi(projectAccess.role)
        }))
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
            projectId: true,
            role: true
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
    let resultingRole = invitedRole;

    if (!user) {
      const username = dto.username
        ? validateAtlasiumUsername(dto.username)
        : deriveUsernameFromEmail(invite.email);
      await this.ensureUsernameAvailable(username);

      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          username,
          name: dto.name,
          passwordHash: await bcrypt.hash(dto.password, 10),
          globalRole: invite.globalRole
        }
      });
      resultingRole = invitedRole;

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
      resultingRole = mergedRole;
    }

    const targetProjectAssignments = await this.resolveInviteProjectAssignments(invite);
    const targetProjectIds = targetProjectAssignments.map((assignment) => assignment.projectId);
    if (targetProjectAssignments.length > 0 && invitedRole !== "admin") {
      await this.prisma.$transaction(
        targetProjectAssignments.map((assignment) =>
          this.prisma.projectMember.upsert({
            where: {
              projectId_userId: {
                projectId: assignment.projectId,
                userId: user.id
              }
            },
            create: {
              projectId: assignment.projectId,
              userId: user.id,
              role: assignment.role
            },
            update: {
              role: assignment.role
            }
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

    const token = this.createSessionToken({
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole
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
        projectAccess: targetProjectAssignments.map((assignment) => ({
          projectId: assignment.projectId,
          role: this.projectRoleToApi(assignment.role)
        }))
      }
    });

    const repositoryProjectIds = resultingRole === "admin"
      ? await this.listRepositoryProjectIds()
      : targetProjectIds;
    await Promise.all(repositoryProjectIds.map((projectId) => this.gitlabService.syncProjectRepositoryAccess(projectId)));

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

  async getCurrentUserProfile(user: AuthenticatedUser): Promise<{
    id: string;
    name: string;
    email: string;
    username: string;
    globalRole: "admin" | "editor" | "reader";
    timezone: string;
  }> {
    const profile = await this.prisma.user.findFirst({
      where: {
        id: user.userId,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        globalRole: true,
        timezone: true
      }
    });

    if (!profile) {
      throw new UnauthorizedException("Session expired");
    }

    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      username: profile.username,
      globalRole: prismaRoleToApiRole(profile.globalRole),
      timezone: profile.timezone
    };
  }

  async updateUsername(
    user: AuthenticatedUser,
    dto: UpdateUsernameDto
  ): Promise<{
    id: string;
    name: string;
    email: string;
    username: string;
    globalRole: "admin" | "editor" | "reader";
    timezone: string;
  }> {
    const username = validateAtlasiumUsername(dto.username);
    const activeUser = await this.prisma.user.findFirst({
      where: {
        id: user.userId,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        globalRole: true,
        timezone: true
      }
    });

    if (!activeUser) {
      throw new UnauthorizedException("Session expired");
    }

    await this.ensureUsernameAvailable(username, activeUser.id);

    await this.gitlabService.syncManagedUserIdentity({
      id: activeUser.id,
      email: activeUser.email,
      name: activeUser.name,
      username
    });

    const updatedUser = username === activeUser.username
      ? activeUser
      : await this.prisma.user.update({
          where: {
            id: activeUser.id
          },
          data: {
            username
          },
          select: {
            id: true,
            email: true,
            username: true,
            name: true,
            globalRole: true,
            timezone: true
          }
        });

    await this.auditService.log({
      userId: activeUser.id,
      entityType: "user",
      entityId: activeUser.id,
      action: "auth.username.update",
      metadata: {
        previousUsername: activeUser.username,
        username
      }
    });

    return {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      username: updatedUser.username,
      globalRole: prismaRoleToApiRole(updatedUser.globalRole),
      timezone: updatedUser.timezone
    };
  }

  async changePassword(
    user: AuthenticatedUser,
    currentSessionToken: string | undefined,
    dto: ChangePasswordDto
  ): Promise<{ changed: true }> {
    if (!currentSessionToken?.trim()) {
      throw new UnauthorizedException("Missing session token");
    }

    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException("New password confirmation does not match");
    }

    const activeUser = await this.prisma.user.findFirst({
      where: {
        id: user.userId,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        passwordHash: true
      }
    });

    if (!activeUser) {
      throw new UnauthorizedException("Session expired");
    }

    const validCurrentPassword = await bcrypt.compare(dto.currentPassword, activeUser.passwordHash);
    if (!validCurrentPassword) {
      throw new BadRequestException("Current password is incorrect");
    }

    const reusesCurrentPassword = await bcrypt.compare(dto.newPassword, activeUser.passwordHash);
    if (reusesCurrentPassword) {
      throw new BadRequestException("New password must be different from the current password");
    }

    await this.gitlabService.syncUserHttpsPassword(
      {
        id: activeUser.id,
        email: activeUser.email,
        username: activeUser.username,
        name: activeUser.name
      },
      dto.newPassword
    );
    const gitlabHttpsPasswordSyncedAt = new Date();

    await this.prisma.user.update({
      where: {
        id: activeUser.id
      },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 10),
        gitlabHttpsPasswordSyncedAt
      }
    });

    await this.prisma.session.deleteMany({
      where: {
        userId: activeUser.id,
        tokenHash: {
          not: hashValue(currentSessionToken)
        }
      }
    });

    await this.auditService.log({
      userId: activeUser.id,
      entityType: "user",
      entityId: activeUser.id,
      action: "auth.password.change"
    });

    return { changed: true };
  }

  async syncGitlabHttpsPassword(
    user: AuthenticatedUser,
    dto: SyncGitlabHttpsPasswordDto
  ): Promise<{ enabled: true; username: string }> {
    const activeUser = await this.prisma.user.findFirst({
      where: {
        id: user.userId,
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        passwordHash: true
      }
    });

    if (!activeUser) {
      throw new UnauthorizedException("Session expired");
    }

    const validCurrentPassword = await bcrypt.compare(dto.currentPassword, activeUser.passwordHash);
    if (!validCurrentPassword) {
      throw new BadRequestException("Current password is incorrect");
    }

    const result = await this.gitlabService.syncUserHttpsPassword(
      {
        id: activeUser.id,
        email: activeUser.email,
        username: activeUser.username,
        name: activeUser.name
      },
      dto.currentPassword
    );
    const gitlabHttpsPasswordSyncedAt = new Date();

    await this.prisma.user.update({
      where: {
        id: activeUser.id
      },
      data: {
        gitlabHttpsPasswordSyncedAt
      }
    });

    await this.auditService.log({
      userId: activeUser.id,
      entityType: "gitlab_https_password",
      entityId: activeUser.id,
      action: "auth.gitlab.https_password.sync",
      metadata: {
        username: result.username
      }
    });

    return {
      enabled: true,
      username: result.username
    };
  }

  async getGitlabConnectionStatus(user: AuthenticatedUser): Promise<{
    connected: boolean;
    reconnectRequired: boolean;
    username?: string;
    name?: string;
    email?: string | null;
    avatarUrl?: string | null;
    webUrl?: string | null;
    httpsClone: {
      enabled: boolean;
      syncedAt: string | null;
      username: string;
    };
  }> {
    return this.gitlabService.getConnectionStatus(user.userId);
  }

  async beginGitlabConnect(user: AuthenticatedUser): Promise<{ authorizationUrl: string }> {
    const state = this.jwtService.sign(
      {
        sub: user.userId,
        purpose: this.gitlabService.getOauthStatePurpose()
      },
      {
        expiresIn: "10m"
      }
    );

    return {
      authorizationUrl: this.gitlabService.buildAuthorizationUrl(state)
    };
  }

  async disconnectGitlabConnection(user: AuthenticatedUser): Promise<{ disconnected: true }> {
    const disconnected = await this.gitlabService.disconnectUserConnection(user.userId);

    if (disconnected) {
      await this.auditService.log({
        userId: user.userId,
        entityType: "gitlab_connection",
        entityId: user.userId,
        action: "auth.gitlab.disconnect"
      });
    }

    return { disconnected: true };
  }

  async listGitlabSshKeys(user: AuthenticatedUser): Promise<Array<{
    id: number;
    title: string;
    key: string;
    createdAt: string;
    expiresAt: string | null;
    usageType: string | null;
  }>> {
    return this.gitlabService.listUserSshKeys(user.userId);
  }

  async createGitlabSshKey(
    user: AuthenticatedUser,
    dto: CreateGitlabSshKeyDto
  ): Promise<{
    id: number;
    title: string;
    key: string;
    createdAt: string;
    expiresAt: string | null;
    usageType: string | null;
  }> {
    const createdKey = await this.gitlabService.createUserSshKey(user.userId, dto);

    await this.auditService.log({
      userId: user.userId,
      entityType: "gitlab_ssh_key",
      entityId: String(createdKey.id),
      action: "auth.gitlab.ssh_key.create",
      metadata: {
        title: createdKey.title,
        expiresAt: createdKey.expiresAt
      }
    });

    return createdKey;
  }

  async deleteGitlabSshKey(user: AuthenticatedUser, keyId: string): Promise<{ deleted: true }> {
    const result = await this.gitlabService.deleteUserSshKey(user.userId, keyId);

    await this.auditService.log({
      userId: user.userId,
      entityType: "gitlab_ssh_key",
      entityId: keyId,
      action: "auth.gitlab.ssh_key.delete"
    });

    return result;
  }

  async completeGitlabConnectCallback(code: string | undefined, state: string | undefined): Promise<string> {
    const redirectBaseUrl = `${this.appBaseUrl}/account`;

    try {
      if (!code || !state) {
        throw new BadRequestException("Missing GitLab OAuth callback parameters");
      }

      const payload = this.jwtService.verify<GitlabOauthStatePayload>(state, {
        secret: getEnv().JWT_SECRET
      });

      if (!payload.sub || payload.purpose !== this.gitlabService.getOauthStatePurpose()) {
        throw new UnauthorizedException("Invalid GitLab OAuth state");
      }

      const activeUser = await this.prisma.user.findFirst({
        where: {
          id: payload.sub,
          deletedAt: null,
          isActive: true
        },
        select: {
          id: true
        }
      });

      if (!activeUser) {
        throw new UnauthorizedException("User session is no longer active");
      }

      await this.gitlabService.exchangeAuthorizationCode(activeUser.id, code);

      await this.auditService.log({
        userId: activeUser.id,
        entityType: "gitlab_connection",
        entityId: activeUser.id,
        action: "auth.gitlab.connect"
      });

      return `${redirectBaseUrl}?gitlab=connected`;
    } catch (error) {
      return `${redirectBaseUrl}?gitlab=error&message=${encodeURIComponent(this.getGitlabCallbackErrorMessage(error))}`;
    }
  }

  private async resolveInviteAccess(dto: InviteDto): Promise<{
    accessMode: InviteAccessMode;
    defaultProjectRole: ProjectRole | null;
    projectAccess: Array<{ projectId: string; role: ProjectRole; key: string; name: string }>;
  }> {
    const legacyProjectId = dto.projectId?.trim();
    const legacyProjectIds = Array.from(new Set((dto.projectIds ?? []).map((projectId) => projectId.trim()).filter(Boolean)));
    const normalizedProjectAccess = this.normalizeProjectAccess(dto.projectAccess);

    if (dto.accessMode === "all") {
      if (legacyProjectId || legacyProjectIds.length > 0 || normalizedProjectAccess.length > 0) {
        throw new BadRequestException("accessMode 'all' does not accept project-specific assignments");
      }

      if (dto.globalRole !== "admin" && !dto.defaultProjectRole) {
        throw new BadRequestException("defaultProjectRole is required when accessMode is 'all'");
      }

      return {
        accessMode: InviteAccessMode.ALL_CURRENT_PROJECTS,
        defaultProjectRole: dto.globalRole === "admin" ? null : this.apiProjectRoleToPrisma(dto.defaultProjectRole ?? "reader"),
        projectAccess: []
      };
    }

    const selectedProjectAccess =
      normalizedProjectAccess.length > 0
        ? normalizedProjectAccess
        : this.normalizeLegacyInviteProjects(legacyProjectId, legacyProjectIds, dto.globalRole);

    if (dto.accessMode === "selected" && selectedProjectAccess.length === 0) {
      throw new BadRequestException("projectAccess must contain at least one project when accessMode is 'selected'");
    }

    if (!dto.accessMode && selectedProjectAccess.length === 0) {
      throw new BadRequestException("accessMode is required and must be either 'all' or 'selected'");
    }

    if (selectedProjectAccess.length === 0) {
      throw new BadRequestException("projectAccess must contain at least one project");
    }

    const selectedProjectIds = selectedProjectAccess.map((projectAccess) => projectAccess.projectId);
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
    const orderedProjectAccess = selectedProjectAccess.map((projectAccess) => {
      const project = projectsById.get(projectAccess.projectId);
      if (!project) {
        throw new BadRequestException("One or more selected projects are missing or archived");
      }

      return {
        projectId: project.id,
        role: projectAccess.role,
        key: project.key,
        name: project.name
      };
    });

    return {
      accessMode: InviteAccessMode.SELECTED_PROJECTS,
      defaultProjectRole: null,
      projectAccess: orderedProjectAccess
    };
  }

  private async resolveInviteProjectAssignments(invite: {
    accessMode: InviteAccessMode;
    defaultProjectRole: ProjectRole | null;
    projectId: string | null;
    inviteProjects: Array<{ projectId: string; role: ProjectRole }>;
  }): Promise<Array<{ projectId: string; role: ProjectRole }>> {
    if (invite.accessMode === InviteAccessMode.ALL_CURRENT_PROJECTS) {
      const allProjects = await this.prisma.project.findMany({
        where: {
          deletedAt: null
        },
        select: {
          id: true
        }
      });

      const role = invite.defaultProjectRole ?? ProjectRole.READER;
      return allProjects.map((project) => ({
        projectId: project.id,
        role
      }));
    }

    const selectedProjectAccess = new Map<string, ProjectRole>();
    invite.inviteProjects.forEach((item) => {
      if (!selectedProjectAccess.has(item.projectId)) {
        selectedProjectAccess.set(item.projectId, item.role);
      }
    });
    if (selectedProjectAccess.size === 0 && invite.projectId) {
      selectedProjectAccess.set(invite.projectId, invite.defaultProjectRole ?? ProjectRole.READER);
    }
    if (selectedProjectAccess.size === 0) {
      return [];
    }

    const selectedProjectIds = Array.from(selectedProjectAccess.keys());
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
    return selectedProjectIds
      .filter((projectId) => activeProjectIds.has(projectId))
      .map((projectId) => ({
        projectId,
        role: selectedProjectAccess.get(projectId) ?? ProjectRole.READER
      }));
  }

  private normalizeProjectAccess(
    projectAccess: InviteDto["projectAccess"]
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

  private normalizeLegacyInviteProjects(
    legacyProjectId: string | undefined,
    legacyProjectIds: string[],
    globalRole: InviteDto["globalRole"]
  ): Array<{ projectId: string; role: ProjectRole }> {
    const normalized = new Set(legacyProjectIds);
    if (legacyProjectId) {
      normalized.add(legacyProjectId);
    }

    const fallbackRole = this.apiProjectRoleToPrisma(globalRole === "editor" ? "editor" : "reader");
    return Array.from(normalized).map((projectId) => ({
      projectId,
      role: fallbackRole
    }));
  }

  private apiProjectRoleToPrisma(role: "editor" | "reader"): ProjectRole {
    return role === "editor" ? ProjectRole.EDITOR : ProjectRole.READER;
  }

  private projectRoleToApi(role: ProjectRole): "editor" | "reader" {
    return role === ProjectRole.EDITOR ? "editor" : "reader";
  }

  private getGitlabCallbackErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return "GitLab connection failed";
  }

  private async listRepositoryProjectIds(): Promise<string[]> {
    const repositories = await this.prisma.projectRepository.findMany({
      select: {
        projectId: true
      }
    });

    return Array.from(new Set(repositories.map((repository) => repository.projectId)));
  }

  private async ensureUsernameAvailable(username: string, currentUserId?: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: {
        username
      },
      select: {
        id: true
      }
    });

    if (existing && existing.id !== currentUserId) {
      throw new ConflictException("Username is already in use");
    }
  }
}
