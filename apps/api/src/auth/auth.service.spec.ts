import { BadRequestException } from "@nestjs/common";
import { GlobalRole, InviteAccessMode, InviteStatus, ProjectRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

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
      notificationPreference: {
        create: jest.fn()
      },
      projectMember: {
        upsert: jest.fn()
      },
      session: {
        create: jest.fn()
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations))
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
      syncProjectRepositoryAccess: jest.fn()
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
        directEmail: expect.objectContaining({
          text: expect.stringContaining("/accept-invite?token="),
          html: expect.stringContaining("Accept invite")
        })
      })
    );
    const emailPayload = queueService.enqueueEmail.mock.calls[0][0];
    const inviteText = emailPayload.directEmail.text as string;
    const inviteHtml = emailPayload.directEmail.html as string;
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
        email: "user@example.com",
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
        name: "Example User",
        globalRole: "editor"
      }
    });
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
    prisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    prisma.notificationEvent = {
      create: jest.fn().mockResolvedValue({ id: "event-1" })
    };

    const result = await service.requestPasswordReset({
      email: "USER@example.com"
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      select: { id: true }
    });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "PASSWORD_RESET",
        status: "PENDING",
        payload: {
          template: "password-reset",
          resetToken: expect.any(String)
        }
      }
    });
    expect(queueService.enqueueEmail).toHaveBeenCalledWith({ notificationEventId: "event-1" });
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
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.requestPasswordReset({
      email: "missing@example.com"
    });

    expect(queueService.enqueueEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ accepted: true });
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
      username: "luis"
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
      username: "luis"
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
