import { INestApplication, Provider, ValidationPipe } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";

import { JwtAuthGuard } from "../../src/common/jwt-auth.guard";
import { RolesGuard } from "../../src/common/roles.guard";
import { SessionAuthService } from "../../src/common/session-auth.service";

export const authHeaders = (
  role: "admin" | "editor" | "reader" = "editor",
  overrides?: { userId?: string; email?: string }
): Record<string, string> => ({
  authorization: `Bearer ${role}:${overrides?.userId ?? `${role}-1`}:${overrides?.email ?? `${role}@example.com`}`
});

export const createHttpTestApp = async (params: {
  controllers: Array<new (...args: any[]) => unknown>;
  providers: Provider[];
}): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({
    controllers: params.controllers,
    providers: [
      Reflector,
      JwtAuthGuard,
      RolesGuard,
      {
        provide: SessionAuthService,
        useValue: {
          authenticateToken: jest.fn((token: string) => {
            const [role, userId, email] = token.split(":");
            return {
              userId: userId || "user-1",
              email: email || "user@example.com",
              globalRole: (role || "reader") as "admin" | "editor" | "reader"
            };
          })
        }
      },
      ...params.providers
    ]
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
  await app.init();
  return app;
};
