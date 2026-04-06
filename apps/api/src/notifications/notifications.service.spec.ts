import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  const makeService = () => {
    const prisma: any = {
      notificationPreference: {
        upsert: jest.fn()
      }
    };
    const auditService: any = {
      log: jest.fn().mockResolvedValue(undefined)
    };

    return {
      service: new NotificationsService(prisma, auditService),
      prisma,
      auditService
    };
  };

  it("creates default preferences lazily on first read", async () => {
    const { service, prisma } = makeService();
    prisma.notificationPreference.upsert.mockResolvedValue({
      id: "pref-1",
      emailEnabled: true,
      taskAssigned: true,
      taskDue: true,
      mentionInWiki: true,
      mentionInTaskComments: true,
      taskDueLeadHours: 24
    });

    await expect(
      service.getPreferences({ userId: "user-1", email: "user@example.com", globalRole: "reader" })
    ).resolves.toEqual({
      emailEnabled: true,
      taskAssigned: true,
      taskDue: true,
      mentionInWiki: true,
      mentionInTaskComments: true,
      taskDueLeadHours: 24
    });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1" },
      update: {}
    });
  });

  it("updates preferences and emits an audit log", async () => {
    const { service, prisma, auditService } = makeService();
    prisma.notificationPreference.upsert.mockResolvedValue({
      id: "pref-2",
      emailEnabled: false,
      taskAssigned: true,
      taskDue: false,
      mentionInWiki: false,
      mentionInTaskComments: true,
      taskDueLeadHours: 6
    });

    await expect(
      service.updatePreferences(
        { userId: "user-1", email: "user@example.com", globalRole: "reader" },
        { emailEnabled: false, taskDue: false, mentionInWiki: false, taskDueLeadHours: 6 }
      )
    ).resolves.toEqual({
      emailEnabled: false,
      taskAssigned: true,
      taskDue: false,
      mentionInWiki: false,
      mentionInTaskComments: true,
      taskDueLeadHours: 6
    });

    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      entityType: "notification_preference",
      entityId: "pref-2",
      action: "notification.preference.update"
    });
  });
});
