import { Module } from "@nestjs/common";

import { GitlabModule } from "../gitlab/gitlab.module";
import { WikiController } from "./wiki.controller";
import { WikiService } from "./wiki.service";

@Module({
  imports: [GitlabModule],
  controllers: [WikiController],
  providers: [WikiService]
})
export class WikiModule {}
