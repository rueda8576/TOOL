import { NotificationStatus } from "@prisma/client";

describe("processEmailJob", () => {
  const loadJob = async (sendMail: jest.Mock, envOverrides: Record<string, string | undefined> = {}) => {
    jest.resetModules();
    process.env.SMTP_FROM = "no-reply@atlasium.info";
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_PORT = "1025";
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    const createTransport = jest.fn(() => ({ sendMail }));
    jest.doMock("nodemailer", () => ({
      __esModule: true,
      default: {
        createTransport
      }
    }));

    return {
      ...(await import("./email.job")),
      createTransport
    };
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

  it("marks direct transactional emails as sent when a notification event id is provided", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(
      prisma,
      {
        data: {
          notificationEventId: "event-1",
          directEmail: {
            to: "user@example.com",
            subject: "Atlasium password reset",
            text: "Reset password: https://atlasium.example/reset-password?token=secret-token"
          }
        }
      } as any
    );

    expect(prisma.notificationEvent.findUnique).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: {
        status: NotificationStatus.SENT,
        sentAt: expect.any(Date),
        errorMessage: null
      }
    });
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
              emailEnabled: true,
              taskDue: true
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "event-2" } } as any);

    expect(sendMail).toHaveBeenCalledWith({
      from: "no-reply@atlasium.info",
      to: "user@example.com",
      subject: "Atlasium task due reminder",
      text: expect.stringContaining("Open the workspace to review the task.")
    });
    expect(sendMail.mock.calls[0][0].subject).not.toContain(["Doctoral", "Platform"].join(" "));
    expect(sendMail.mock.calls[0][0].text).not.toContain("Payload:");
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: "event-2" },
      data: {
        status: NotificationStatus.SENT,
        sentAt: expect.any(Date),
        errorMessage: null
      }
    });
  });

  it("renders assigned task emails with payload titles", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-assigned",
          type: "TASK_ASSIGNED",
          payload: { taskTitle: "Review protocol" },
          user: {
            email: "user@example.com",
            notificationPreference: {
              emailEnabled: true,
              taskAssigned: true
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "event-assigned" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Atlasium task assigned",
        text: "Review protocol was assigned to you in Atlasium.\nOpen the workspace to review the task."
      })
    );
  });

  it("configures SMTP auth when credentials are present", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { createTransport, processEmailJob } = await loadJob(sendMail, {
      SMTP_USER: "smtp-user",
      SMTP_PASS: "smtp-pass"
    });
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn(),
        update: jest.fn()
      }
    } as any;

    await processEmailJob(prisma, {
      data: {
        directEmail: {
          to: "user@example.com",
          subject: "Atlasium",
          text: "Hello"
        }
      }
    } as any);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      auth: {
        user: "smtp-user",
        pass: "smtp-pass"
      }
    }));
  });

  it("uses default task title text when payload text is missing", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-assigned-default",
          type: "TASK_ASSIGNED",
          payload: null,
          user: {
            email: "user@example.com",
            notificationPreference: {
              emailEnabled: true,
              taskAssigned: true
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "event-assigned-default" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "A task was assigned to you in Atlasium.\nOpen the workspace to review the task."
      })
    );
  });

  it("renders due reminder emails with due dates when present", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-due",
          type: "TASK_DUE",
          payload: { taskTitle: "Submit draft", dueDate: "2026-06-20" },
          user: {
            email: "user@example.com",
            notificationPreference: {
              emailEnabled: true,
              taskDue: true
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "event-due" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Atlasium task due reminder",
        text: "Submit draft is approaching its due date: 2026-06-20.\nOpen the workspace to review the task."
      })
    );
  });

  it("renders task mention emails when mention preferences allow it", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-mention",
          type: "TASK_MENTION",
          payload: {},
          user: {
            email: "user@example.com",
            notificationPreference: {
              emailEnabled: true,
              mentionInTaskComments: true
            }
          }
        }),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await processEmailJob(prisma, { data: { notificationEventId: "event-mention" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Atlasium task mention",
        text: "You were mentioned in a task discussion in Atlasium.\nOpen the workspace to review the mention."
      })
    );
  });

  it("renders document compile status from payload status fields", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-doc",
          type: "DOC_COMPILED",
          payload: { compileStatus: "FAILED" },
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

    await processEmailJob(prisma, { data: { notificationEventId: "event-doc" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Atlasium document compile status",
        text: "A document compile finished with status: FAILED.\nOpen the workspace to review the document."
      })
    );
  });

  it("uses updated as the document compile fallback status", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-doc-default",
          type: "DOC_COMPILED",
          payload: {},
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

    await processEmailJob(prisma, { data: { notificationEventId: "event-doc-default" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "A document compile finished with status: updated.\nOpen the workspace to review the document."
      })
    );
  });

  it("rejects password reset notifications that do not carry direct transactional email payloads", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-password-reset",
          type: "PASSWORD_RESET",
          payload: {},
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

    await expect(processEmailJob(prisma, { data: { notificationEventId: "event-password-reset" } } as any)).rejects.toThrow(
      "Password reset email is missing its transactional delivery payload"
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("delivers project invitations even when user email preferences are disabled", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-invite",
          type: "PROJECT_INVITE",
          payload: {},
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

    await processEmailJob(prisma, { data: { notificationEventId: "event-invite" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Atlasium project invitation",
        text: "You have been invited to an Atlasium workspace.\nOpen the invitation link to continue."
      })
    );
  });

  it("uses the fallback notification template for unhandled event types", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "event-custom",
          type: "CUSTOM_EVENT",
          payload: null,
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

    await processEmailJob(prisma, { data: { notificationEventId: "event-custom" } } as any);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Atlasium notification",
        text: "A workspace notification is available in Atlasium."
      })
    );
  });

  it("marks direct transactional emails as failed and rethrows when SMTP delivery fails", async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error("smtp offline"));
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined)
      }
    } as any;

    await expect(
      processEmailJob(
        prisma,
        {
          data: {
            notificationEventId: "event-reset",
            directEmail: {
              to: "user@example.com",
              subject: "Atlasium password reset",
              text: "Reset password"
            }
          }
        } as any
      )
    ).rejects.toThrow("smtp offline");

    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: "event-reset" },
      data: {
        status: NotificationStatus.FAILED,
        errorMessage: "smtp offline"
      }
    });
  });

  it("rethrows direct email failures without persistence when no notification id is present", async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error("smtp offline"));
    const { processEmailJob } = await loadJob(sendMail);
    const prisma = {
      notificationEvent: {
        findUnique: jest.fn(),
        update: jest.fn()
      }
    } as any;

    await expect(
      processEmailJob(
        prisma,
        {
          data: {
            directEmail: {
              to: "user@example.com",
              subject: "Atlasium password reset",
              text: "Reset password"
            }
          }
        } as any
      )
    ).rejects.toThrow("smtp offline");

    expect(prisma.notificationEvent.update).not.toHaveBeenCalled();
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
              emailEnabled: true,
              taskDue: true
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
