import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { BackupStatus, CompileStatus, ProjectRole, TaskPriority, TaskStatus } from "@prisma/client";

import { ProjectsService } from "./projects.service";

describe("ProjectsService", () => {
  const makeService = (): {
    service: ProjectsService;
    prisma: any;
    accessService: any;
    auditService: any;
    gitlabService: any;
    queueService: any;
  } => {
    const prisma: any = {
      project: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      },
      document: {
        findMany: jest.fn()
      },
      wikiPage: {
        findMany: jest.fn()
      },
      task: {
        findMany: jest.fn()
      },
      meeting: {
        findMany: jest.fn()
      },
      meetingAction: {
        count: jest.fn()
      },
      auditLog: {
        findMany: jest.fn()
      },
      backupRun: {
        findMany: jest.fn(),
        count: jest.fn()
      },
      projectMember: {
        findMany: jest.fn(),
        upsert: jest.fn()
      },
      projectRepository: {
        create: jest.fn()
      },
      user: {
        findUnique: jest.fn()
      },
      userPinnedProject: {
        upsert: jest.fn(),
        deleteMany: jest.fn()
      },
      $transaction: jest.fn()
    };

    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));

    const accessService: any = {
      getProjectAccess: jest.fn(),
      ensureProjectReadable: jest.fn(),
      ensureProjectWritable: jest.fn()
    };

    const auditService: any = {
      log: jest.fn()
    };

    const gitlabService: any = {
      provisionManagedRemoteRepository: jest.fn(),
      rollbackManagedRemoteProvision: jest.fn(),
      syncProjectRepositoryAccess: jest.fn(),
      archiveManagedRepository: jest.fn(),
      unarchiveManagedRepository: jest.fn()
    };

    const queueService: any = {
      enqueueBackup: jest.fn()
    };

    return {
      service: new ProjectsService(prisma, accessService, auditService, gitlabService, queueService),
      prisma,
      accessService,
      auditService,
      gitlabService,
      queueService
    };
  };

  it("lists projects with createdAt/isPinned mapping for editor membership", async () => {
    const { service, prisma } = makeService();
    const createdAt = new Date("2026-03-03T10:00:00.000Z");

    prisma.project.findMany.mockResolvedValue([
      {
        id: "p1",
        key: "PHD1",
        name: "Main project",
        description: "desc",
        createdAt,
        pinnedByUsers: [{ id: "pin1" }]
      }
    ]);

    const result = await service.listProjects({
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          members: {
            some: {
              userId: "u1"
            }
          }
        },
        orderBy: { createdAt: "desc" }
      })
    );

    expect(result).toEqual([
      {
        id: "p1",
        key: "PHD1",
        name: "Main project",
        description: "desc",
        createdAt: "2026-03-03T10:00:00.000Z",
        isPinned: true
      }
    ]);
  });

  it("lists admin projects without membership filter", async () => {
    const { service, prisma } = makeService();
    prisma.project.findMany.mockResolvedValue([]);

    await service.listProjects({
      userId: "admin-1",
      email: "admin@example.com",
      globalRole: "admin"
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null }
      })
    );
  });

  it("lists the admin operations ledger with backup integrity metadata", async () => {
    const { service, prisma } = makeService();
    const startedAt = new Date("2026-06-19T08:00:00.000Z");
    const completedAt = new Date("2026-06-19T08:02:00.000Z");
    const retentionUntil = new Date("2026-07-19T08:02:00.000Z");

    prisma.backupRun.findMany.mockResolvedValue([
      {
        id: "backup-1",
        status: BackupStatus.SUCCEEDED,
        startedAt,
        completedAt,
        retentionUntil,
        details: {
          durationMs: 120_000,
          dbDump: {
            bytes: 2048,
            sha256: "db-sha"
          },
          storageArchive: {
            bytes: 4096,
            sha256: "storage-sha"
          },
          versions: {
            pgDump: "pg_dump 16.9",
            tar: "tar 1.34"
          }
        }
      },
      {
        id: "backup-2",
        status: BackupStatus.FAILED,
        startedAt: new Date("2026-06-18T08:00:00.000Z"),
        completedAt: new Date("2026-06-18T08:00:10.000Z"),
        retentionUntil: null,
        details: {
          error: "pg_dump failed"
        }
      }
    ]);
    prisma.backupRun.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(1);

    const result = await service.listOperations({
      userId: "admin-1",
      email: "admin@example.com",
      globalRole: "admin"
    });

    expect(prisma.backupRun.findMany).toHaveBeenCalledWith({
      orderBy: { startedAt: "desc" },
      take: 25,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        retentionUntil: true,
        details: true
      }
    });
    expect(result.backups.summary).toEqual({
      total: 8,
      running: 1,
      succeeded: 6,
      failed: 1
    });
    expect(result.backups.runs[0]).toEqual({
      id: "backup-1",
      status: "succeeded",
      startedAt: "2026-06-19T08:00:00.000Z",
      completedAt: "2026-06-19T08:02:00.000Z",
      retentionUntil: "2026-07-19T08:02:00.000Z",
      durationMs: 120000,
      dbDumpBytes: 2048,
      storageArchiveBytes: 4096,
      dbDumpSha256: "db-sha",
      storageArchiveSha256: "storage-sha",
      toolVersions: {
        pgDump: "pg_dump 16.9",
        tar: "tar 1.34"
      },
      error: null
    });
    expect(result.backups.runs[1]).toEqual(expect.objectContaining({
      id: "backup-2",
      status: "failed",
      error: "pg_dump failed"
    }));
  });

  it("rejects operations ledger access for non-admin users", async () => {
    const { service, prisma } = makeService();

    await expect(
      service.listOperations({
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.backupRun.findMany).not.toHaveBeenCalled();
  });

  it("enqueues a manual backup for admins and writes audit", async () => {
    const { service, queueService, auditService } = makeService();
    queueService.enqueueBackup.mockResolvedValue("backup-job-1");

    const result = await service.enqueueBackup({
      userId: "admin-1",
      email: "admin@example.com",
      globalRole: "admin"
    });

    expect(queueService.enqueueBackup).toHaveBeenCalledWith({ requestedBy: "admin-1" });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "admin-1",
      entityType: "backup_run",
      entityId: "backup-job-1",
      action: "backup.enqueue"
    });
    expect(result).toEqual({
      jobId: "backup-job-1",
      queuedAt: expect.any(String)
    });
  });

  it("rejects manual backup enqueue for non-admin users", async () => {
    const { service, queueService } = makeService();

    await expect(
      service.enqueueBackup({
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(queueService.enqueueBackup).not.toHaveBeenCalled();
  });

  it("allows admins to create projects and logs audit", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();

    prisma.project.findUnique.mockResolvedValue(null);
    gitlabService.provisionManagedRemoteRepository.mockResolvedValue({
      gitlabProjectId: "gl-1",
      pathWithNamespace: "atlasium/PHD1",
      webUrl: "https://git.atlasium.info/atlasium/PHD1",
      defaultBranch: "main"
    });
    prisma.project.create.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "desc"
    });

    const result = await service.createProject(
      {
        key: "phd1",
        name: "Main project",
        description: "desc"
      },
      {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      }
    );

    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: "PHD1",
          createdById: "admin-1",
          members: {
            create: {
              userId: "admin-1",
              role: ProjectRole.EDITOR
            }
          }
        })
      })
    );
    expect(prisma.projectRepository.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "p1",
        gitlabProjectId: "gl-1",
        name: "Main project",
        description: "desc",
        visibility: "private",
        lastActivityAt: expect.any(Date),
        connectedByUserId: "admin-1"
      })
    });
    const repositoryCreateData = prisma.projectRepository.create.mock.calls[0][0].data;
    expect(Number.isNaN(repositoryCreateData.lastActivityAt.getTime())).toBe(false);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.create",
        entityType: "project"
      })
    );
    expect(result).toEqual({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "desc"
    });
  });

  it.each(["editor", "reader"] as const)("rejects project creation for %s role", async (role) => {
    const { service } = makeService();

    await expect(
      service.createProject(
        {
          key: "PHD1",
          name: "Main project"
        },
        {
          userId: "user-1",
          email: "user@example.com",
          globalRole: role
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects duplicate project keys before provisioning a managed repository", async () => {
    const { service, prisma, gitlabService } = makeService();
    prisma.project.findUnique.mockResolvedValue({ id: "existing-project" });

    await expect(
      service.createProject(
        {
          key: "phd1",
          name: "Duplicate"
        },
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(gitlabService.provisionManagedRemoteRepository).not.toHaveBeenCalled();
  });

  it.each(["admin", "editor"] as const)("updates project metadata for writable %s users", async (role) => {
    const { service, prisma, accessService, auditService } = makeService();
    const currentUpdatedAt = new Date("2026-03-03T10:00:00.000Z");
    const updatedAt = new Date("2026-03-03T11:00:00.000Z");

    prisma.project.findFirst.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "Old description",
      updatedAt: currentUpdatedAt
    });
    prisma.project.update.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Updated project",
      description: "New description",
      updatedAt
    });

    const result = await service.updateProject(
      "p1",
      {
        name: "  Updated project  ",
        description: "  New description  "
      },
      {
        userId: "user-1",
        email: "user@example.com",
        globalRole: role
      }
    );

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("user-1", role, "p1");
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: {
        id: "p1"
      },
      data: {
        name: "Updated project",
        description: "New description"
      },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        updatedAt: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "p1",
      entityType: "project",
      entityId: "p1",
      action: "project.update",
      metadata: {
        changedFields: ["name", "description"]
      }
    });
    expect(result).toEqual({
      id: "p1",
      key: "PHD1",
      name: "Updated project",
      description: "New description",
      updatedAt: "2026-03-03T11:00:00.000Z"
    });
  });

  it("rejects project metadata updates when the user cannot write", async () => {
    const { service, prisma, accessService } = makeService();
    accessService.ensureProjectWritable.mockRejectedValue(new ForbiddenException("Reader role cannot modify project resources"));

    await expect(
      service.updateProject(
        "p1",
        {
          name: "Updated project"
        },
        {
          userId: "reader-1",
          email: "reader@example.com",
          globalRole: "reader"
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("clears project description when update payload sends an empty description", async () => {
    const { service, prisma, auditService } = makeService();

    prisma.project.findFirst.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "Old description",
      updatedAt: new Date("2026-03-03T10:00:00.000Z")
    });
    prisma.project.update.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: null,
      updatedAt: new Date("2026-03-03T11:00:00.000Z")
    });

    const result = await service.updateProject(
      "p1",
      {
        description: "   "
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(prisma.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        description: null
      }
    }));
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "project.update",
      metadata: {
        changedFields: ["description"]
      }
    }));
    expect(result.description).toBeNull();
  });

  it("returns current project metadata without audit when update payload is unchanged", async () => {
    const { service, prisma, auditService } = makeService();
    const updatedAt = new Date("2026-03-03T10:00:00.000Z");

    prisma.project.findFirst.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "Same description",
      updatedAt
    });

    const result = await service.updateProject(
      "p1",
      {
        name: " Main project ",
        description: " Same description "
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );

    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "Same description",
      updatedAt: "2026-03-03T10:00:00.000Z"
    });
  });

  it("rejects empty project metadata update payloads", async () => {
    const { service, prisma } = makeService();

    await expect(
      service.updateProject(
        "p1",
        {},
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("rolls back the provisioned repository when project creation transaction fails", async () => {
    const { service, prisma, gitlabService } = makeService();

    prisma.project.findUnique.mockResolvedValue(null);
    gitlabService.provisionManagedRemoteRepository.mockResolvedValue({
      gitlabProjectId: "gl-rollback",
      pathWithNamespace: "atlasium/PHD2",
      webUrl: "https://git.atlasium.info/atlasium/PHD2",
      defaultBranch: "main"
    });
    prisma.$transaction.mockRejectedValue(new Error("db write failed"));

    await expect(
      service.createProject(
        {
          key: "PHD2",
          name: "Rollback project"
        },
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toThrow("db write failed");

    expect(gitlabService.rollbackManagedRemoteProvision).toHaveBeenCalledWith("gl-rollback");
    expect(gitlabService.syncProjectRepositoryAccess).not.toHaveBeenCalled();
  });

  it("deletes the created project and rolls back GitLab when repository access sync fails", async () => {
    const { service, prisma, gitlabService } = makeService();

    prisma.project.findUnique.mockResolvedValue(null);
    gitlabService.provisionManagedRemoteRepository.mockResolvedValue({
      gitlabProjectId: "gl-sync",
      pathWithNamespace: "atlasium/PHD3",
      webUrl: "https://git.atlasium.info/atlasium/PHD3",
      defaultBranch: "main"
    });
    prisma.project.create.mockResolvedValue({
      id: "p-sync",
      key: "PHD3",
      name: "Sync project",
      description: null
    });
    gitlabService.syncProjectRepositoryAccess.mockRejectedValue(new Error("sync failed"));

    await expect(
      service.createProject(
        {
          key: "PHD3",
          name: "Sync project"
        },
        {
          userId: "admin-1",
          email: "admin@example.com",
          globalRole: "admin"
        }
      )
    ).rejects.toThrow("sync failed");

    expect(prisma.project.delete).toHaveBeenCalledWith({
      where: {
        id: "p-sync"
      }
    });
    expect(gitlabService.rollbackManagedRemoteProvision).toHaveBeenCalledWith("gl-sync");
  });

  it("pins project idempotently and logs audit", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    const createdAt = new Date("2026-03-03T11:00:00.000Z");

    prisma.userPinnedProject.upsert.mockResolvedValue({
      projectId: "p1",
      createdAt
    });

    const result = await service.pinProject("p1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "reader"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("u1", "reader", "p1");
    expect(prisma.userPinnedProject.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_projectId: {
            userId: "u1",
            projectId: "p1"
          }
        }
      })
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.pin",
        entityType: "project_pin"
      })
    );
    expect(result).toEqual({
      projectId: "p1",
      pinned: true,
      pinnedAt: "2026-03-03T11:00:00.000Z"
    });
  });

  it("returns project access context from the shared access service", async () => {
    const { service, accessService } = makeService();
    accessService.getProjectAccess.mockResolvedValue({
      isAdmin: false,
      projectRole: "editor",
      canWrite: true
    });

    await expect(
      service.getProjectAccess("p1", {
        userId: "u1",
        email: "u1@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual({
      isAdmin: false,
      projectRole: "editor",
      canWrite: true
    });

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("u1", "reader", "p1");
  });

  it("builds project overview from local data with deterministic attention and activity", async () => {
    const { service, prisma, accessService } = makeService();
    accessService.getProjectAccess.mockResolvedValue({
      isAdmin: false,
      projectRole: "editor",
      canWrite: true
    });
    prisma.project.findFirst.mockResolvedValue({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "Traceable doctoral archive",
      createdAt: new Date("2026-05-01T09:00:00.000Z"),
      updatedAt: new Date("2026-05-20T09:00:00.000Z"),
      repositories: []
    });
    prisma.document.findMany.mockResolvedValue([
      {
        id: "doc-failed",
        title: "Thesis draft",
        type: "PAPER",
        updatedAt: new Date("2026-05-20T10:00:00.000Z"),
        versions: [{ compileStatus: CompileStatus.FAILED, createdAt: new Date("2026-05-20T09:00:00.000Z") }]
      },
      {
        id: "doc-ok",
        title: "Model notes",
        type: "MODEL",
        updatedAt: new Date("2026-05-18T10:00:00.000Z"),
        versions: [{ compileStatus: CompileStatus.SUCCEEDED, createdAt: new Date("2026-05-18T09:00:00.000Z") }]
      }
    ]);
    prisma.wikiPage.findMany.mockResolvedValue([
      {
        id: "wiki-draft",
        title: "Method notes",
        path: "method/notes",
        currentRevisionId: "rev-1",
        updatedAt: new Date("2026-05-19T10:00:00.000Z"),
        draft: { updatedAt: new Date("2026-05-21T10:00:00.000Z") }
      },
      {
        id: "wiki-published",
        title: "Published page",
        path: "published",
        currentRevisionId: "rev-2",
        updatedAt: new Date("2026-05-17T10:00:00.000Z"),
        draft: null
      }
    ]);
    prisma.task.findMany.mockResolvedValue([
      {
        id: "task-overdue",
        title: "Finish chapter",
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.CRITICAL,
        dueDate: new Date("2026-05-10T12:00:00.000Z"),
        updatedAt: new Date("2026-05-11T10:00:00.000Z"),
        assignee: { name: "Luis" }
      },
      {
        id: "task-blocked",
        title: "Review data",
        status: TaskStatus.BLOCKED,
        priority: TaskPriority.HIGH,
        dueDate: null,
        updatedAt: new Date("2026-05-12T10:00:00.000Z"),
        assignee: null
      },
      {
        id: "task-done",
        title: "Done work",
        status: TaskStatus.DONE,
        priority: TaskPriority.LOW,
        dueDate: new Date("2026-05-09T12:00:00.000Z"),
        updatedAt: new Date("2026-05-09T10:00:00.000Z"),
        assignee: null
      }
    ]);
    prisma.meeting.findMany
      .mockResolvedValueOnce([{ id: "meeting-month" }])
      .mockResolvedValueOnce([
        {
          id: "meeting-next",
          title: "Lab sync",
          scheduledAt: new Date("2026-05-26T12:00:00.000Z"),
          location: "Room 1",
          actions: [{ id: "action-1" }]
        }
      ]);
    prisma.meetingAction.count.mockResolvedValue(3);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-known",
        entityType: "document",
        entityId: "doc-failed",
        action: "document.version.create",
        createdAt: new Date("2026-05-21T08:00:00.000Z")
      },
      {
        id: "audit-unknown",
        entityType: "custom_entity",
        entityId: "custom-1",
        action: "custom.event",
        createdAt: new Date("2026-05-20T08:00:00.000Z")
      }
    ]);

    const overview = await service.getProjectOverview("p1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });

    expect(accessService.getProjectAccess).toHaveBeenCalledWith("editor-1", "editor", "p1");
    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", deletedAt: null } }));
    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", deletedAt: null } }));
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", deletedAt: null } }));
    expect(prisma.meeting.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ projectId: "p1", deletedAt: null })
      })
    );
    expect(prisma.meetingAction.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        meeting: {
          projectId: "p1",
          deletedAt: null
        }
      })
    });

    expect(overview.project).toEqual({
      id: "p1",
      key: "PHD1",
      name: "Main project",
      description: "Traceable doctoral archive",
      createdAt: "2026-05-01T09:00:00.000Z",
      updatedAt: "2026-05-20T09:00:00.000Z"
    });
    expect(overview.modules.documents).toMatchObject({
      total: 2,
      failedCompiles: 1,
      runningCompiles: 0
    });
    expect(overview.modules.wiki).toMatchObject({
      publishedPages: 2,
      draftPages: 1
    });
    expect(overview.modules.code).toEqual({
      connected: false,
      repositoryCount: 0,
      latestRepository: null,
      lastActivityAt: null
    });
    expect(overview.modules.tasks).toMatchObject({
      open: 2,
      inProgress: 1,
      blocked: 1,
      overdue: 1,
      critical: 1
    });
    expect(overview.modules.meetings).toMatchObject({
      thisMonth: 1,
      upcoming: 1,
      openActions: 3
    });
    expect(overview.attention.map((item) => item.id)).toEqual([
      "task-overdue-task-overdue",
      "document-compile-doc-failed",
      "repository-missing",
      "task-blocked-task-blocked",
      "wiki-drafts",
      "meeting-upcoming-meeting-next"
    ]);
    expect(overview.activity).toEqual([
      expect.objectContaining({
        id: "audit-known",
        module: "documents",
        title: "Document version added",
        href: "/projects/p1/documents"
      }),
      expect.objectContaining({
        id: "audit-unknown",
        module: "project",
        title: "Custom Event",
        href: "/projects/p1"
      })
    ]);
  });

  it("keeps reader overview readable without exposing draft-only wiki attention", async () => {
    const { service, prisma, accessService } = makeService();
    accessService.getProjectAccess.mockResolvedValue({
      isAdmin: false,
      projectRole: "reader",
      canWrite: false
    });
    prisma.project.findFirst.mockResolvedValue({
      id: "p-reader",
      key: "READ",
      name: "Reader project",
      description: null,
      createdAt: new Date("2026-05-01T09:00:00.000Z"),
      updatedAt: new Date("2026-05-20T09:00:00.000Z"),
      repositories: [{
        id: "repo-read",
        name: "Reader repository",
        pathWithNamespace: "atlasium/read",
        defaultBranch: "main",
        lastActivityAt: new Date("2026-05-20T08:00:00.000Z")
      }]
    });
    prisma.document.findMany.mockResolvedValue([]);
    prisma.wikiPage.findMany.mockResolvedValue([]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.meeting.findMany.mockResolvedValue([]);
    prisma.meetingAction.count.mockResolvedValue(0);
    prisma.auditLog.findMany.mockResolvedValue([]);

    const overview = await service.getProjectOverview("p-reader", {
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });

    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "p-reader",
          deletedAt: null,
          currentRevisionId: { not: null }
        }
      })
    );
    expect(overview.access).toEqual({
      isAdmin: false,
      projectRole: "reader",
      canWrite: false
    });
    expect(overview.modules.wiki.draftPages).toBe(0);
    expect(overview.modules.code).toEqual({
      connected: true,
      repositoryCount: 1,
      latestRepository: {
        id: "repo-read",
        name: "Reader repository",
        pathWithNamespace: "atlasium/read",
        defaultBranch: "main",
        lastActivityAt: "2026-05-20T08:00:00.000Z"
      },
      lastActivityAt: "2026-05-20T08:00:00.000Z"
    });
    expect(overview.attention.some((item) => item.module === "wiki")).toBe(false);
  });

  it("unpinned project is idempotent and logs audit", async () => {
    const { service, prisma, accessService, auditService } = makeService();
    prisma.userPinnedProject.deleteMany.mockResolvedValue({ count: 0 });

    const result = await service.unpinProject("p1", {
      userId: "u1",
      email: "u1@example.com",
      globalRole: "editor"
    });

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("u1", "editor", "p1");
    expect(prisma.userPinnedProject.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        projectId: "p1"
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.unpin",
        entityType: "project_pin"
      })
    );
    expect(result).toEqual({
      projectId: "p1",
      pinned: false
    });
  });

  it("soft deletes project for admin and logs audit", async () => {
    const { service, prisma, auditService, gitlabService } = makeService();
    const deletedAt = new Date("2026-03-29T09:15:00.000Z");

    prisma.project.findFirst.mockResolvedValue({ id: "p1" });
    prisma.project.update.mockResolvedValue({
      id: "p1",
      deletedAt
    });

    const result = await service.deleteProject("p1", {
      userId: "admin-1",
      email: "admin@example.com",
      globalRole: "admin"
    });

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: "p1",
        deletedAt: null
      },
      select: {
        id: true
      }
    });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: {
        id: "p1"
      },
      data: {
        deletedAt: expect.any(Date)
      },
      select: {
        id: true,
        deletedAt: true
      }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.delete",
        entityType: "project",
        entityId: "p1"
      })
    );
    expect(result).toEqual({
      id: "p1",
        deletedAt: "2026-03-29T09:15:00.000Z"
    });
    expect(gitlabService.archiveManagedRepository).toHaveBeenCalledWith("p1");
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("p1");
  });

  it.each(["editor", "reader"] as const)("rejects project deletion for %s role", async (role) => {
    const { service } = makeService();

    await expect(
      service.deleteProject("p1", {
        userId: "user-1",
        email: "user@example.com",
        globalRole: role
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns not found when deleting an already deleted or missing project", async () => {
    const { service, prisma } = makeService();

    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteProject("missing-project", {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("restores the project when GitLab archive synchronization fails during deletion", async () => {
    const { service, prisma, gitlabService } = makeService();
    const deletedAt = new Date("2026-03-29T09:15:00.000Z");

    prisma.project.findFirst.mockResolvedValue({ id: "p-restore" });
    prisma.project.update
      .mockResolvedValueOnce({
        id: "p-restore",
        deletedAt
      })
      .mockResolvedValueOnce({
        id: "p-restore",
        deletedAt: null
      });
    gitlabService.archiveManagedRepository.mockRejectedValue(new Error("archive failed"));

    await expect(
      service.deleteProject("p-restore", {
        userId: "admin-1",
        email: "admin@example.com",
        globalRole: "admin"
      })
    ).rejects.toThrow("archive failed");

    expect(prisma.project.update).toHaveBeenNthCalledWith(2, {
      where: {
        id: "p-restore"
      },
      data: {
        deletedAt: null
      }
    });
    expect(gitlabService.unarchiveManagedRepository).toHaveBeenCalledWith("p-restore");
  });

  it("lists project members with user identity mapping", async () => {
    const { service, prisma, accessService } = makeService();
    prisma.projectMember.findMany.mockResolvedValue([
      {
        userId: "user-1",
        user: {
          name: "Luis",
          email: "luis@example.com"
        }
      }
    ]);

    await expect(
      service.listMembers("project-1", {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      })
    ).resolves.toEqual([
      {
        userId: "user-1",
        name: "Luis",
        email: "luis@example.com"
      }
    ]);

    expect(accessService.ensureProjectReadable).toHaveBeenCalledWith("reader-1", "reader", "project-1");
  });

  it("adds a member by normalized email, logs audit, and syncs repository access", async () => {
    const { service, prisma, accessService, auditService, gitlabService } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: "member-1" });
    prisma.projectMember.upsert.mockResolvedValue({
      projectId: "project-1",
      userId: "member-1"
    });

    await expect(
      service.addMember(
        "project-1",
        {
          email: "Member@Example.com"
        },
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).resolves.toEqual({
      projectId: "project-1",
      userId: "member-1"
    });

    expect(accessService.ensureProjectWritable).toHaveBeenCalledWith("editor-1", "editor", "project-1");
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "member@example.com" },
      select: { id: true }
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.member.add",
        entityType: "project_member"
      })
    );
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith("project-1");
  });

  it("rejects member addition when the target user does not exist", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.addMember(
        "project-1",
        {
          userId: "missing-user"
        },
        {
          userId: "editor-1",
          email: "editor@example.com",
          globalRole: "editor"
        }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
