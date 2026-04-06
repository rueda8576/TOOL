import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { NotificationsController } from "../../src/notifications/notifications.controller";
import { NotificationsService } from "../../src/notifications/notifications.service";
import { authHeaders, createHttpTestApp } from "./http-test.utils";

describe("NotificationsController HTTP", () => {
  let app: INestApplication;
  let notificationsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    notificationsService = {
      getPreferences: jest.fn(),
      updatePreferences: jest.fn()
    };

    app = await createHttpTestApp({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: notificationsService }]
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("returns 401 when preferences are requested without auth", async () => {
    await request(app.getHttpServer()).get("/users/me/notification-preferences").expect(401);
  });

  it("returns 400 for invalid notification preference payloads", async () => {
    await request(app.getHttpServer())
      .put("/users/me/notification-preferences")
      .set(authHeaders("reader"))
      .send({ taskDueLeadHours: 0 })
      .expect(400);
  });

  it("returns the current notification preferences", async () => {
    notificationsService.getPreferences.mockResolvedValue({
      emailEnabled: true,
      taskAssigned: true,
      taskDue: true,
      mentionInWiki: true,
      mentionInTaskComments: false,
      taskDueLeadHours: 24
    });

    const response = await request(app.getHttpServer())
      .get("/users/me/notification-preferences")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .expect(200);

    expect(notificationsService.getPreferences).toHaveBeenCalledWith({
      userId: "reader-1",
      email: "reader@example.com",
      globalRole: "reader"
    });
    expect(response.body.taskDueLeadHours).toBe(24);
  });

  it("binds update payloads and current user", async () => {
    notificationsService.updatePreferences.mockResolvedValue({
      emailEnabled: false,
      taskAssigned: true,
      taskDue: false,
      mentionInWiki: false,
      mentionInTaskComments: true,
      taskDueLeadHours: 6
    });

    const response = await request(app.getHttpServer())
      .put("/users/me/notification-preferences")
      .set(authHeaders("reader", { userId: "reader-1" }))
      .send({ emailEnabled: false, taskDue: false, mentionInWiki: false, taskDueLeadHours: 6 })
      .expect(200);

    expect(notificationsService.updatePreferences).toHaveBeenCalledWith(
      {
        userId: "reader-1",
        email: "reader@example.com",
        globalRole: "reader"
      },
      {
        emailEnabled: false,
        taskDue: false,
        mentionInWiki: false,
        taskDueLeadHours: 6
      }
    );
    expect(response.body.emailEnabled).toBe(false);
  });
});
