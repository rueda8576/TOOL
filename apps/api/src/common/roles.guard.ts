import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Array<"admin" | "editor" | "reader">>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { globalRole?: string };

    if (!user?.globalRole) {
      throw new ForbiddenException("Missing authenticated role");
    }

    if (!requiredRoles.includes(user.globalRole as "admin" | "editor" | "reader")) {
      throw new ForbiddenException("Insufficient role");
    }

    return true;
  }
}
