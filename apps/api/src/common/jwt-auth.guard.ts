import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

import { SessionAuthService } from "./session-auth.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly sessionAuthService: SessionAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    request.user = await this.sessionAuthService.authenticateToken(token, {
      invalidToken: "Invalid token",
      expiredSession: "Session expired"
    });
    return true;
  }
}
