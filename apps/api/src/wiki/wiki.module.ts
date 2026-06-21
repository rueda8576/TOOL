import { Module } from "@nestjs/common";

import { GitlabModule } from "../gitlab/gitlab.module";
import { WikiController } from "./wiki.controller";
import { WikiAssetsService } from "./wiki-assets.service";
import { WikiDocsRepositoriesService } from "./wiki-docs-repositories.service";
import { WikiService } from "./wiki.service";

@Module({
  imports: [GitlabModule],
  controllers: [WikiController],
  providers: [WikiAssetsService, WikiDocsRepositoriesService, WikiService]
})
export class WikiModule {}
