import "reflect-metadata";
import "./config/load-env";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";

import { AppModule } from "./app.module";
import { ProjectAccessService } from "./common/project-access.service";
import { getEnv } from "./config/env";
import { DocumentsCollaborationServer } from "./documents/documents-collaboration.server";
import { setDocumentsCollaborationServer } from "./documents/collaboration-server-registry";
import { PrismaService } from "./prisma/prisma.service";

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create(AppModule, { cors: true });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );

  const collabServer = new DocumentsCollaborationServer(
    app.get(PrismaService),
    app.get(JwtService),
    app.get(ProjectAccessService)
  );
  setDocumentsCollaborationServer(collabServer);
  collabServer.start(app.getHttpServer());

  await app.listen(env.API_PORT);
}

bootstrap();
