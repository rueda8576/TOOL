import "./config/load-env";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";

import { getEnv } from "./config/env";
import { processBackupJob } from "./jobs/backup.job";
import { processDueReminderJob } from "./jobs/due-reminder.job";
import { processEmailJob } from "./jobs/email.job";
import { processLatexCompileJob } from "./jobs/latex-compile.job";

const env = getEnv();
const logger = {
  log: (message: string): void => {
    console.log(`[worker] ${message}`);
  },
  error: (message: string): void => {
    console.error(`[worker] ${message}`);
  }
};

const prisma = new PrismaClient();
const queueConnection = { url: env.REDIS_URL };
const emailQueue = new Queue("email-notifications", { connection: queueConnection });
const backupQueue = new Queue("backups", { connection: queueConnection });
const reminderQueue = new Queue("task-reminders", { connection: queueConnection });

const compileWorker = new Worker(
  "latex-compile",
  async (job) => {
    await processLatexCompileJob(prisma, job);
  },
  {
    connection: queueConnection,
    concurrency: 2
  }
);

const emailWorker = new Worker(
  "email-notifications",
  async (job) => {
    await processEmailJob(prisma, job);
  },
  {
    connection: queueConnection,
    concurrency: 5
  }
);

const backupWorker = new Worker(
  "backups",
  async (job) => {
    await processBackupJob(prisma, job);
  },
  {
    connection: queueConnection,
    concurrency: 1
  }
);

const reminderWorker = new Worker(
  "task-reminders",
  async (job) => {
    await processDueReminderJob(prisma, emailQueue, job);
  },
  {
    connection: queueConnection,
    concurrency: 1
  }
);

for (const [name, worker] of [
  ["latex-compile", compileWorker],
  ["email-notifications", emailWorker],
  ["backups", backupWorker],
  ["task-reminders", reminderWorker]
] as const) {
  worker.on("completed", (job) => {
    logger.log(`[${name}] completed job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    logger.error(`[${name}] failed job ${job?.id ?? "unknown"}: ${error.message}`);
  });
}

const shutdown = async (): Promise<void> => {
  logger.log("Shutting down workers...");
  await Promise.all([compileWorker.close(), emailWorker.close(), backupWorker.close(), reminderWorker.close()]);
  await Promise.all([emailQueue.close(), backupQueue.close(), reminderQueue.close()]);
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void backupQueue
  .add(
    "run-backup",
    { requestedBy: "system" },
    {
      repeat: {
        pattern: "0 2 * * *"
      },
      jobId: "daily-backup"
    }
  )
  .then(() => logger.log("Daily backup scheduler registered (02:00 server time)."))
  .catch((error: Error) => logger.error(`Failed to register backup scheduler: ${error.message}`));

void reminderQueue
  .add(
    "scan-task-due-reminders",
    { triggeredBy: "scheduler" },
    {
      repeat: {
        pattern: "0 * * * *"
      },
      jobId: "hourly-task-due-reminder"
    }
  )
  .then(() => logger.log("Task due reminder scheduler registered (hourly)."))
  .catch((error: Error) => logger.error(`Failed to register reminder scheduler: ${error.message}`));

logger.log("Worker started");
