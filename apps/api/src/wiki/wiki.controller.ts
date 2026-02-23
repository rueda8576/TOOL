import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { CreateWikiPageDto } from "./dto/create-wiki-page.dto";
import { UpdateWikiPageDto } from "./dto/update-wiki-page.dto";
import { WikiService } from "./wiki.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class WikiController {
  constructor(private readonly wikiService: WikiService) {}

  @Post("projects/:projectId/wiki-pages")
  createPage(
    @Param("projectId") projectId: string,
    @Body() dto: CreateWikiPageDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{
    id: string;
    projectId: string;
    slug: string;
    title: string;
    revisionNumber: number;
  }> {
    return this.wikiService.createPage(projectId, dto, user);
  }

  @Put("wiki-pages/:pageId")
  updatePage(
    @Param("pageId") pageId: string,
    @Body() dto: UpdateWikiPageDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ pageId: string; revisionNumber: number }> {
    return this.wikiService.updatePage(pageId, dto, user);
  }

  @Get("wiki-pages/:pageId/revisions")
  listRevisions(
    @Param("pageId") pageId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<Array<{
    id: string;
    revisionNumber: number;
    createdAt: Date;
    createdBy: { id: string; name: string; email: string };
    changeNote: string | null;
  }>> {
    return this.wikiService.listRevisions(pageId, user);
  }
}
