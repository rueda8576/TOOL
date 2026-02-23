import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { diskStorage } from "multer";
import type { Response } from "express";

import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { AuthenticatedUser } from "../common/authenticated-user";
import { getEnv } from "../config/env";
import { CreateDocumentBranchDto } from "./dto/create-document-branch.dto";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { CreateDocumentVersionDto } from "./dto/create-document-version.dto";
import { UpdateLatexFileDto } from "./dto/update-latex-file.dto";
import { DocumentDetail, DocumentListItem, DocumentsService } from "./documents.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get("projects/:projectId/documents")
  listDocuments(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<DocumentListItem[]> {
    return this.documentsService.listDocuments(projectId, user);
  }

  @Get("projects/:projectId/documents/:documentId")
  getDocumentDetail(
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<DocumentDetail> {
    return this.documentsService.getDocumentDetail(projectId, documentId, user);
  }

  @Post("projects/:projectId/documents")
  createDocument(
    @Param("projectId") projectId: string,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{
    id: string;
    projectId: string;
    title: string;
    type: string;
    mainBranchId: string;
  }> {
    return this.documentsService.createDocument(projectId, dto, user);
  }

  @Post("documents/:documentId/branches")
  createBranch(
    @Param("documentId") documentId: string,
    @Body() dto: CreateDocumentBranchDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; documentId: string; name: string; baseVersionId: string | null }> {
    return this.documentsService.createBranch(documentId, dto, user);
  }

  @Post("documents/:documentId/versions")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "pdf", maxCount: 1 },
        { name: "latexBundle", maxCount: 1 },
        { name: "latexFiles", maxCount: 2000 }
      ],
      {
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            const target = join(tmpdir(), "doctoral-platform-uploads");
            if (!existsSync(target)) {
              mkdirSync(target, { recursive: true });
            }
            cb(null, target);
          },
          filename: (_req, file, cb) => {
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
            cb(null, `${Date.now()}-${safeName}`);
          }
        }),
        limits: {
          fileSize: getEnv().PDF_UPLOAD_LIMIT_BYTES
        }
      }
    )
  )
  createVersion(
    @Param("documentId") documentId: string,
    @Body() dto: CreateDocumentVersionDto,
    @UploadedFiles()
    files: {
      pdf?: Express.Multer.File[];
      latexBundle?: Express.Multer.File[];
      latexFiles?: Express.Multer.File[];
    },
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ id: string; documentId: string; branchId: string; versionNumber: number; compileStatus: string }> {
    return this.documentsService.createVersion(documentId, dto, files, user);
  }

  @Post("document-versions/:documentVersionId/compile")
  compileVersion(
    @Param("documentVersionId") documentVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ compileJobId: string; documentVersionId: string; status: string }> {
    return this.documentsService.enqueueCompile(documentVersionId, user);
  }

  @Get("document-versions/:documentVersionId/compile-log")
  getCompileLog(
    @Param("documentVersionId") documentVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ documentVersionId: string; compileStatus: string; compileLog: string | null; compiledPdfFileId: string | null }> {
    return this.documentsService.getCompileLog(documentVersionId, user);
  }

  @Get("document-versions/:documentVersionId/pdf")
  async getVersionPdf(
    @Param("documentVersionId") documentVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const result = await this.documentsService.getPdfBytes(documentVersionId, user);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=\"${result.fileName}\"`);
    res.send(result.buffer);
  }

  @Get("document-versions/:documentVersionId/latex/tree")
  getLatexTree(
    @Param("documentVersionId") documentVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ documentVersionId: string; files: Array<{ path: string; isDirectory: boolean }> }> {
    return this.documentsService.getLatexTree(documentVersionId, user);
  }

  @Get("document-versions/:documentVersionId/latex/file")
  getLatexFile(
    @Param("documentVersionId") documentVersionId: string,
    @Query("path") path: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ documentVersionId: string; path: string; content: string }> {
    return this.documentsService.getLatexFile(documentVersionId, path, user);
  }

  @Put("document-versions/:documentVersionId/latex/file")
  updateLatexFile(
    @Param("documentVersionId") documentVersionId: string,
    @Body() dto: UpdateLatexFileDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ documentVersionId: string; path: string; sizeBytes: number }> {
    return this.documentsService.updateLatexFile(documentVersionId, dto.path, dto.content, user);
  }
}
