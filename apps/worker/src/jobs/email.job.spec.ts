import { NotificationStatus } from "@prisma/client";

describe("processEmailJob", () => {
  const loadJob = async (sendMail: jest.Mock) => {
    jest.resetModules();
    process.env.SMTP_FROM = "no-reply@atlasium.info";
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_PORT = "1025";

    jest.doMock("nodemailer", () => ({
      __esModule: true,
      default: {
        createTransport: jest.fn(() => ({ sendMail }))
      }
    }));

    return import("./email.job");
  };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("sends direct emails without touching notification persistence", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn(),
        update: jest.fn()
      }
    } as any;

    await processEmailJob(
      prisma,
      {
        data: {
          directEmail: {
            to: "user@example.com",
            subject: "Atlasium",
            text: "Hello",
            html: "<p>Hello</p>"
          }
        }
      } as any
    );

    expect(sendMail).toHaveBeenCalledWith({
      from: "no-reply@atlasium.info",
      to: "user@example.com",
      subject: "Atlasium",
      text: "Hello",
      html: "<p>Hello</p>"
    });
    expect(prisma.notificationEvent.findUnique).not.toHaveBeenCalled();
  });

  it("returns silently when the job carries no supported payload", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn(),
        update: jest.fn()
      }
    } as any;

    await processEmailJob(prisma, { data: {} } as any);

    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.findUnique).not.toHaveBeenCalled();
  });

  it("returns silently when the referenced notification event no longer exists", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "missing-event" } } as any);

    expect(prisma.notificationEvent.findUnique).toHaveBeenCalledWith({
      where: { id: "missing-event" },
      include: {
        user: {
          include: {
            notificationPreference: true
          }
        }
      }
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).not.toHaveBeenCalled();
  });

  it("cancels notification emails when the user disabled email notifications", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-1",
          type: "TASK_ASSIGNED",
          payload: { taskId: "task-1" },
          user: {
            email: "user@example.com",
            notificationPreference: {
              emailEnabled: false
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "event-1" } } as any);

    expect(sendMail).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: {
        status: NotificationStatus.CANCELED,
        errorMessage: "Email notifications disabled"
      }
    });
  });

  it("marks notification events as sent when email delivery succeeds", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-2",
          type: "TASK_DUE",
          payload: { taskId: "task-1" },
          user: {
            email: "user@example.com",
            notificationPreference: {
              emailEnabled: true
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "event-2" } } as any);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: "event-2" },
      data: {
        status: NotificationStatus.SENT,
        sentAt: expect.any(Date),
        errorMessage: null
      }
    });
  });

  it("marks notification events as failed and rethrows when SMTP delivery fails", async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error("smtp offline"));
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-3",
          type: "TASK_DUE",
          payload: { taskId: "task-1" },
          user: {
            email: "user@example.com",
            notificationPreference: {
              emailEnabled: true
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await expect(processEmailJob(prisma, { data: { notificationEventId: "event-3" } } as any)).rejects.toThrow(
      "smtp offline"
    );

    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: "event-3" },
      data: {
        status: NotificationStatus.FAILED,
        errorMessage: "smtp offline"
      }
    });
  });
});
