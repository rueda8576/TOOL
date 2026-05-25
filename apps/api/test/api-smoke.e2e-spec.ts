import { ValidationPipe, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { GlobalRole, PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { rm } from "fs/promises";
import { join } from "path";
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
    provisionManagedRemoteRepository: jest.fn().mockImplementation((projectKey: string, repositoryName: string) => {
      const path = projectKey.toLowerCase();
      return Promise.resolve({
        gitlabProjectId: "gitlab-project-1",
        name: repositoryName,
        description: null,
        pathWithNamespace: `atlasium/${path}`,
        webUrl: `https://git.atlasium.info/atlasium/${path}`,
        defaultBranch: "main",
        visibility: "private",
        lastActivityAt: "2026-05-25T12:00:00.000Z"
      });
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

  const truncateStorage = async (): Promise<void> => {
    await rm(join(process.cwd(), "storage"), { recursive: true, force: true });
  };

  const seedAdminUser = async (): Promise<{ id: string; email: string; password: string }> => {
    const password = "password-123";
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: "admin@example.com",
        username: "admin",
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

  const loginAs = async (email: string, password: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(201);

    return response.body.token as string;
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
    await truncateStorage();
  });

  afterAll(async () => {
    await truncateDatabase(prisma);
    await truncateStorage();
    await app.close();
  });

  it("boots the real app, logs in, creates a project, mutates a task, and persists the result", async () => {
    const seededAdmin = await seedAdminUser();

    const token = await loginAs(seededAdmin.email, seededAdmin.password);
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

  it("invites a user, accepts the invite, and allows that user to log in", async () => {
    const seededAdmin = await seedAdminUser();
    const adminToken = await loginAs(seededAdmin.email, seededAdmin.password);

    const inviteResponse = await request(app.getHttpServer())
      .post("/auth/invite")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "invitee@example.com",
        globalRole: "reader",
        accessMode: "all",
        defaultProjectRole: "reader"
      })
      .expect(201);

    expect(queueService.enqueueEmail).toHaveBeenCalledTimes(1);

    const acceptResponse = await request(app.getHttpServer())
      .post("/auth/accept-invite")
      .send({
        token: inviteResponse.body.token,
        name: "Invited Reader",
        password: "password-456"
      })
      .expect(201);

    expect(acceptResponse.body.userId).toEqual(expect.any(String));
    expect(acceptResponse.body.projectIds).toEqual([]);

    const invitedToken = await loginAs("invitee@example.com", "password-456");
    expect(invitedToken).toEqual(expect.any(String));

    const invitedUser = await prisma.user.findUnique({
      where: { email: "invitee@example.com" },
      select: {
        id: true,
        globalRole: true,
        isActive: true
      }
    });

    expect(invitedUser).toEqual({
      id: acceptResponse.body.userId,
      globalRole: GlobalRole.READER,
      isActive: true
    });
  });

  it("creates a document flow with branch/version creation and compile enqueue", async () => {
    const seededAdmin = await seedAdminUser();
    const token = await loginAs(seededAdmin.email, seededAdmin.password);

    const createProjectResponse = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({
        key: "DOCOPS",
        name: "Document Ops"
      })
      .expect(201);

    const projectId = createProjectResponse.body.id as string;

    const createDocumentResponse = await request(app.getHttpServer())
      .post(`/projects/${projectId}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Integration Paper",
        type: "paper",
        authors: ["Invited Reader"]
      })
      .expect(201);

    const documentId = createDocumentResponse.body.id as string;

    const createBranchResponse = await request(app.getHttpServer())
      .post(`/documents/${documentId}/branches`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "draft"
      })
      .expect(201);

    const createVersionResponse = await request(app.getHttpServer())
      .post(`/documents/${documentId}/versions`)
      .set("Authorization", `Bearer ${token}`)
      .field("branchName", "draft")
      .field("notes", "Initial draft")
      .field("latexEntryFile", "main.tex")
      .expect(201);

    const documentVersionId = createVersionResponse.body.id as string;

    const compileResponse = await request(app.getHttpServer())
      .post(`/document-versions/${documentVersionId}/compile`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(queueService.enqueueCompile).toHaveBeenCalledWith({
      documentVersionId,
      compileJobId: compileResponse.body.compileJobId
    });

    const persistedVersion = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: {
        branch: {
          select: {
            name: true
          }
        },
        latexWorkspacePath: true,
        compileStatus: true
      }
    });

    expect(createBranchResponse.body.name).toBe("draft");
    expect(persistedVersion).toEqual({
      branch: {
        name: "draft"
      },
      latexWorkspacePath: expect.stringContaining(`latex-workspaces/${documentVersionId}`),
      compileStatus: "PENDING"
    });
  });
});
