import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { CreateProjectRepositoryDto } from "./dto/create-project-repository.dto";
import { CreateRepositoryBranchDto } from "./dto/create-repository-branch.dto";
import { CreateRepositoryMergeRequestDto } from "./dto/create-repository-merge-request.dto";
import { GetRepositoryArchiveQueryDto } from "./dto/get-repository-archive-query.dto";
import { GetRepositoryFileQueryDto } from "./dto/get-repository-file-query.dto";
import { LinkProjectRepositoryDto } from "./dto/link-project-repository.dto";
import { ListRepositoryCommitsQueryDto } from "./dto/list-repository-commits-query.dto";
import { ListRepositoryMergeRequestsQueryDto } from "./dto/list-repository-merge-requests-query.dto";
import { ListRepositoryTreeQueryDto } from "./dto/list-repository-tree-query.dto";
import { SearchGitlabProjectsQueryDto } from "./dto/search-gitlab-projects-query.dto";
import { GitlabService } from "./gitlab.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class GitlabController {
  constructor(private readonly gitlabService: GitlabService) {}

  @Get("gitlab/projects/search")
  @Roles("admin")
  searchProjects(
    @Query() query: SearchGitlabProjectsQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.searchProjects(user, query.q ?? "");
  }

  @Get("projects/:projectId/repository")
  getRepositoryStatus(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.gitlabService.getRepositoryStatus(projectId, user);
  }

  @Get("projects/:projectId/repositories")
  listRepositories(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.gitlabService.listRepositories(projectId, user);
  }

  @Post("projects/:projectId/repository/access/ensure")
  ensureRepositoryAccess(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.gitlabService.ensureCurrentUserRepositoryAccess(projectId, user);
  }

  @Post("projects/:projectId/repositories/:repositoryId/access/ensure")
  ensureScopedRepositoryAccess(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.ensureCurrentUserRepositoryAccess(projectId, user, repositoryId);
  }

  @Post("projects/:projectId/repository/link")
  @Roles("admin")
  linkRepository(
    @Param("projectId") projectId: string,
    @Body() dto: LinkProjectRepositoryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.linkRepository(projectId, dto, user);
  }

  @Post("projects/:projectId/repository/create")
  createRepository(
    @Param("projectId") projectId: string,
    @Body() dto: CreateProjectRepositoryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.createRepository(projectId, dto, user);
  }

  @Post("projects/:projectId/repositories")
  createRepositoryFromList(
    @Param("projectId") projectId: string,
    @Body() dto: CreateProjectRepositoryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.createRepository(projectId, dto, user);
  }

  @Delete("projects/:projectId/repository")
  @Roles("admin")
  disconnectRepository(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.gitlabService.disconnectRepository(projectId, user);
  }

  @Get("projects/:projectId/repository/branches")
  listBranches(@Param("projectId") projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.gitlabService.listBranches(projectId, user);
  }

  @Get("projects/:projectId/repositories/:repositoryId/branches")
  listScopedBranches(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.listBranches(projectId, user, repositoryId);
  }

  @Get("projects/:projectId/repository/commits")
  listCommits(
    @Param("projectId") projectId: string,
    @Query() query: ListRepositoryCommitsQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.listCommits(projectId, query.ref, user);
  }

  @Get("projects/:projectId/repositories/:repositoryId/commits")
  listScopedCommits(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Query() query: ListRepositoryCommitsQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.listCommits(projectId, query.ref, user, repositoryId);
  }

  @Get("projects/:projectId/repository/tree")
  getTree(
    @Param("projectId") projectId: string,
    @Query() query: ListRepositoryTreeQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.getRepositoryTree(projectId, query.path, query.ref, user);
  }

  @Get("projects/:projectId/repositories/:repositoryId/tree")
  getScopedTree(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Query() query: ListRepositoryTreeQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.getRepositoryTree(projectId, query.path, query.ref, user, repositoryId);
  }

  @Get("projects/:projectId/repository/file")
  getFile(
    @Param("projectId") projectId: string,
    @Query() query: GetRepositoryFileQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.getRepositoryFile(projectId, query.filePath, query.ref, user);
  }

  @Get("projects/:projectId/repositories/:repositoryId/file")
  getScopedFile(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Query() query: GetRepositoryFileQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.getRepositoryFile(projectId, query.filePath, query.ref, user, repositoryId);
  }

  @Get("projects/:projectId/repository/file/raw")
  async getRawFile(
    @Param("projectId") projectId: string,
    @Query() query: GetRepositoryFileQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const rawFile = await this.gitlabService.getRepositoryRawFile(projectId, query.filePath, query.ref, user);
    res.setHeader("Content-Type", rawFile.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${rawFile.fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(rawFile.buffer);
  }

  @Get("projects/:projectId/repositories/:repositoryId/file/raw")
  async getScopedRawFile(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Query() query: GetRepositoryFileQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const rawFile = await this.gitlabService.getRepositoryRawFile(projectId, query.filePath, query.ref, user, repositoryId);
    res.setHeader("Content-Type", rawFile.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${rawFile.fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(rawFile.buffer);
  }

  @Get("projects/:projectId/repository/merge-requests")
  listMergeRequests(
    @Param("projectId") projectId: string,
    @Query() query: ListRepositoryMergeRequestsQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.listMergeRequests(projectId, query.state, user);
  }

  @Get("projects/:projectId/repositories/:repositoryId/merge-requests")
  listScopedMergeRequests(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Query() query: ListRepositoryMergeRequestsQueryDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.listMergeRequests(projectId, query.state, user, repositoryId);
  }

  @Get("projects/:projectId/repository/archive")
  async getRepositoryArchive(
    @Param("projectId") projectId: string,
    @Query() query: GetRepositoryArchiveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const archive = await this.gitlabService.getRepositoryArchive(projectId, query.ref, user);
    res.setHeader("Content-Type", archive.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${archive.fileName}"`);
    res.send(archive.buffer);
  }

  @Get("projects/:projectId/repositories/:repositoryId/archive")
  async getScopedRepositoryArchive(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Query() query: GetRepositoryArchiveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const archive = await this.gitlabService.getRepositoryArchive(projectId, query.ref, user, repositoryId);
    res.setHeader("Content-Type", archive.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${archive.fileName}"`);
    res.send(archive.buffer);
  }

  @Post("projects/:projectId/repository/branches")
  createBranch(
    @Param("projectId") projectId: string,
    @Body() dto: CreateRepositoryBranchDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.createBranch(projectId, dto, user);
  }

  @Post("projects/:projectId/repositories/:repositoryId/branches")
  createScopedBranch(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Body() dto: CreateRepositoryBranchDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.createBranch(projectId, dto, user, repositoryId);
  }

  @Post("projects/:projectId/repository/merge-requests")
  createMergeRequest(
    @Param("projectId") projectId: string,
    @Body() dto: CreateRepositoryMergeRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.createMergeRequest(projectId, dto, user);
  }

  @Post("projects/:projectId/repositories/:repositoryId/merge-requests")
  createScopedMergeRequest(
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
    @Body() dto: CreateRepositoryMergeRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.gitlabService.createMergeRequest(projectId, dto, user, repositoryId);
  }
}
