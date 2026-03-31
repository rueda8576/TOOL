import { Module } from "@nestjs/common";

import { GitlabModule } from "../gitlab/gitlab.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [GitlabModule],
  controllers: [ProjectsController],
  providers: [ProjectsService]
})
export class ProjectsModule {}
