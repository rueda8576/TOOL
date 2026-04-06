import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { TasksController } from "../../src/tasks/tasks.controller";
import { TasksService } from "../../src/tasks/tasks.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("TasksController HTTP", () => {
  let app: INestApplication;
  let tasksService: Record<string, jest.Mock>;

  beforeEach(async () => {
    tasksService = {
      listTasks: jest.fn(),
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
      addDependency: jest.fn(),
      addSubtask: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: tasksService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when no bearer token is provided", async () => {
    await request(app.getHttpServer()).post("/projects/project-1/tasks").send({ title: "Task" }).expect(401);
  });

  it("returns 400 for malformed task payloads", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/tasks")
      .set(authHeaders("editor"))
      .send({ title: "", status: "invalid" })
      .expect(400);
  });

  it("creates a task and passes the bound params, body, and current user to the service", async () => {
    tasksService.createTask.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      status: "todo",
      priority: "medium",
      parentTaskId: null
    });

    const response = await request(app.getHttpServer())
      .post("/projects/project-1/tasks")
      .set(authHeaders("editor", { userId: "editor-1", email: "editor@example.com" }))
      .send({ title: "Task", status: "todo", priority: "medium" })
      .expect(201);

    expect(tasksService.createTask).toHaveBeenCalledWith(
      "project-1",
      {
        title: "Task",
        status: "todo",
        priority: "medium"
      },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body).toEqual({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      status: "todo",
      priority: "medium",
      parentTaskId: null
    });
  });
});
