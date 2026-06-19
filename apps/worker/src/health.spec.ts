import { once } from "events";

import { runWorkerHealthCheck, startWorkerHealthServer } from "./health";

describe("worker health", () => {
  const startedAt = new Date("2026-06-19T10:00:00.000Z");

  const makeProbeDeps = (overrides?: {
    database?: jest.Mock;
    queue?: jest.Mock;
    worker?: jest.Mock;
  }) => ({
    prisma: {
      $queryRaw: overrides?.database ?? jest.fn().mockResolvedValue([{ "?column?": 1 }])
    } as any,
    queues: [
      {
        name: "backups",
        queue: {
          waitUntilReady: overrides?.queue ?? jest.fn().mockResolvedValue(undefined)
        } as any
      }
    ],
    workers: [
      {
        name: "backups",
        worker: {
          waitUntilReady: overrides?.worker ?? jest.fn().mockResolvedValue(undefined)
        } as any
      }
    ],
    startedAt,
    timeoutMs: 250
  });

  it("reports ok when database, queues, and workers are ready", async () => {
    const result = await runWorkerHealthCheck(makeProbeDeps());

    expect(result).toEqual(expect.objectContaining({
      status: "ok",
      service: "atlasium-worker",
      startedAt: "2026-06-19T10:00:00.000Z"
    }));
    expect(result.checks).toEqual([
      { name: "database", status: "ok" },
      { name: "queue:backups", status: "ok" },
      { name: "worker:backups", status: "ok" }
    ]);
  });

  it("reports unhealthy and redacts connection strings from dependency errors", async () => {
    const result = await runWorkerHealthCheck(
      makeProbeDeps({
        database: jest.fn().mockRejectedValue(new Error("cannot connect to postgresql://user:pass@db:5432/app?schema=public"))
      })
    );

    expect(result.status).toBe("unhealthy");
    expect(result.checks[0]).toEqual({
      name: "database",
      status: "unhealthy",
      detail: "cannot connect to [DATABASE_URL]"
    });
  });

  it("reports a timed-out dependency probe as unhealthy", async () => {
    const result = await runWorkerHealthCheck(
      makeProbeDeps({
        worker: jest.fn().mockReturnValue(new Promise(() => undefined))
      })
    );

    expect(result.status).toBe("unhealthy");
    expect(result.checks.find((check) => check.name === "worker:backups")).toEqual({
      name: "worker:backups",
      status: "unhealthy",
      detail: "worker:backups probe timed out after 250ms"
    });
  });

  it("serves ok health JSON when dependencies are ready", async () => {
    const server = startWorkerHealthServer({
      ...makeProbeDeps(),
      port: 0
    });
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Health server did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health?probe=ready`);
    const payload = await response.json() as { status: string; service: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      status: "ok",
      service: "atlasium-worker"
    }));

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("returns no-store 404 JSON for non-health routes", async () => {
    const server = startWorkerHealthServer({
      ...makeProbeDeps(),
      port: 0
    });
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Health server did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { status: string };

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload).toEqual({ status: "not_found" });

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("serves health JSON with a 503 when a dependency is unhealthy", async () => {
    const server = startWorkerHealthServer({
      ...makeProbeDeps({
        queue: jest.fn().mockRejectedValue(new Error("redis://:secret@redis:6379 refused"))
      }),
      port: 0
    });
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Health server did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const payload = await response.json() as { status: string; checks: Array<{ detail?: string }> };

    expect(response.status).toBe(503);
    expect(payload.status).toBe("unhealthy");
    expect(JSON.stringify(payload)).not.toContain("secret");

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });
});
