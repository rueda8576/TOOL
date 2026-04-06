import { UnauthorizedException } from "@nestjs/common";
import { GlobalRole } from "@prisma/client";

import { SessionAuthService } from "./session-auth.service";

describe("SessionAuthService", () => {
  const makeService = (): { service: SessionAuthService; jwtService: any; prisma: any } => {
    const jwtService = {
      verify: jest.fn()
    };

    const prisma = {
      session: {
        findFirst: jest.fn()
      }
    };

    return {
      service: new SessionAuthService(jwtService as any, prisma as any),
      jwtService,
      prisma
    };
  };

  it("returns the current DB user role instead of trusting the JWT role", async () => {
    const { service, jwtService, prisma } = makeService();
    jwtService.verify.mockReturnValue({
      sub: "user-1",
      email: "stale@example.com",
      role: "admin"
    });
    prisma.session.findFirst.mockResolvedValue({
      user: {
        id: "user-1",
        email: "fresh@example.com",
        globalRole: GlobalRole.READER
      }
    });

    await expect(service.authenticateToken("token-1")).resolves.toEqual({
      userId: "user-1",
      email: "fresh@example.com",
      globalRole: "reader"
    });
  });

  it("rejects tokens with no active session", async () => {
    const { service, jwtService, prisma } = makeService();
    jwtService.verify.mockReturnValue({
      sub: "user-1",
      email: "user@example.com",
      role: "editor"
    });
    prisma.session.findFirst.mockResolvedValue(null);

    await expect(service.authenticateToken("token-2")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects invalid JWTs with a custom message", async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockImplementation(() => {
      throw new Error("bad token");
    });

    await expect(
      service.authenticateToken("token-3", {
        invalidToken: "Invalid collaboration token"
      })
    ).rejects.toThrow("Invalid collaboration token");
  });

  it("rejects tokens whose payload has no subject", async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({
      email: "user@example.com",
      role: "editor"
    });

    await expect(
      service.authenticateToken("token-4", {
        invalidToken: "Missing collaboration subject"
      })
    ).rejects.toThrow("Missing collaboration subject");
  });

  it("rejects expired sessions with a custom message", async () => {
    const { service, jwtService, prisma } = makeService();
    jwtService.verify.mockReturnValue({
      sub: "user-1",
      email: "user@example.com",
      role: "editor"
    });
    prisma.session.findFirst.mockResolvedValue(null);

    await expect(
      service.authenticateToken("token-5", {
        expiredSession: "Realtime session expired"
      })
    ).rejects.toThrow("Realtime session expired");
  });
});
