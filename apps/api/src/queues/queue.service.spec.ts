describe("QueueService", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const loadService = async () => {
    jest.resetModules();
    const queues = new Map<string, { add: jest.Mock; close: jest.Mock }>();

    jest.doMock("bullmq", () => ({
      Queue: jest.fn().mockImplementation((name: string) => {
        const instance = {
          add: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined)
        };
        queues.set(name, instance);
        return instance;
      })
    }));

    jest.doMock("../config/env", () => ({
      getEnv: () => ({
        REDIS_URL: "redis://localhost:6379"
      })
    }));

    const { QueueService } = await import("./queue.service");
    return {
      service: new QueueService(),
      queues
    };
  };

  it("enqueues compile jobs with retry defaults", async () => {
    const { service, queues } = await loadService();
    queues.get("latex-compile")!.add.mockResolvedValue({ id: 42 });

    await expect(
      service.enqueueCompile({ documentVersionId: "version-1", compileJobId: "job-1" })
    ).resolves.toBe("42");

    expect(queues.get("latex-compile")!.add).toHaveBeenCalledWith(
      "compile",
      { documentVersionId: "version-1", compileJobId: "job-1" },
      expect.objectContaining({
        attempts: 3,
        removeOnComplete: 200,
        removeOnFail: 200
      })
    );
  });

  it("rejects email jobs without notification or direct email payload", async () => {
    const { service } = await loadService();

    await expect(service.enqueueEmail({} as never)).rejects.toThrow(
      "enqueueEmail requires notificationEventId or directEmail payload"
    );
  });

  it("enqueues email and backup jobs with their default options", async () => {
    const { service, queues } = await loadService();
    queues.get("email-notifications")!.add.mockResolvedValue({ id: "email-1" });
    queues.get("backups")!.add.mockResolvedValue({ id: "backup-1" });

    await expect(
      service.enqueueEmail({ directEmail: { to: "user@example.com", subject: "Atlasium", text: "Hi" } })
    ).resolves.toBe("email-1");
    await expect(service.enqueueBackup({ requestedBy: "admin-1" })).resolves.toBe("backup-1");

    expect(queues.get("email-notifications")!.add).toHaveBeenCalledWith(
      "send-email",
      expect.any(Object),
      expect.objectContaining({
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 500
      })
    );
    expect(queues.get("backups")!.add).toHaveBeenCalledWith(
      "run-backup",
      { requestedBy: "admin-1" },
      expect.objectContaining({
        attempts: 2,
        removeOnComplete: 50,
        removeOnFail: 50
      })
    );
  });

  it("enqueues meeting automation jobs with idempotent run ids", async () => {
    const { service, queues } = await loadService();
    queues.get("ai-meeting")!.add.mockResolvedValue({ id: "run-1" });

    await expect(service.enqueueMeetingAutomation({ runId: "run-1", meetingId: "meeting-1" })).resolves.toBe("run-1");

    expect(queues.get("ai-meeting")!.add).toHaveBeenCalledWith(
      "extract-tasks",
      { runId: "run-1", meetingId: "meeting-1" },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        jobId: "run-1",
        removeOnComplete: 200,
        removeOnFail: 200
      })
    );
  });

  it("closes all queues on module destroy", async () => {
    const { service, queues } = await loadService();

    await service.onModuleDestroy();

    expect(queues.get("latex-compile")!.close).toHaveBeenCalledTimes(1);
    expect(queues.get("email-notifications")!.close).toHaveBeenCalledTimes(1);
    expect(queues.get("backups")!.close).toHaveBeenCalledTimes(1);
    expect(queues.get("ai-meeting")!.close).toHaveBeenCalledTimes(1);
  });
});
