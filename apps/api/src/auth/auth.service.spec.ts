import { BadRequestException } from "@nestjs/common";
import { GlobalRole, InviteAccessMode, InviteStatus, NotificationStatus, ProjectRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

import { decryptValue } from "../common/crypto";
import { getEnv } from "../config/env";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const makeService = (): {
    service: AuthService;
    prisma: any;
    jwtService: any;
    queueService: any;
    auditService: any;
    gitlabService: any;
  } => {
    const prisma: any = {
      invite: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn()
      },
      project: {
        findMany: jest.fn()
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      passwordResetToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn()
      },
      notificationEvent: {
        create: jest.fn(),
        update: jest.fn()
      },
      notificationPreference: {
        create: jest.fn()
      },
      projectMember: {
        upsert: jest.fn()
      },
      session: {
        create: jest.fn(),
        deleteMany: jest.fn()
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>> | ((tx: any) => Promise<unknown>)) => {
        if (typeof operations === "function") {
          return operations(prisma);
        }

        return Promise.all(operations);
      })
    };

    const jwtService: any = {
      sign: jest.fn().mockReturnValue("jwt-token"),
      verify: jest.fn()
    };

    const queueService: any = {
      enqueueEmail: jest.fn()
    };

    const auditService: any = {
      log: jest.fn()
    };

    const gitlabService: any = {
      getConnectionStatus: jest.fn(),
      getOauthStatePurpose: jest.fn().mockReturnValue("gitlab_oauth"),
      buildAuthorizationUrl: jest.fn(),
      disconnectUserConnection: jest.fn(),
      exchangeAuthorizationCode: jest.fn(),
      listUserSshKeys: jest.fn(),
      createUserSshKey: jest.fn(),
      deleteUserSshKey: jest.fn(),
      syncProjectRepositoryAccess: jest.fn(),
      syncManagedUserIdentity: jest.fn(),
      syncUserHttpsPassword: jest.fn().mockResolvedValue({ username: "user" })
    };

    return {
      service: new AuthService(prisma, jwtService, queueService, auditService, gitlabService),
      prisma,
      jwtService,
      queueService,
      auditService,
      gitlabService
    };
  };

  it("creates selected-project invite with per-project roles and acceptance URL", async () => {
    const { service, prisma, queueService } = makeService();

    prisma.project.findMany.mockResolvedValue([
      { id: "p1", key: "P1", name: "Project One" },
      { id: "p2", key: "P2", name: "Project Two" }
    ]);
    prisma.invite.create.mockResolvedValue({
      id: "invite-1",
      email: "invitee@example.com"
    });

    const result = await service.invite(
      {
        email: "invitee@example.com",
        globalRole: "editor",
        accessMode: "selected",
        projectAccess: [
          { projectId: "p1", role: "editor" },
          { projectId: "p2", role: "reader" }
        ]
      },
      "sender-1"
    );

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["p1", "p2"] },
          deletedAt: null
        }
      })
    );
    expect(prisma.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accessMode: InviteAccessMode.SELECTED_PROJECTS,
          globalRole: GlobalRole.EDITOR,
          defaultProjectRole: undefined,
          inviteProjects: {
            create: [
              { projectId: "p1", role: ProjectRole.EDITOR },
              { projectId: "p2", role: ProjectRole.READER }
            ]
          }
        })
      })
    );
    expect(queueService.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedDirectEmail: expect.stringMatching(/^v1:/)
      })
    );
    const emailPayload = queueService.enqueueEmail.mock.calls[0][0];
    expect(emailPayload.directEmail).toBeUndefined();
    expect(JSON.stringify(emailPayload)).not.toContain("/accept-invite?token=");
    const inviteEmail = JSON.parse(decryptValue(emailPayload.encryptedDirectEmail, getEnv().JWT_SECRET));
    const inviteText = inviteEmail.text as string;
    const inviteHtml = inviteEmail.html as string;
    expect(inviteText).toContain("Sign in: ");
    expect(inviteText).toContain("/login");
    expect(inviteText).toContain("Security note: Your password is never stored in plain text.");
    expect(inviteText).toContain("one-way bcrypt hash");
    expect(inviteText).toContain("Invite token:");
    expect(inviteText).toContain("Expires at:");
    expect(inviteText).toContain("UTC");
    expect(inviteText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(inviteHtml).toContain("/accept-invite?token=");
    expect(inviteHtml).toContain("/login");
    expect(inviteHtml).toContain("one-way bcrypt hash");
    expect(result.inviteId).toBe("invite-1");
    expect(result.token).toBeTruthy();
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("logs in an active user, creates a session, and returns the DB role instead of trusting the request", async () => {
    const { service, prisma, jwtService, auditService } = makeService();
    const password = "password-123";
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "Example User",
      globalRole: GlobalRole.EDITOR,
      passwordHash: await bcrypt.hash(password, 10)
    });
    prisma.session.create.mockResolvedValue({});

    const result = await service.login({
      email: "USER@example.com",
      password
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: "user@example.com" },
          { username: "user@example.com" }
        ],
        deletedAt: null,
        isActive: true
      }
    });
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: "user-1",
      email: "user@example.com",
      role: "editor",
      jti: expect.any(String)
    });
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date)
      }
    });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "session",
      entityId: "user-1",
      action: "auth.login"
    });
    expect(result).toEqual({
      token: "jwt-token",
      expiresAt: expect.any(Date),
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "Example User",
        globalRole: "editor"
      }
    });
  });

  it("logs in with a username identifier", async () => {
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "luisjrc",
      name: "Example User",
      globalRole: GlobalRole.EDITOR,
      passwordHash: await bcrypt.hash("password-123", 10)
    });
    prisma.session.create.mockResolvedValue({});

    await expect(
      service.login({
        email: "luisjrc",
        password: "password-123"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          username: "luisjrc"
        })
      })
    );
  });

  it("rejects login when the password is invalid", async () => {
    const { service, prisma } = makeService();
    const password = "password-123";
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "Example User",
      globalRole: GlobalRole.EDITOR,
      passwordHash: await bcrypt.hash(password, 10)
    });

    await expect(
      service.login({
        email: "user@example.com",
        password: "wrong-password"
      })
    ).rejects.toThrow("Invalid credentials");
  });

  it("returns accepted=true for password reset without leaking whether the user exists", async () => {
    const { service, prisma, queueService, auditService } = makeService();
    prisma.user.findFirst.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.passwordResetToken.create.mockResolvedValue({
      id: "reset-1",
      expiresAt: new Date("2026-06-18T12:30:00.000Z")
    });
    prisma.notificationEvent.create.mockResolvedValue({ id: "event-1" });

    const result = await service.requestPasswordReset({
      email: "USER@example.com"
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: "user@example.com",
        deletedAt: null,
        isActive: true
      },
      select: {
        id: true,
        email: true
      }
    });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date)
      }
    });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "PASSWORD_RESET",
        status: "PENDING",
        payload: {
          template: "password-reset",
          passwordResetTokenId: "reset-1",
          expiresAt: expect.any(String)
        }
      }
    });
    expect(queueService.enqueueEmail).toHaveBeenCalledWith({
      notificationEventId: "event-1",
      encryptedDirectEmail: expect.stringMatching(/^v1:/)
    });
    const emailPayload = queueService.enqueueEmail.mock.calls[0][0];
    expect(emailPayload.directEmail).toBeUndefined();
    expect(JSON.stringify(emailPayload)).not.toContain("/reset-password?token=");
    const resetEmail = JSON.parse(decryptValue(emailPayload.encryptedDirectEmail, getEnv().JWT_SECRET));
    expect(resetEmail).toEqual(
      expect.objectContaining({
        to: "user@example.com",
        subject: "Atlasium password reset",
        text: expect.stringContaining("/reset-password?token="),
        html: expect.stringContaining("Reset password")
      })
    );
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "user",
      entityId: "user-1",
      action: "auth.password.reset_requested"
    });
    expect(result).toEqual({ accepted: true });
  });

  it("returns accepted=true for password reset when the email is unknown and does not enqueue anything", async () => {
    const { service, prisma, queueService } = makeService();
    prisma.user.findFirst.mockResolvedValue(null);

    const result = await service.requestPasswordReset({
      email: "missing@example.com"
    });

    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(queueService.enqueueEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ accepted: true });
  });

  it("consumes a newly created password reset token when email enqueue fails", async () => {
    const { service, prisma, queueService, auditService } = makeService();
    prisma.user.findFirst.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.passwordResetToken.create.mockResolvedValue({
      id: "reset-1",
      expiresAt: new Date("2026-06-18T12:30:00.000Z")
    });
    prisma.passwordResetToken.update.mockResolvedValue({});
    prisma.notificationEvent.create.mockResolvedValue({ id: "event-1" });
    prisma.notificationEvent.update.mockResolvedValue({});
    queueService.enqueueEmail.mockRejectedValue(new Error("redis offline"));

    await expect(service.requestPasswordReset({ email: "user@example.com" })).resolves.toEqual({ accepted: true });

    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: "reset-1" },
      data: { consumedAt: expect.any(Date) }
    });
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: {
        status: NotificationStatus.FAILED,
        errorMessage: "Password reset delivery could not be queued"
      }
    });
    expect(auditService.log).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.password.reset_requested"
      })
    );
  });

  it("applies password reset cooldown without issuing a second token", async () => {
    const { service, prisma, queueService } = makeService();
    prisma.user.findFirst.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: "reset-1",
      createdAt: new Date()
    });

    await expect(service.requestPasswordReset({ email: "user@example.com" })).resolves.toEqual({ accepted: true });

    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(queueService.enqueueEmail).not.toHaveBeenCalled();
  });

  it("confirms password reset once, revokes sessions, and does not create a login session", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const passwordHash = await bcrypt.hash("old-password-123", 10);
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User",
        passwordHash
      }
    });
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({});
    prisma.session.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      service.confirmPasswordReset({
        token: "reset-token",
        newPassword: "new-password-123",
        confirmPassword: "new-password-123"
      })
    ).resolves.toEqual({ reset: true });

    expect(prisma.passwordResetToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          consumedAt: null,
          expiresAt: {
            gt: expect.any(Date)
          },
          user: {
            deletedAt: null,
            isActive: true
          }
        })
      })
    );
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reset-1",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        consumedAt: null,
        expiresAt: {
          gt: expect.any(Date)
        },
        user: {
          deletedAt: null,
          isActive: true
        }
      },
      data: { consumedAt: expect.any(Date) }
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: expect.any(String),
        gitlabHttpsPasswordSyncedAt: null
      }
    });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" }
    });
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "user",
      entityId: "user-1",
      action: "auth.password.reset_completed"
    });
    expect(gitlabService.syncUserHttpsPassword).toHaveBeenCalledWith(
      {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User"
      },
      "new-password-123"
    );
  });

  it("rejects invalid or consumed password reset tokens", async () => {
    const { service, prisma } = makeService();
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);

    await expect(
      service.confirmPasswordReset({
        token: "missing-token",
        newPassword: "new-password-123",
        confirmPassword: "new-password-123"
      })
    ).rejects.toThrow("Password reset link is invalid or expired");
  });

  it("rejects concurrently consumed password reset tokens", async () => {
    const { service, prisma } = makeService();
    const passwordHash = await bcrypt.hash("old-password-123", 10);
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      user: {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User",
        passwordHash
      }
    });
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.confirmPasswordReset({
        token: "reset-token",
        newPassword: "new-password-123",
        confirmPassword: "new-password-123"
      })
    ).rejects.toThrow("Password reset link is invalid or expired");

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it("returns the current authenticated user's profile from the database", async () => {
    const { service, prisma } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-7",
      name: "Profile User",
      email: "profile@example.com",
      username: "profile",
      globalRole: GlobalRole.ADMIN,
      timezone: "Europe/Madrid"
    });

    const result = await service.getCurrentUserProfile({
      userId: "user-7",
      email: "stale@example.com",
      globalRole: "reader"
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: "user-7",
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
    expect(result).toEqual({
      id: "user-7",
      name: "Profile User",
      email: "profile@example.com",
      username: "profile",
      globalRole: "admin",
      timezone: "Europe/Madrid"
    });
  });

  it("updates the current username and syncs the linked GitLab user", async () => {
    const { service, prisma, gitlabService, auditService } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "old-user",
      name: "User One",
      globalRole: GlobalRole.EDITOR,
      timezone: "Europe/Madrid"
    });
    prisma.user.findUnique.mockResolvedValue(null);
    gitlabService.syncManagedUserIdentity.mockResolvedValue({ username: "new-user" });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "new-user",
      name: "User One",
      globalRole: GlobalRole.EDITOR,
      timezone: "Europe/Madrid"
    });

    await expect(
      service.updateUsername(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        { username: "New-User" }
      )
    ).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      username: "new-user",
      name: "User One",
      globalRole: "editor",
      timezone: "Europe/Madrid"
    });

    expect(gitlabService.syncManagedUserIdentity).toHaveBeenCalledWith({
      id: "user-1",
      email: "user@example.com",
      name: "User One",
      username: "new-user"
    });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        username: "new-user"
      }
    }));
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.username.update",
      metadata: {
        previousUsername: "old-user",
        username: "new-user"
      }
    }));
  });

  it("rejects username updates when the username is already used", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "old-user",
      name: "User One",
      globalRole: GlobalRole.EDITOR,
      timezone: "Europe/Madrid"
    });
    prisma.user.findUnique.mockResolvedValue({ id: "user-2" });

    await expect(
      service.updateUsername(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        { username: "taken" }
      )
    ).rejects.toThrow("Username is already in use");

    expect(gitlabService.syncManagedUserIdentity).not.toHaveBeenCalled();
  });

  it("changes the password and revokes all other sessions", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const currentPassword = "password-123";
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One",
      passwordHash: await bcrypt.hash(currentPassword, 10)
    });
    gitlabService.syncUserHttpsPassword.mockResolvedValue({ username: "user" });
    prisma.user.update.mockResolvedValue({ id: "user-1" });
    prisma.session.deleteMany.mockResolvedValue({ count: 3 });

    const result = await service.changePassword(
      {
        userId: "user-1",
        email: "user@example.com",
        globalRole: "editor"
      },
      "current-session-token",
      {
        currentPassword,
        newPassword: "new-password-456",
        confirmPassword: "new-password-456"
      }
    );

    expect(gitlabService.syncUserHttpsPassword).toHaveBeenCalledWith(
      {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User One"
      },
      "new-password-456"
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: {
        id: "user-1"
      },
      data: {
        passwordHash: expect.any(String),
        gitlabHttpsPasswordSyncedAt: expect.any(Date)
      }
    });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        tokenHash: {
          not: expect.any(String)
        }
      }
    });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "user",
      entityId: "user-1",
      action: "auth.password.change"
    });
    expect(result).toEqual({ changed: true });
  });

  it("rejects password change when the current password is wrong", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One",
      passwordHash: await bcrypt.hash("password-123", 10)
    });

    await expect(
      service.changePassword(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        "current-session-token",
        {
          currentPassword: "wrong-password",
          newPassword: "new-password-456",
          confirmPassword: "new-password-456"
        }
      )
    ).rejects.toThrow("Current password is incorrect");

    expect(gitlabService.syncUserHttpsPassword).not.toHaveBeenCalled();
  });

  it("rejects password change when confirmation does not match", async () => {
    const { service } = makeService();

    await expect(
      service.changePassword(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        "current-session-token",
        {
          currentPassword: "password-123",
          newPassword: "new-password-456",
          confirmPassword: "mismatch-password"
        }
      )
    ).rejects.toThrow("New password confirmation does not match");
  });

  it("rejects password change when the new password matches the current one", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One",
      passwordHash: await bcrypt.hash("password-123", 10)
    });

    await expect(
      service.changePassword(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        "current-session-token",
        {
          currentPassword: "password-123",
          newPassword: "password-123",
          confirmPassword: "password-123"
        }
      )
    ).rejects.toThrow("New password must be different from the current password");

    expect(gitlabService.syncUserHttpsPassword).not.toHaveBeenCalled();
  });

  it("aborts password change when GitLab HTTPS password sync fails", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One",
      passwordHash: await bcrypt.hash("password-123", 10)
    });
    gitlabService.syncUserHttpsPassword.mockRejectedValue(new Error("GitLab unavailable"));

    await expect(
      service.changePassword(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        "current-session-token",
        {
          currentPassword: "password-123",
          newPassword: "new-password-456",
          confirmPassword: "new-password-456"
        }
      )
    ).rejects.toThrow("GitLab unavailable");

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it("syncs the current Atlasium password into GitLab for HTTPS clone", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const currentPassword = "password-123";
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One",
      passwordHash: await bcrypt.hash(currentPassword, 10)
    });
    gitlabService.syncUserHttpsPassword.mockResolvedValue({ username: "user" });

    await expect(
      service.syncGitlabHttpsPassword(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        { currentPassword }
      )
    ).resolves.toEqual({
      enabled: true,
      username: "user"
    });

    expect(gitlabService.syncUserHttpsPassword).toHaveBeenCalledWith(
      {
        id: "user-1",
        email: "user@example.com",
        username: "user",
        name: "User One"
      },
      currentPassword
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: {
        id: "user-1"
      },
      data: {
        gitlabHttpsPasswordSyncedAt: expect.any(Date)
      }
    });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "gitlab_https_password",
      entityId: "user-1",
      action: "auth.gitlab.https_password.sync",
      metadata: {
        username: "user"
      }
    });
  });

  it("rejects GitLab HTTPS password sync when the current password is wrong", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      username: "user",
      name: "User One",
      passwordHash: await bcrypt.hash("password-123", 10)
    });

    await expect(
      service.syncGitlabHttpsPassword(
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: "editor"
        },
        { currentPassword: "wrong-password" }
      )
    ).rejects.toThrow("Current password is incorrect");

    expect(gitlabService.syncUserHttpsPassword).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects all-projects invite payload when project-specific assignments are provided", async () => {
    const { service } = makeService();

    await expect(
      service.invite(
        {
          email: "invitee@example.com",
          globalRole: "reader",
          accessMode: "all",
          projectAccess: [{ projectId: "p1", role: "reader" }],
          defaultProjectRole: "reader"
        },
        "sender-1"
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires defaultProjectRole for non-admin all-project invites", async () => {
    const { service } = makeService();

    await expect(
      service.invite(
        {
          email: "invitee@example.com",
          globalRole: "reader",
          accessMode: "all"
        },
        "sender-1"
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts all-projects invite and assigns all active projects with the default role", async () => {
    const { service, prisma } = makeService();

    prisma.invite.findFirst.mockResolvedValue({
      id: "invite-1",
      email: "invitee@example.com",
      globalRole: GlobalRole.READER,
      accessMode: InviteAccessMode.ALL_CURRENT_PROJECTS,
      defaultProjectRole: ProjectRole.READER,
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      projectId: null,
      inviteProjects: []
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "invitee@example.com",
      globalRole: GlobalRole.READER
    });
    prisma.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    prisma.user.update.mockResolvedValue({ id: "user-1" });
    prisma.projectMember.upsert.mockResolvedValue({});
    prisma.invite.update.mockResolvedValue({});
    prisma.session.create.mockResolvedValue({});

    const result = await service.acceptInvite({
      token: "valid-token",
      name: "Invited User",
      password: "password-123"
    });

    expect(prisma.projectMember.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.projectMember.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          projectId_userId: {
            projectId: "p1",
            userId: "user-1"
          }
        },
        create: {
          projectId: "p1",
          userId: "user-1",
          role: ProjectRole.READER
        },
        update: {
          role: ProjectRole.READER
        }
      })
    );
    expect(result.projectIds).toEqual(["p1", "p2"]);
  });

  it("creates a new invited user with the requested Atlasium username", async () => {
    const { service, prisma } = makeService();

    prisma.invite.findFirst.mockResolvedValue({
      id: "invite-1",
      email: "invitee@example.com",
      globalRole: GlobalRole.READER,
      accessMode: InviteAccessMode.SELECTED_PROJECTS,
      defaultProjectRole: null,
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      projectId: null,
      inviteProjects: []
    });
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValue({
      id: "user-1",
      email: "invitee@example.com",
      username: "invitee",
      globalRole: GlobalRole.READER
    });
    prisma.notificationPreference.create.mockResolvedValue({});
    prisma.invite.update.mockResolvedValue({});
    prisma.session.create.mockResolvedValue({});

    await service.acceptInvite({
      token: "valid-token",
      name: "Invited User",
      username: "Invitee",
      password: "password-123"
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "invitee@example.com",
        username: "invitee",
        name: "Invited User"
      })
    });
  });

  it("rejects duplicate usernames when accepting an invite for a new user", async () => {
    const { service, prisma } = makeService();

    prisma.invite.findFirst.mockResolvedValue({
      id: "invite-1",
      email: "invitee@example.com",
      globalRole: GlobalRole.READER,
      accessMode: InviteAccessMode.SELECTED_PROJECTS,
      defaultProjectRole: null,
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      projectId: null,
      inviteProjects: []
    });
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "other-user" });

    await expect(
      service.acceptInvite({
        token: "valid-token",
        name: "Invited User",
        username: "taken",
        password: "password-123"
      })
    ).rejects.toThrow("Username is already in use");
  });

  it("accepts selected-project invite and assigns only selected active projects with their roles", async () => {
    const { service, prisma } = makeService();

    prisma.invite.findFirst.mockResolvedValue({
      id: "invite-selected",
      email: "invitee@example.com",
      globalRole: GlobalRole.EDITOR,
      accessMode: InviteAccessMode.SELECTED_PROJECTS,
      defaultProjectRole: null,
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      projectId: null,
      inviteProjects: [
        { projectId: "p2", role: ProjectRole.EDITOR },
        { projectId: "p4", role: ProjectRole.READER }
      ]
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "invitee@example.com",
      globalRole: GlobalRole.READER
    });
    prisma.project.findMany.mockResolvedValue([{ id: "p2" }, { id: "p4" }]);
    prisma.user.update.mockResolvedValue({ id: "user-1" });
    prisma.projectMember.upsert.mockResolvedValue({});
    prisma.invite.update.mockResolvedValue({});
    prisma.session.create.mockResolvedValue({});

    const result = await service.acceptInvite({
      token: "selected-token",
      name: "Invited User",
      password: "password-123"
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["p2", "p4"]
        },
        deletedAt: null
      },
      select: {
        id: true
      }
    });
    expect(prisma.projectMember.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.projectMember.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: {
          projectId: "p2",
          userId: "user-1",
          role: ProjectRole.EDITOR
        },
        update: {
          role: ProjectRole.EDITOR
        }
      })
    );
    expect(prisma.projectMember.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: {
          projectId: "p4",
          userId: "user-1",
          role: ProjectRole.READER
        },
        update: {
          role: ProjectRole.READER
        }
      })
    );
    expect(result.projectIds).toEqual(["p2", "p4"]);
  });

  it("keeps legacy projectId fallback when accepting selected invite without InviteProject rows", async () => {
    const { service, prisma } = makeService();

    prisma.invite.findFirst.mockResolvedValue({
      id: "invite-legacy",
      email: "invitee@example.com",
      globalRole: GlobalRole.EDITOR,
      accessMode: InviteAccessMode.SELECTED_PROJECTS,
      defaultProjectRole: ProjectRole.EDITOR,
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      projectId: "legacy-project",
      inviteProjects: []
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-2",
      email: "invitee@example.com",
      globalRole: GlobalRole.READER
    });
    prisma.project.findMany.mockResolvedValue([{ id: "legacy-project" }]);
    prisma.user.update.mockResolvedValue({ id: "user-2" });
    prisma.projectMember.upsert.mockResolvedValue({});
    prisma.invite.update.mockResolvedValue({});
    prisma.session.create.mockResolvedValue({});

    const result = await service.acceptInvite({
      token: "legacy-token",
      name: "Legacy User",
      password: "password-123"
    });

    expect(prisma.projectMember.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.projectMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          projectId: "legacy-project",
          userId: "user-2",
          role: ProjectRole.EDITOR
        },
        update: {
          role: ProjectRole.EDITOR
        }
      })
    );
    expect(result.projectId).toBe("legacy-project");
    expect(result.projectIds).toEqual(["legacy-project"]);
  });

  it("returns current GitLab connection status for the authenticated user", async () => {
    const { service, gitlabService } = makeService();
    gitlabService.getConnectionStatus.mockResolvedValue({
      connected: true,
      reconnectRequired: false,
      username: "luis",
      httpsClone: {
        enabled: true,
        syncedAt: "2026-06-07T10:00:00.000Z",
        username: "luis"
      }
    });

    const result = await service.getGitlabConnectionStatus({
      userId: "user-1",
      email: "user@example.com",
      globalRole: "editor"
    });

    expect(gitlabService.getConnectionStatus).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({
      connected: true,
      reconnectRequired: false,
      username: "luis",
      httpsClone: {
        enabled: true,
        syncedAt: "2026-06-07T10:00:00.000Z",
        username: "luis"
      }
    });
  });

  it("starts GitLab OAuth by signing state and building the authorization url", async () => {
    const { service, jwtService, gitlabService } = makeService();
    jwtService.sign.mockReturnValueOnce("gitlab-state");
    gitlabService.buildAuthorizationUrl.mockReturnValue("https://gitlab.example/oauth/authorize?state=gitlab-state");

    const result = await service.beginGitlabConnect({
      userId: "user-1",
      email: "user@example.com",
      globalRole: "admin"
    });

    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        sub: "user-1",
        purpose: "gitlab_oauth"
      },
      {
        expiresIn: "10m"
      }
    );
    expect(gitlabService.buildAuthorizationUrl).toHaveBeenCalledWith("gitlab-state");
    expect(result).toEqual({
      authorizationUrl: "https://gitlab.example/oauth/authorize?state=gitlab-state"
    });
  });

  it("disconnects GitLab connection and writes an audit log when a connection existed", async () => {
    const { service, gitlabService, auditService } = makeService();
    gitlabService.disconnectUserConnection.mockResolvedValue(true);

    const result = await service.disconnectGitlabConnection({
      userId: "user-1",
      email: "user@example.com",
      globalRole: "editor"
    });

    expect(gitlabService.disconnectUserConnection).toHaveBeenCalledWith("user-1");
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "gitlab_connection",
      entityId: "user-1",
      action: "auth.gitlab.disconnect"
    });
    expect(result).toEqual({ disconnected: true });
  });

  it("lists the current user's GitLab SSH keys", async () => {
    const { service, gitlabService } = makeService();
    gitlabService.listUserSshKeys.mockResolvedValue([
      {
        id: 12,
        title: "Laptop",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAexample",
        createdAt: "2026-04-06T10:00:00.000Z",
        expiresAt: null,
        usageType: "auth"
      }
    ]);

    const result = await service.listGitlabSshKeys({
      userId: "user-1",
      email: "user@example.com",
      globalRole: "editor"
    });

    expect(gitlabService.listUserSshKeys).toHaveBeenCalledWith("user-1");
    expect(result).toEqual([
      {
        id: 12,
        title: "Laptop",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAexample",
        createdAt: "2026-04-06T10:00:00.000Z",
        expiresAt: null,
        usageType: "auth"
      }
    ]);
  });

  it("creates a GitLab SSH key and writes an audit log", async () => {
    const { service, gitlabService, auditService } = makeService();
    gitlabService.createUserSshKey.mockResolvedValue({
      id: 22,
      title: "Workstation",
      key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
      createdAt: "2026-04-06T11:00:00.000Z",
      expiresAt: "2027-04-06",
      usageType: "auth"
    });

    const result = await service.createGitlabSshKey(
      {
        userId: "user-1",
        email: "user@example.com",
        globalRole: "editor"
      },
      {
        title: "Workstation",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
        expiresAt: "2027-04-06"
      }
    );

    expect(gitlabService.createUserSshKey).toHaveBeenCalledWith("user-1", {
      title: "Workstation",
      key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
      expiresAt: "2027-04-06"
    });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "gitlab_ssh_key",
      entityId: "22",
      action: "auth.gitlab.ssh_key.create",
      metadata: {
        title: "Workstation",
        expiresAt: "2027-04-06"
      }
    });
    expect(result).toEqual({
      id: 22,
      title: "Workstation",
      key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAworkstation",
      createdAt: "2026-04-06T11:00:00.000Z",
      expiresAt: "2027-04-06",
      usageType: "auth"
    });
  });

  it("deletes a GitLab SSH key and writes an audit log", async () => {
    const { service, gitlabService, auditService } = makeService();
    gitlabService.deleteUserSshKey.mockResolvedValue({ deleted: true });

    const result = await service.deleteGitlabSshKey(
      {
        userId: "user-1",
        email: "user@example.com",
        globalRole: "editor"
      },
      "31"
    );

    expect(gitlabService.deleteUserSshKey).toHaveBeenCalledWith("user-1", "31");
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "gitlab_ssh_key",
      entityId: "31",
      action: "auth.gitlab.ssh_key.delete"
    });
    expect(result).toEqual({ deleted: true });
  });

  it("completes GitLab OAuth callback and redirects back to account on success", async () => {
    const { service, jwtService, prisma, gitlabService, auditService } = makeService();
    jwtService.verify.mockReturnValue({
      sub: "user-1",
      purpose: "gitlab_oauth"
    });
    prisma.user.findFirst.mockResolvedValue({ id: "user-1" });
    gitlabService.exchangeAuthorizationCode.mockResolvedValue({
      connected: true,
      reconnectRequired: false
    });

    const redirectUrl = await service.completeGitlabConnectCallback("oauth-code", "signed-state");

    expect(jwtService.verify).toHaveBeenCalledWith("signed-state", {
      secret: expect.any(String)
    });
    expect(gitlabService.exchangeAuthorizationCode).toHaveBeenCalledWith("user-1", "oauth-code");
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "gitlab_connection",
      entityId: "user-1",
      action: "auth.gitlab.connect"
    });
    expect(redirectUrl).toBe("http://localhost:3000/account?gitlab=connected");
  });
});
