import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProjectAccessService } from "./project-access.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";

@Global()
@Module({
  imports: [AuthModule],
  providers: [ProjectAccessService, JwtAuthGuard, RolesGuard],
  exports: [ProjectAccessService, JwtAuthGuard, RolesGuard]
})
export class CommonModule {}
