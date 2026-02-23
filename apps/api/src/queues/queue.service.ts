import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { JobsOptions, Queue } from "bullmq";

import { getEnv } from "../config/env";

type EmailJobPayload = {
  notificationEventId?: string;
  directEmail?: {
    to: string;
    subject: string;
    text: string;
  };
};

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queueConnection = {
    url: getEnv().REDIS_URL
  };
  private readonly compileQueue = new Queue("latex-compile", { connection: this.queueConnection });
  private readonly emailQueue = new Queue("email-notifications", { connection: this.queueConnection });
  private readonly backupQueue = new Queue("backups", { connection: this.queueConnection });

  async enqueueCompile(payload: { documentVersionId: string; compileJobId: string }, opts?: JobsOptions): Promise<string> {
    const job = await this.compileQueue.add("compile", payload, {
      attempts: 3,
      removeOnComplete: 200,
      removeOnFail: 200,
      ...opts
    });

    return job.id?.toString() ?? "";
  }

  async enqueueEmail(payload: EmailJobPayload, opts?: JobsOptions): Promise<string> {
    if (!payload.notificationEventId && !payload.directEmail) {
      throw new Error("enqueueEmail requires notificationEventId or directEmail payload");
    }

    const job = await this.emailQueue.add("send-email", payload, {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
      ...opts
    });

    return job.id?.toString() ?? "";
  }

  async enqueueBackup(payload: { requestedBy?: string }, opts?: JobsOptions): Promise<string> {
    const job = await this.backupQueue.add("run-backup", payload, {
      attempts: 2,
      removeOnComplete: 50,
      removeOnFail: 50,
      ...opts
    });

    return job.id?.toString() ?? "";
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.compileQueue.close(), this.emailQueue.close(), this.backupQueue.close()]);
    this.logger.log("Queue connections closed");
  }
}
