import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "./authenticated-user";
import { hashValue } from "./crypto";
import { prismaRoleToApiRole } from "./role-map";

type JwtTokenPayload = {
  sub?: string;
  email?: string;
  role?: "admin" | "editor" | "reader";
};

@Injectable()
export class SessionAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async authenticateToken(
    token: string,
    messages?: {
      invalidToken?: string;
      expiredSession?: string;
    }
  ): Promise<AuthenticatedUser> {
    let payload: JwtTokenPayload;

    try {
      payload = this.jwtService.verify<JwtTokenPayload>(token, {
        secret: getEnv().JWT_SECRET
      });
    } catch {
      throw new UnauthorizedException(messages?.invalidToken ?? "Invalid token");
    }

    if (!payload.sub) {
      throw new UnauthorizedException(messages?.invalidToken ?? "Invalid token");
    }

    const session = await this.prisma.session.findFirst({
      where: {
        userId: payload.sub,
        tokenHash: hashValue(token),
        expiresAt: {
          gt: new Date()
        },
        user: {
          deletedAt: null,
          isActive: true
        }
      },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            globalRole: true
          }
        }
      }
    });

    if (!session) {
      throw new UnauthorizedException(messages?.expiredSession ?? "Session expired");
    }

    return {
      userId: session.user.id,
      email: session.user.email,
      globalRole: prismaRoleToApiRole(session.user.globalRole)
    };
  }
}
