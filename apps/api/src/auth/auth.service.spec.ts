import { BadRequestException } from "@nestjs/common";
import { GlobalRole, InviteAccessMode, InviteStatus, ProjectRole } from "@prisma/client";

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
