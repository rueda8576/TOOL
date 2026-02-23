import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { getEnv } from "../config/env";
import { hashValue } from "./crypto";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const token = authHeader.slice("Bearer ".length).trim();

    try {
      const payload = this.jwtService.verify(token, { secret: getEnv().JWT_SECRET });

      const session = await this.prisma.session.findFirst({
        where: {
          userId: payload.sub,
          tokenHash: hashValue(token),
          expiresAt: {
            gt: new Date()
          }
        },
        select: { id: true }
      });

      if (!session) {
        throw new UnauthorizedException("Session expired");
      }

      request.user = {
        userId: payload.sub,
        email: payload.email,
        globalRole: payload.role
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }
}
