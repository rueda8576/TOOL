import type { Job } from "bullmq";
import { NotificationEventType, NotificationStatus, PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";

import { getEnv } from "../config/env";

const env = getEnv();

type EmailJobPayload = {
  notificationEventId?: string;
  directEmail?: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  };
};

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
  auth: env.SMTP_USER
    ? {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    : undefined
});

type NotificationPreferenceSnapshot = {
  emailEnabled: boolean;
  taskAssigned: boolean;
  taskDue: boolean;
  mentionInTaskComments: boolean;
} | null;

type NotificationEventWithRecipient = {
  id: string;
  type: NotificationEventType;
  payload: unknown;
  user: {
    email: string;
    notificationPreference: NotificationPreferenceSnapshot;
  };
};

const transactionalEventTypes = new Set<NotificationEventType>([
  NotificationEventType.PASSWORD_RESET,
  NotificationEventType.PROJECT_INVITE
]);

const getPayloadText = (payload: unknown, key: string): string | undefined => {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const renderNotificationEmail = (
  event: Pick<NotificationEventWithRecipient, "type" | "payload">
): { subject: string; text: string } => {
  switch (event.type) {
    case NotificationEventType.TASK_ASSIGNED: {
      const taskTitle = getPayloadText(event.payload, "taskTitle") ?? "A task";
      return {
        subject: "Atlasium task assigned",
        text: `${taskTitle} was assigned to you in Atlasium.\nOpen the workspace to review the task.`
      };
    }
    case NotificationEventType.TASK_DUE: {
      const taskTitle = getPayloadText(event.payload, "taskTitle") ?? "A task";
      const dueDate = getPayloadText(event.payload, "dueDate");
      return {
        subject: "Atlasium task due reminder",
        text: dueDate
          ? `${taskTitle} is approaching its due date: ${dueDate}.\nOpen the workspace to review the task.`
          : `${taskTitle} is approaching its due date.\nOpen the workspace to review the task.`
      };
    }
    case NotificationEventType.TASK_MENTION:
      return {
        subject: "Atlasium task mention",
        text: "You were mentioned in a task discussion in Atlasium.\nOpen the workspace to review the mention."
      };
    case NotificationEventType.DOC_COMPILED: {
      const status = getPayloadText(event.payload, "status") ?? getPayloadText(event.payload, "compileStatus") ?? "updated";
      return {
        subject: "Atlasium document compile status",
        text: `A document compile finished with status: ${status}.\nOpen the workspace to review the document.`
      };
    }
    case NotificationEventType.PROJECT_INVITE:
      return {
        subject: "Atlasium project invitation",
        text: "You have been invited to an Atlasium workspace.\nOpen the invitation link to continue."
      };
    case NotificationEventType.PASSWORD_RESET:
      throw new Error("Password reset email is missing its transactional delivery payload");
    default:
      return {
        subject: "Atlasium notification",
        text: "A workspace notification is available in Atlasium."
      };
  }
};

const shouldDeliverNotificationEmail = (event: NotificationEventWithRecipient): boolean => {
  if (transactionalEventTypes.has(event.type)) {
    return true;
  }

  const prefs = event.user.notificationPreference;
  if (!prefs?.emailEnabled) {
    return false;
  }

  switch (event.type) {
    case NotificationEventType.TASK_ASSIGNED:
      return prefs.taskAssigned;
    case NotificationEventType.TASK_DUE:
      return prefs.taskDue;
    case NotificationEventType.TASK_MENTION:
      return prefs.mentionInTaskComments;
    default:
      return true;
  }
};

const markNotificationSent = async (prisma: PrismaClient, notificationEventId?: string): Promise<void> => {
  if (!notificationEventId) {
    return;
  }

  await prisma.notificationEvent.update({
    where: { id: notificationEventId },
    data: {
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      errorMessage: null
    }
  });
};

const markNotificationFailed = async (
  prisma: PrismaClient,
  notificationEventId: string | undefined,
  error: unknown
): Promise<void> => {
  if (!notificationEventId) {
    return;
  }

  await prisma.notificationEvent.update({
    where: { id: notificationEventId },
    data: {
      status: NotificationStatus.FAILED,
      errorMessage: (error as Error).message
    }
  });
};

export const processEmailJob = async (
  prisma: PrismaClient,
  job: Job<EmailJobPayload>
): Promise<void> => {
  if (job.data.directEmail) {
    try {
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to: job.data.directEmail.to,
        subject: job.data.directEmail.subject,
        text: job.data.directEmail.text,
        html: job.data.directEmail.html
      });
      await markNotificationSent(prisma, job.data.notificationEventId);
    } catch (error) {
      await markNotificationFailed(prisma, job.data.notificationEventId, error);
      throw error;
    }
    return;
  }

  if (!job.data.notificationEventId) {
    return;
  }

  const event = await prisma.notificationEvent.findUnique({
    where: {
      id: job.data.notificationEventId
    },
    include: {
      user: {
        include: {
          notificationPreference: true
        }
      }
    }
  });

  if (!event) {
    return;
  }

  if (!shouldDeliverNotificationEmail(event)) {
    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: {
        status: NotificationStatus.CANCELED,
        errorMessage: "Email notifications disabled"
      }
    });
    return;
  }

  const email = renderNotificationEmail(event);

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: event.user.email,
      subject: email.subject,
      text: email.text
    });

    await markNotificationSent(prisma, event.id);
  } catch (error) {
    await markNotificationFailed(prisma, event.id, error);
    throw error;
  }
};
