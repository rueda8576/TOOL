import { NotificationEventType, NotificationStatus, TaskStatus, PrismaClient } from "@prisma/client";
import type { Job, Queue } from "bullmq";

export const processDueReminderJob = async (
  prisma: PrismaClient,
  emailQueue: Queue,
  _job: Job<{ triggeredBy: "scheduler" | "manual" }>
): Promise<void> => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const tasks = await prisma.task.findMany({
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

  for (const task of tasks) {
    if (!task.assigneeId || !task.dueDate || !task.assignee) {
      continue;
    }

    const prefs = task.assignee.notificationPreference;
    if (!prefs || !prefs.emailEnabled || !prefs.taskDue) {
      continue;
    }

    const reminderWindowMs = prefs.taskDueLeadHours * 60 * 60 * 1000;
    const dueInMs = task.dueDate.getTime() - now.getTime();

    if (dueInMs < 0 || dueInMs > reminderWindowMs) {
      continue;
    }

    const alreadyNotified = await prisma.notificationEvent.findFirst({
      where: {
        userId: task.assigneeId,
        type: NotificationEventType.TASK_DUE,
        createdAt: {
          gte: startOfDay
        },
        payload: {
          path: ["taskId"],
          equals: task.id
        }
      },
      select: { id: true }
    });

    if (alreadyNotified) {
      continue;
    }

    const event = await prisma.notificationEvent.create({
      data: {
        userId: task.assigneeId,
        type: NotificationEventType.TASK_DUE,
        status: NotificationStatus.PENDING,
        payload: {
          taskId: task.id,
          taskTitle: task.title,
          dueDate: task.dueDate.toISOString(),
          leadHours: prefs.taskDueLeadHours
        }
      }
    });

    await emailQueue.add(
      "send-email",
      {
        notificationEventId: event.id
      },
      {
        attempts: 5,
        removeOnComplete: 500,
        removeOnFail: 500
      }
    );
  }
};
