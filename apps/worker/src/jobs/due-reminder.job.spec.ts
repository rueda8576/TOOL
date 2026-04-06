import { NotificationEventType, NotificationStatus, TaskStatus } from "@prisma/client";

import { processDueReminderJob } from "./due-reminder.job";

describe("processDueReminderJob", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("queries only active assigned tasks and enqueues reminders for eligible due tasks", async () => {
    const dueSoon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "task-1",
            title: "Prepare slides",
            assigneeId: "user-1",
            dueDate: dueSoon,
            assignee: {
              notificationPreference: {
                emailEnabled: true,
                taskDue: true,
                taskDueLeadHours: 24
              }
            }
          },
          {
            id: "task-2",
            title: "Already outside window",
            assigneeId: "user-2",
            dueDate: new Date(Date.now() + 72 * 60 * 60 * 1000),
            assignee: {
              notificationPreference: {
                emailEnabled: true,
                taskDue: true,
                taskDueLeadHours: 24
              }
            }
          }
        ])
      },
      notificationEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "event-1" })
      }
    } as any;
    const emailQueue = {
      add: jest.fn().mockResolvedValue(undefined)
    } as any;

    await processDueReminderJob(prisma, emailQueue, { data: { triggeredBy: "scheduler" } } as any);

    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        assigneeId: {
          not: null
        },
        dueDate: {
          not: null
        },
        status: {
          not: TaskStatus.DONE
        }
      },
      include: {
        assignee: {
          include: {
            notificationPreference: true
          }
        }
      }
    });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: NotificationEventType.TASK_DUE,
        status: NotificationStatus.PENDING,
        payload: {
          taskId: "task-1",
          taskTitle: "Prepare slides",
          dueDate: dueSoon.toISOString(),
          leadHours: 24
        }
      }
    });
    expect(emailQueue.add).toHaveBeenCalledWith(
      "send-email",
      {
        notificationEventId: "event-1"
      },
      {
        attempts: 5,
        removeOnComplete: 500,
        removeOnFail: 500
      }
    );
  });

  it("skips reminder creation when preferences disable email or a same-day event already exists", async () => {
    const dueSoon = new Date(Date.now() + 60 * 60 * 1000);
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "task-1",
            title: "Disabled prefs",
            assigneeId: "user-1",
            dueDate: dueSoon,
            assignee: {
              notificationPreference: {
                emailEnabled: false,
                taskDue: true,
                taskDueLeadHours: 24
              }
            }
          },
          {
            id: "task-2",
            title: "Already reminded",
            assigneeId: "user-2",
            dueDate: dueSoon,
            assignee: {
              notificationPreference: {
                emailEnabled: true,
                taskDue: true,
                taskDueLeadHours: 24
              }
            }
          }
        ])
      },
      notificationEvent: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "existing-event" }),
        create: jest.fn()
      }
    } as any;
    const emailQueue = {
      add: jest.fn()
    } as any;

    await processDueReminderJob(prisma, emailQueue, { data: { triggeredBy: "manual" } } as any);

    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
  });
});
