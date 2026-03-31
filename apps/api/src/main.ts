import "reflect-metadata";
import "./config/load-env";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { ProjectAccessService } from "./common/project-access.service";
import { SessionAuthService } from "./common/session-auth.service";
import { getEnv } from "./config/env";
import { DocumentsCollaborationServer } from "./documents/documents-collaboration.server";
import { setDocumentsCollaborationServer } from "./documents/collaboration-server-registry";
import { PrismaService } from "./prisma/prisma.service";

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: [
        env.APP_BASE_URL.replace(/\/+$/, ""),
        "http://localhost:3000",
        "http://127.0.0.1:3000"
      ],
      credentials: true
    }
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );

  const collabServer = new DocumentsCollaborationServer(
    app.get(PrismaService),
    app.get(SessionAuthService),
    app.get(ProjectAccessService)
  );
  setDocumentsCollaborationServer(collabServer);
  collabServer.start(app.getHttpServer());

  await app.listen(env.API_PORT);
}

bootstrap();
