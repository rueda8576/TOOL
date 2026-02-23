import { Module } from "@nestjs/common";

import { AppController } from "./app.controller";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { DocumentsModule } from "./documents/documents.module";
import { MeetingsModule } from "./meetings/meetings.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProjectsModule } from "./projects/projects.module";
import { QueuesModule } from "./queues/queues.module";
import { StorageModule } from "./storage/storage.module";
import { TasksModule } from "./tasks/tasks.module";
import { WikiModule } from "./wiki/wiki.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    QueuesModule,
    StorageModule,
    CommonModule,
    AuthModule,
    ProjectsModule,
    WikiModule,
    DocumentsModule,
    TasksModule,
    MeetingsModule,
    NotificationsModule
  ],
  controllers: [AppController, HealthController]
})
export class AppModule {}
