import { createServer, Server } from "http";

import type { PrismaClient } from "@prisma/client";
import type { Queue, Worker } from "bullmq";

export type WorkerHealthStatus = "ok" | "unhealthy";

export type WorkerHealthCheck = {
  name: string;
  status: WorkerHealthStatus;
  detail?: string;
};

export type WorkerHealthPayload = {
  status: WorkerHealthStatus;
  service: "atlasium-worker";
  timestamp: string;
  startedAt: string;
  uptimeSeconds: number;
  checks: WorkerHealthCheck[];
};

type NamedProbe = {
  name: string;
  probe: () => Promise<void>;
};

export type WorkerHealthServerParams = {
  prisma: PrismaClient;
  queues: Array<{ name: string; queue: Queue }>;
  workers: Array<{ name: string; worker: Worker }>;
  startedAt: Date;
  port: number;
  timeoutMs?: number;
};

const sanitizeHealthDetail = (value: string): string =>
  value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL]")
    .replaceAll(/redis:\/\/[^\s]+/gi, "[REDIS_URL]")
    .slice(0, 240);

const withTimeout = async (label: string, promise: Promise<void>, timeoutMs: number): Promise<void> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} probe timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const runNamedProbe = async (probe: NamedProbe, timeoutMs: number): Promise<WorkerHealthCheck> => {
  try {
    await withTimeout(probe.name, probe.probe(), timeoutMs);
    return {
      name: probe.name,
      status: "ok"
    };
  } catch (error) {
    return {
      name: probe.name,
      status: "unhealthy",
      detail: sanitizeHealthDetail((error as Error).message)
    };
  }
};

export const runWorkerHealthCheck = async (
  params: Omit<WorkerHealthServerParams, "port">
): Promise<WorkerHealthPayload> => {
  const timeoutMs = params.timeoutMs ?? 2_000;
  const probes: NamedProbe[] = [
    {
      name: "database",
      probe: async () => {
        await params.prisma.$queryRaw`SELECT 1`;
      }
    },
    ...params.queues.map((entry) => ({
      name: `queue:${entry.name}`,
      probe: async () => {
        await entry.queue.waitUntilReady();
      }
    })),
    ...params.workers.map((entry) => ({
      name: `worker:${entry.name}`,
      probe: async () => {
        await entry.worker.waitUntilReady();
      }
    }))
  ];

  const checks = await Promise.all(probes.map((probe) => runNamedProbe(probe, timeoutMs)));
  const status = checks.every((check) => check.status === "ok") ? "ok" : "unhealthy";

  return {
    status,
    service: "atlasium-worker",
    timestamp: new Date().toISOString(),
    startedAt: params.startedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((Date.now() - params.startedAt.getTime()) / 1_000)),
    checks
  };
};

export const startWorkerHealthServer = (params: WorkerHealthServerParams): Server => {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url?.split("?")[0] !== "/health") {
      response.writeHead(404, {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({ status: "not_found" }));
      return;
    }

    const payload = await runWorkerHealthCheck(params);
    response.writeHead(payload.status === "ok" ? 200 : 503, {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json"
    });
    response.end(JSON.stringify(payload));
  });

  server.listen(params.port, "0.0.0.0");
  return server;
};
