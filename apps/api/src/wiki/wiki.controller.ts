import { Body, Controller, Get, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { CreateWikiPageDto } from "./dto/create-wiki-page.dto";
import { GetWikiByPathQueryDto } from "./dto/get-wiki-by-path-query.dto";
import { PublishWikiPageDto } from "./dto/publish-wiki-page.dto";
import { SaveWikiDraftDto } from "./dto/save-wiki-draft.dto";
import { SearchWikiPagesQueryDto } from "./dto/search-wiki-pages-query.dto";
import { UpdateWikiPageDto } from "./dto/update-wiki-page.dto";
import { WikiService } from "./wiki.service";
import { WikiBacklinkView, WikiPageDetail, WikiSearchResult, WikiTreeNode } from "./wiki.types";

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
    path: string;
    revisionNumber: number;
  }> {
    return this.wikiService.createPage(projectId, dto, user);
  }

  @Get("projects/:projectId/wiki-pages/tree")
  listTree(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<WikiTreeNode[]> {
    return this.wikiService.listTree(projectId, user);
  }

  @Get("projects/:projectId/wiki-pages/by-path")
  getByPath(
    @Param("projectId") projectId: string,
    @Query() query: GetWikiByPathQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<WikiPageDetail> {
    return this.wikiService.getByPath(projectId, query.path, user);
  }

  @Get("projects/:projectId/wiki-pages/search")
  searchPages(
    @Param("projectId") projectId: string,
    @Query() query: SearchWikiPagesQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<WikiSearchResult[]> {
    return this.wikiService.searchPages(projectId, query, user);
  }

  @Put("wiki-pages/:pageId/draft")
  saveDraft(
    @Param("pageId") pageId: string,
    @Body() dto: SaveWikiDraftDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ draftVersion: number; updatedAt: string; updatedBy: { id: string; name: string; email: string } }> {
    return this.wikiService.saveDraft(pageId, dto, user);
  }

  @Post("wiki-pages/:pageId/publish")
  publishDraft(
    @Param("pageId") pageId: string,
    @Body() dto: PublishWikiPageDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ pageId: string; revisionNumber: number; publishedAt: string; draftVersion: number }> {
    return this.wikiService.publishDraft(pageId, dto, user);
  }

  @Get("wiki-pages/:pageId/backlinks")
  listBacklinks(
    @Param("pageId") pageId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<WikiBacklinkView[]> {
    return this.wikiService.listBacklinks(pageId, user);
  }

  @Post("projects/:projectId/wiki-assets")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const target = join(tmpdir(), "doctoral-platform-uploads");
          if (!existsSync(target)) {
            mkdirSync(target, { recursive: true });
          }
          callback(null, target);
        },
        filename: (_req, file, callback) => {
          const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
          callback(null, `${Date.now()}-${safeName}`);
        }
      })
    })
  )
  uploadAsset(
    @Param("projectId") projectId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ assetId: string; url: string; mimeType: string; sizeBytes: number; originalName: string }> {
    return this.wikiService.uploadWikiAsset(projectId, file, user);
  }

  @Get("wiki-assets/:assetId/content")
  async getAssetContent(
    @Param("assetId") assetId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const asset = await this.wikiService.getWikiAssetContent(assetId, user);
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${asset.fileName}"`);
    res.send(asset.buffer);
  }

  // Legacy alias kept for backwards compatibility.
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
    publishedAt: string;
    createdBy: { id: string; name: string; email: string };
    changeNote: string | null;
  }>> {
    return this.wikiService.listRevisions(pageId, user);
  }
}
