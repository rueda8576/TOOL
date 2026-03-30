import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProjectAccessService } from "./project-access.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { SessionAuthService } from "./session-auth.service";

@Global()
@Module({
  imports: [AuthModule],
  providers: [ProjectAccessService, JwtAuthGuard, RolesGuard, SessionAuthService],
  exports: [ProjectAccessService, JwtAuthGuard, RolesGuard, SessionAuthService]
})
export class CommonModule {}
