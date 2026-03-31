import { Module } from "@nestjs/common";

import { GitlabModule } from "../gitlab/gitlab.module";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";

@Module({
  imports: [GitlabModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService]
})
export class AdminModule {}
