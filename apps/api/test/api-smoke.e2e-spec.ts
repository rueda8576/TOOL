import { ValidationPipe, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { GlobalRole, PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { GitlabService } from "../src/gitlab/gitlab.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { QueueService } from "../src/queues/queue.service";

describe("API integration", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const queueService = {
    enqueueEmail: jest.fn().mockResolvedValue("email-job-1"),
    enqueueCompile: jest.fn().mockResolvedValue("compile-job-1"),
    enqueueBackup: jest.fn().mockResolvedValue("backup-job-1"),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined)
  };

  const gitlabService = {
    provisionManagedRemoteRepository: jest.fn().mockResolvedValue({
      gitlabProjectId: "gitlab-project-1",
      pathWithNamespace: "atlasium/visnav",
      webUrl: "https://git.atlasium.info/atlasium/visnav",
      defaultBranch: "main"
    }),
    rollbackManagedRemoteProvision: jest.fn().mockResolvedValue(undefined),
    syncProjectRepositoryAccess: jest.fn().mockResolvedValue(undefined),
    archiveManagedRepository: jest.fn().mockResolvedValue(undefined),
    unarchiveManagedRepository: jest.fn().mockResolvedValue(undefined)
  };

  const truncateDatabase = async (client: PrismaClient): Promise<void> => {
    await client.$executeRawUnsafe(`
      TRUNCATE TABLE
        "AuditLog",
        "NotificationEvent",
        "NotificationPreference",
        "MeetingAction",
        "MeetingAttendee",
        "Meeting",
        "TaskDependency",
        "TaskLabel",
        "Task",
        "DocumentCompileJob",
        "DocumentVersion",
        "DocumentBranch",
        "Document",
        "ProjectRepository",
        "UserPinnedProject",
        "ProjectMember",
        "Project",
        "GitLabConnection",
        "InviteProject",
        "Invite",
        "Session",
        "OidcAuthorizationCode",
        "WikiLink",
        "WikiDraft",
        "WikiRevision",
        "WikiPage",
        "WikiAsset",
        "FileObject",
        "BackupRun",
        "User"
      RESTART IDENTITY CASCADE
    `);
  };

  const seedAdminUser = async (): Promise<{ id: string; email: string; password: string }> => {
    const password = "password-123";
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin User",
        passwordHash,
        globalRole: GlobalRole.ADMIN
      },
      select: {
        id: true,
        email: true
      }
    });

    await prisma.notificationPreference.create({
      data: {
        userId: user.id
      }
    });

    return {
      id: user.id,
      email: user.email,
      password
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(QueueService)
      .useValue(queueService)
      .overrideProvider(GitlabService)
      .useValue(gitlabService)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await truncateDatabase(prisma);
  });

  afterAll(async () => {
    await truncateDatabase(prisma);
    await app.close();
  });

  it("boots the real app, logs in, creates a project, mutates a task, and persists the result", async () => {
    const seededAdmin = await seedAdminUser();

    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: seededAdmin.email, password: seededAdmin.password })
      .expect(201);

    const token = loginResponse.body.token as string;
    expect(token).toEqual(expect.any(String));

    const createProjectResponse = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({
        key: "VISNAV",
        name: "Vision Navigation",
        description: "Integration coverage project"
      })
      .expect(201);

    const projectId = createProjectResponse.body.id as string;
    expect(gitlabService.provisionManagedRemoteRepository).toHaveBeenCalledWith("VISNAV", "Vision Navigation");
    expect(gitlabService.syncProjectRepositoryAccess).toHaveBeenCalledWith(projectId);

    const createTaskResponse = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Write integration spec",
        priority: "high"
      })
      .expect(201);

    const taskId = createTaskResponse.body.id as string;

    await request(app.getHttpServer())
      .patch(`/tasks/${taskId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "in_progress",
        title: "Write integration spec"
      })
      .expect(200);

    const listTasksResponse = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(listTasksResponse.body).toHaveLength(1);
    expect(listTasksResponse.body[0]).toEqual(
      expect.objectContaining({
        id: taskId,
        projectId,
        title: "Write integration spec",
        status: "in_progress",
        priority: "high"
      })
    );

    const persistedTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        status: true,
        title: true
      }
    });

    expect(persistedTask).toEqual({
      id: taskId,
      projectId,
      status: "IN_PROGRESS",
      title: "Write integration spec"
    });
  });
});
