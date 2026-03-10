import { BadRequestException } from "@nestjs/common";
import { GlobalRole, InviteAccessMode, InviteStatus } from "@prisma/client";

import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const makeService = (): {
    service: AuthService;
    prisma: any;
    jwtService: any;
    queueService: any;
    auditService: any;
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
      sign: jest.fn().mockReturnValue("jwt-token")
    };

    const queueService: any = {
      enqueueEmail: jest.fn()
    };

    const auditService: any = {
      log: jest.fn()
    };

    return {
      service: new AuthService(prisma, jwtService, queueService, auditService),
      prisma,
      jwtService,
      queueService,
      auditService
    };
  };

  it("creates selected-project invite with inviteProjects and acceptance URL", async () => {
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
        projectIds: ["p1", "p2"]
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
          inviteProjects: {
            create: [{ projectId: "p1" }, { projectId: "p2" }]
          }
        })
      })
    );
    expect(queueService.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        directEmail: expect.objectContaining({
          text: expect.stringContaining("/accept-invite?token=")
        })
      })
    );
    expect(result.inviteId).toBe("invite-1");
    expect(result.token).toBeTruthy();
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("rejects all-projects invite payload when projectIds are provided", async () => {
    const { service } = makeService();

    await expect(
      service.invite(
        {
          email: "invitee@example.com",
          globalRole: "reader",
          accessMode: "all",
          projectIds: ["p1"]
        },
        "sender-1"
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts all-projects invite and assigns all active projects", async () => {
    const { service, prisma } = makeService();

    prisma.invite.findFirst.mockResolvedValue({
      id: "invite-1",
      email: "invitee@example.com",
      globalRole: GlobalRole.READER,
      accessMode: InviteAccessMode.ALL_CURRENT_PROJECTS,
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
        }
      })
    );
    expect(result.projectIds).toEqual(["p1", "p2"]);
  });

  it("keeps legacy projectId fallback when accepting selected invite without InviteProject rows", async () => {
    const { service, prisma } = makeService();

    prisma.invite.findFirst.mockResolvedValue({
      id: "invite-legacy",
      email: "invitee@example.com",
      globalRole: GlobalRole.EDITOR,
      accessMode: InviteAccessMode.SELECTED_PROJECTS,
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
    expect(result.projectId).toBe("legacy-project");
    expect(result.projectIds).toEqual(["legacy-project"]);
  });
});
