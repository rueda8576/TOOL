import type { Job } from "bullmq";
import { NotificationStatus, PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";

import { getEnv } from "../config/env";

const env = getEnv();

type EmailJobPayload = {
  notificationEventId?: string;
  directEmail?: {
    to: string;
    subject: string;
    text: string;
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

export const processEmailJob = async (
  prisma: PrismaClient,
  job: Job<EmailJobPayload>
): Promise<void> => {
  if (job.data.directEmail) {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: job.data.directEmail.to,
      subject: job.data.directEmail.subject,
      text: job.data.directEmail.text
    });
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

  if (!event.user.notificationPreference?.emailEnabled) {
    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: {
        status: NotificationStatus.CANCELED,
        errorMessage: "Email notifications disabled"
      }
    });
    return;
  }

  const payload = event.payload as Record<string, unknown>;

  const subject = `Doctoral Platform notification: ${event.type}`;
  const text = `Type: ${event.type}\nPayload: ${JSON.stringify(payload, null, 2)}`;

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: event.user.email,
      subject,
      text
    });

    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        errorMessage: null
      }
    });
  } catch (error) {
    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: {
        status: NotificationStatus.FAILED,
        errorMessage: (error as Error).message
      }
    });

    throw error;
  }
};
