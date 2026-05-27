import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { MeetingsController } from "../../src/meetings/meetings.controller";
import { MeetingsService } from "../../src/meetings/meetings.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("MeetingsController HTTP", () => {
  let app: INestApplication;
  let meetingsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    meetingsService = {
      listMeetings: jest.fn(),
      createMeeting: jest.fn(),
      updateMeeting: jest.fn(),
      deleteMeeting: jest.fn(),
      retryAutomation: jest.fn(),
      createAction: jest.fn(),
      linkActionToTask: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [MeetingsController],
      providers: [{ provide: MeetingsService, useValue: meetingsService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when listing meetings without auth", async () => {
    await request(app.getHttpServer()).get("/projects/project-1/meetings").expect(401);
  });

  it("returns 400 for malformed meeting creation payloads", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/meetings")
      .set(authHeaders("editor"))
      .send({ title: "A", scheduledAt: "not-a-date" })
      .expect(400);
  });

  it("binds create-action params and body", async () => {
    meetingsService.createAction.mockResolvedValue({
      id: "action-1",
      meetingId: "meeting-1",
      title: "Follow up",
      linkedTaskId: null
    });

    const response = await request(app.getHttpServer())
      .post("/meetings/meeting-1/actions")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ title: "Follow up", linkedTaskId: "task-1" })
      .expect(201);

    expect(meetingsService.createAction).toHaveBeenCalledWith(
      "meeting-1",
      { title: "Follow up", linkedTaskId: "task-1" },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body).toEqual({
      id: "action-1",
      meetingId: "meeting-1",
      title: "Follow up",
      linkedTaskId: null
    });
  });

  it("binds automation retry params and current user", async () => {
    meetingsService.retryAutomation.mockResolvedValue({
      id: "meeting-1",
      projectId: "project-1",
      title: "Minutes",
      scheduledAt: "2026-02-22T12:00:00.000Z",
      scheduledDate: "2026-02-22",
      location: null,
      doneMarkdown: null,
      toDiscussMarkdown: null,
      toDoMarkdown: "- Follow up",
      automation: {
        id: "run-1",
        status: "queued",
        createdTaskCount: 0,
        createdActionCount: 0,
        errorMessage: null,
        completedAt: null,
        updatedAt: "2026-02-22T12:00:00.000Z"
      },
      createdAt: "2026-02-22T12:00:00.000Z",
      updatedAt: "2026-02-22T12:00:00.000Z"
    });

    const response = await request(app.getHttpServer())
      .post("/meetings/meeting-1/automation/retry")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send()
      .expect(201);

    expect(meetingsService.retryAutomation).toHaveBeenCalledWith("meeting-1", {
      userId: "editor-1",
      email: "editor@example.com",
      globalRole: "editor"
    });
    expect(response.body.automation).toEqual(expect.objectContaining({ id: "run-1", status: "queued" }));
  });

  it("binds action-task linking params and DTO", async () => {
    meetingsService.linkActionToTask.mockResolvedValue({ actionId: "action-1", linkedTaskId: "task-1" });

    const response = await request(app.getHttpServer())
      .post("/meetings/meeting-1/actions/action-1/link-task")
      .set(authHeaders("editor", { userId: "editor-1" }))
      .send({ taskId: "task-1" })
      .expect(201);

    expect(meetingsService.linkActionToTask).toHaveBeenCalledWith(
      "meeting-1",
      "action-1",
      { taskId: "task-1" },
      {
        userId: "editor-1",
        email: "editor@example.com",
        globalRole: "editor"
      }
    );
    expect(response.body).toEqual({ actionId: "action-1", linkedTaskId: "task-1" });
  });
});
