import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CompileStatus, DocumentType } from "@prisma/client";
import AdmZip from "adm-zip";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queues/queue.service";
import { StorageService } from "../storage/storage.service";
import { CreateDocumentBranchDto } from "./dto/create-document-branch.dto";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { CreateDocumentVersionDto } from "./dto/create-document-version.dto";

type CompileStatusValue = "pending" | "running" | "succeeded" | "failed" | "timeout";
type DocumentTypeValue = "paper" | "manual" | "model" | "draft" | "minutes" | "other";

export type DocumentVersionSummary = {
  id: string;
  versionNumber: number;
  compileStatus: CompileStatusValue;
  hasPdf: boolean;
  hasLatex: boolean;
  latexEntryFile: string | null;
  createdAt: string;
};

export type DocumentListItem = {
  id: string;
  projectId: string;
  title: string;
  type: DocumentTypeValue;
  authors: string[];
  tags: string[];
  publishedAt: string | null;
  updatedAt: string;
  latestMainVersion: DocumentVersionSummary | null;
};

export type DocumentDetail = {
  id: string;
  projectId: string;
  title: string;
  type: DocumentTypeValue;
  authors: string[];
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestMainVersion: DocumentVersionSummary | null;
};

const mapDocumentType = (type?: string): DocumentType => {
  switch (type) {
    case "paper":
      return DocumentType.PAPER;
    case "manual":
      return DocumentType.MANUAL;
    case "model":
      return DocumentType.MODEL;
    case "draft":
      return DocumentType.DRAFT;
    case "minutes":
      return DocumentType.MINUTES;
    case "other":
    default:
      return DocumentType.OTHER;
  }
};

const mapDocumentTypeValue = (type: DocumentType): DocumentTypeValue => {
  switch (type) {
    case DocumentType.PAPER:
      return "paper";
    case DocumentType.MANUAL:
      return "manual";
    case DocumentType.MODEL:
      return "model";
    case DocumentType.DRAFT:
      return "draft";
    case DocumentType.MINUTES:
      return "minutes";
    case DocumentType.OTHER:
    default:
      return "other";
  }
};

const mapCompileStatusValue = (status: CompileStatus): CompileStatusValue => {
  switch (status) {
    case CompileStatus.RUNNING:
      return "running";
    case CompileStatus.SUCCEEDED:
      return "succeeded";
    case CompileStatus.FAILED:
      return "failed";
    case CompileStatus.TIMEOUT:
      return "timeout";
    case CompileStatus.PENDING:
    default:
      return "pending";
  }
};

@Injectable()
export class DocumentsService {
  private readonly storageRoot = getEnv().STORAGE_ROOT;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly storageService: StorageService,
    private readonly queueService: QueueService,
    private readonly auditService: AuditService
  ) {}

  private normalizeLatexPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("..")) {
      throw new BadRequestException("Invalid latex file path");
    }
    return normalized;
  }

  private workspaceAbsolutePath(workspaceRelativePath: string): string {
    const root = resolve(this.storageRoot);
    const absolute = resolve(this.storageRoot, workspaceRelativePath);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
      throw new BadRequestException("Invalid workspace path");
    }
    return absolute;
  }

  private async materializeLatexWorkspace(params: {
    documentVersionId: string;
    latexBundleStoragePath: string;
  }): Promise<string> {
    const workspaceRelativePath = `latex-workspaces/${params.documentVersionId}`;
    const workspaceAbsolutePath = this.workspaceAbsolutePath(workspaceRelativePath);
    await mkdir(workspaceAbsolutePath, { recursive: true });

    const zipBuffer = await this.storageService.readObject(params.latexBundleStoragePath);
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(workspaceAbsolutePath, true);

    return workspaceRelativePath;
  }

  private parseLatexPaths(rawPaths?: string): string[] | null {
    if (!rawPaths) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPaths);
    } catch {
      throw new BadRequestException("latexPaths must be a valid JSON array");
    }

    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new BadRequestException("latexPaths must be a JSON array of strings");
    }

    return parsed as string[];
  }

  private validateLatexFolderPaths(paths: string[]): string[] {
    const normalizedPaths = paths.map((path) => this.normalizeLatexPath(path));
    const seenPaths = new Set<string>();

    for (const normalizedPath of normalizedPaths) {
      if (seenPaths.has(normalizedPath)) {
        throw new BadRequestException(`Duplicate latex path: ${normalizedPath}`);
      }

      seenPaths.add(normalizedPath);
    }

    return normalizedPaths;
  }

  private async materializeLatexWorkspaceFromFolder(params: {
    documentVersionId: string;
    latexFiles: Express.Multer.File[];
    latexPaths: string[];
  }): Promise<string> {
    const workspaceRelativePath = `latex-workspaces/${params.documentVersionId}`;
    const workspaceAbsolutePath = this.workspaceAbsolutePath(workspaceRelativePath);
    await mkdir(workspaceAbsolutePath, { recursive: true });

    for (let index = 0; index < params.latexFiles.length; index += 1) {
      const uploadFile = params.latexFiles[index];
      const normalizedPath = params.latexPaths[index];
      if (!normalizedPath) {
        throw new BadRequestException("Missing latex path for uploaded file");
      }
      const absoluteTargetPath = resolve(workspaceAbsolutePath, normalizedPath);
      if (absoluteTargetPath !== workspaceAbsolutePath && !absoluteTargetPath.startsWith(`${workspaceAbsolutePath}${sep}`)) {
        throw new BadRequestException("Invalid latex file path");
      }

      await mkdir(dirname(absoluteTargetPath), { recursive: true });
      const sourceBuffer = await readFile(uploadFile.path);
      await writeFile(absoluteTargetPath, sourceBuffer);
    }

    return workspaceRelativePath;
  }

  private mapVersionSummary(version: {
    id: string;
    versionNumber: number;
    compileStatus: CompileStatus;
    compiledPdfFileId: string | null;
    pdfFileId: string | null;
    latexBundleFileId: string | null;
    latexWorkspacePath: string | null;
    latexEntryFile: string | null;
    createdAt: Date;
  } | null): DocumentVersionSummary | null {
    if (!version) {
      return null;
    }

    return {
      id: version.id,
      versionNumber: version.versionNumber,
      compileStatus: mapCompileStatusValue(version.compileStatus),
      hasPdf: Boolean(version.compiledPdfFileId || version.pdfFileId),
      hasLatex: Boolean(version.latexBundleFileId || version.latexWorkspacePath),
      latexEntryFile: version.latexEntryFile,
      createdAt: version.createdAt.toISOString()
    };
  }

  async listDocuments(projectId: string, user: AuthenticatedUser): Promise<DocumentListItem[]> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const documents = await this.prisma.document.findMany({
      where: {
        projectId,
        deletedAt: null
      },
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        type: true,
        authors: true,
        tags: true,
        publishedAt: true,
        updatedAt: true,
        versions: {
          where: {
            deletedAt: null,
            branch: {
              name: "main",
              deletedAt: null
            }
          },
          orderBy: {
            versionNumber: "desc"
          },
          take: 1,
          select: {
            id: true,
            versionNumber: true,
            compileStatus: true,
            compiledPdfFileId: true,
            pdfFileId: true,
            latexBundleFileId: true,
            latexWorkspacePath: true,
            latexEntryFile: true,
            createdAt: true
          }
        }
      }
    });

    return documents.map((document) => ({
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      type: mapDocumentTypeValue(document.type),
      authors: document.authors,
      tags: document.tags,
      publishedAt: document.publishedAt?.toISOString() ?? null,
      updatedAt: document.updatedAt.toISOString(),
      latestMainVersion: this.mapVersionSummary(document.versions[0] ?? null)
    }));
  }

  async getDocumentDetail(projectId: string, documentId: string, user: AuthenticatedUser): Promise<DocumentDetail> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        projectId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        type: true,
        authors: true,
        tags: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        versions: {
          where: {
            deletedAt: null,
            branch: {
              name: "main",
              deletedAt: null
            }
          },
          orderBy: {
            versionNumber: "desc"
          },
          take: 1,
          select: {
            id: true,
            versionNumber: true,
            compileStatus: true,
            compiledPdfFileId: true,
            pdfFileId: true,
            latexBundleFileId: true,
            latexWorkspacePath: true,
            latexEntryFile: true,
            createdAt: true
          }
        }
      }
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      type: mapDocumentTypeValue(document.type),
      authors: document.authors,
      tags: document.tags,
      publishedAt: document.publishedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      latestMainVersion: this.mapVersionSummary(document.versions[0] ?? null)
    };
  }

  async createDocument(projectId: string, dto: CreateDocumentDto, user: AuthenticatedUser): Promise<{
    id: string;
    projectId: string;
    title: string;
    type: DocumentType;
    mainBranchId: string;
  }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    const created = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          projectId,
          title: dto.title,
          type: mapDocumentType(dto.type),
          authors: dto.authors ?? [],
          tags: dto.tags ?? [],
          publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
          createdById: user.userId
        },
        select: {
          id: true,
          projectId: true,
          title: true,
          type: true
        }
      });

      const mainBranch = await tx.documentBranch.create({
        data: {
          documentId: document.id,
          name: "main",
          createdById: user.userId
        },
        select: { id: true }
      });

      return {
        ...document,
        mainBranchId: mainBranch.id
      };
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "document",
      entityId: created.id,
      action: "document.create"
    });

    return created;
  }

  async createBranch(documentId: string, dto: CreateDocumentBranchDto, user: AuthenticatedUser): Promise<{
    id: string;
    documentId: string;
    name: string;
    baseVersionId: string | null;
  }> {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, document.projectId);

    if (dto.baseVersionId) {
      const baseVersion = await this.prisma.documentVersion.findFirst({
        where: {
          id: dto.baseVersionId,
          documentId
        },
        select: { id: true }
      });

      if (!baseVersion) {
        throw new BadRequestException("Base version does not belong to document");
      }
    }

    const branch = await this.prisma.documentBranch.create({
      data: {
        documentId,
        name: dto.name,
        baseVersionId: dto.baseVersionId,
        createdById: user.userId
      },
      select: {
        id: true,
        documentId: true,
        name: true,
        baseVersionId: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: document.projectId,
      entityType: "document_branch",
      entityId: branch.id,
      action: "document.branch.create",
      metadata: { documentId, branchName: dto.name }
    });

    return branch;
  }

  async createVersion(
    documentId: string,
    dto: CreateDocumentVersionDto,
    files: { pdf?: Express.Multer.File[]; latexBundle?: Express.Multer.File[]; latexFiles?: Express.Multer.File[] },
    user: AuthenticatedUser
  ): Promise<{
    id: string;
    documentId: string;
    branchId: string;
    versionNumber: number;
    compileStatus: CompileStatus;
  }> {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, document.projectId);

    const branchName = dto.branchName ?? "main";

    const branch = await this.prisma.documentBranch.upsert({
      where: {
        documentId_name: {
          documentId,
          name: branchName
        }
      },
      create: {
        documentId,
        name: branchName,
        createdById: user.userId
      },
      update: {},
      select: {
        id: true
      }
    });

    const latestVersion = await this.prisma.documentVersion.findFirst({
      where: { branchId: branch.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true }
    });

    const pdfUpload = files.pdf?.[0] ?? null;
    const latexBundleUpload = files.latexBundle?.[0] ?? null;
    const latexFiles = files.latexFiles ?? [];
    const latexPaths = this.parseLatexPaths(dto.latexPaths);
    const usingLatexFolder = latexFiles.length > 0;

    if (latexPaths && !usingLatexFolder) {
      throw new BadRequestException("latexPaths can only be provided with latexFiles");
    }

    if (usingLatexFolder && !latexPaths) {
      throw new BadRequestException("latexPaths is required when latexFiles are uploaded");
    }

    if (usingLatexFolder && latexPaths && latexPaths.length !== latexFiles.length) {
      throw new BadRequestException("latexPaths length must match latexFiles length");
    }

    const normalizedLatexPaths = usingLatexFolder ? this.validateLatexFolderPaths(latexPaths ?? []) : [];

    if (usingLatexFolder && latexBundleUpload) {
      throw new BadRequestException("Provide either latexBundle or latexFiles, not both");
    }

    if (!pdfUpload && !latexBundleUpload && !usingLatexFolder) {
      throw new BadRequestException("At least one file is required: pdf or latexBundle or latexFiles");
    }

    const [pdfFile, latexBundle] = await Promise.all([
      pdfUpload ? this.storageService.saveUpload(pdfUpload, user.userId) : Promise.resolve(null),
      latexBundleUpload ? this.storageService.saveUpload(latexBundleUpload, user.userId) : Promise.resolve(null)
    ]);

    const createdVersion = await this.prisma.documentVersion.create({
      data: {
        documentId,
        branchId: branch.id,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        notes: dto.notes,
        latexEntryFile: dto.latexEntryFile ?? "main.tex",
        pdfFileId: pdfFile?.id,
        latexBundleFileId: latexBundle?.id,
        compileStatus: latexBundle || usingLatexFolder ? CompileStatus.PENDING : CompileStatus.SUCCEEDED,
        createdById: user.userId
      },
      select: {
        id: true,
        documentId: true,
        branchId: true,
        versionNumber: true,
        compileStatus: true
      }
    });

    let latexWorkspacePath: string | null = null;
    if (latexBundle && createdVersion.id) {
      latexWorkspacePath = await this.materializeLatexWorkspace({
        documentVersionId: createdVersion.id,
        latexBundleStoragePath: latexBundle.storagePath
      });
    } else if (usingLatexFolder && createdVersion.id) {
      latexWorkspacePath = await this.materializeLatexWorkspaceFromFolder({
        documentVersionId: createdVersion.id,
        latexFiles,
        latexPaths: normalizedLatexPaths
      });
    }

    const version = latexWorkspacePath
      ? await this.prisma.documentVersion.update({
          where: { id: createdVersion.id },
          data: {
            latexWorkspacePath
          },
          select: {
            id: true,
            documentId: true,
            branchId: true,
            versionNumber: true,
            compileStatus: true
          }
        })
      : createdVersion;

    await this.auditService.log({
      userId: user.userId,
      projectId: document.projectId,
      entityType: "document_version",
      entityId: version.id,
      action: "document.version.create",
      metadata: {
        documentId,
        branch: branchName,
        versionNumber: version.versionNumber
      }
    });

    return version;
  }

  async enqueueCompile(documentVersionId: string, user: AuthenticatedUser): Promise<{
    compileJobId: string;
    documentVersionId: string;
    status: CompileStatus;
  }> {
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: documentVersionId,
        deletedAt: null
      },
      select: {
        id: true,
        latexBundleFileId: true,
        latexWorkspacePath: true,
        document: {
          select: {
            projectId: true
          }
        }
      }
    });

    if (!version) {
      throw new NotFoundException("Document version not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, version.document.projectId);

    if (!version.latexBundleFileId && !version.latexWorkspacePath) {
      throw new BadRequestException("This version does not include editable LaTeX source");
    }

    const compileJob = await this.prisma.documentCompileJob.create({
      data: {
        documentVersionId,
        status: CompileStatus.PENDING
      },
      select: {
        id: true
      }
    });

    const queueJobId = await this.queueService.enqueueCompile({
      documentVersionId,
      compileJobId: compileJob.id
    });

    await this.prisma.documentCompileJob.update({
      where: { id: compileJob.id },
      data: {
        queueJobId
      }
    });

    await this.prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: {
        compileStatus: CompileStatus.PENDING,
        compileLog: null
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: version.document.projectId,
      entityType: "document_version",
      entityId: documentVersionId,
      action: "document.version.compile_queued",
      metadata: {
        compileJobId: compileJob.id,
        queueJobId
      }
    });

    return {
      compileJobId: compileJob.id,
      documentVersionId,
      status: CompileStatus.PENDING
    };
  }

  async getCompileLog(documentVersionId: string, user: AuthenticatedUser): Promise<{
    documentVersionId: string;
    compileStatus: CompileStatus;
    compileLog: string | null;
    compiledPdfFileId: string | null;
  }> {
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: documentVersionId,
        deletedAt: null
      },
      select: {
        id: true,
        compileStatus: true,
        compileLog: true,
        compiledPdfFileId: true,
        document: {
          select: { projectId: true }
        }
      }
    });

    if (!version) {
      throw new NotFoundException("Document version not found");
    }

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, version.document.projectId);

    return {
      documentVersionId: version.id,
      compileStatus: version.compileStatus,
      compileLog: version.compileLog,
      compiledPdfFileId: version.compiledPdfFileId
    };
  }

  async getPdfBytes(documentVersionId: string, user: AuthenticatedUser): Promise<{
    buffer: Buffer;
    fileName: string;
  }> {
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: documentVersionId,
        deletedAt: null
      },
      select: {
        id: true,
        document: {
          select: {
            projectId: true
          }
        },
        compiledPdfFile: {
          select: {
            storagePath: true,
            originalName: true
          }
        },
        pdfFile: {
          select: {
            storagePath: true,
            originalName: true
          }
        }
      }
    });

    if (!version) {
      throw new NotFoundException("Document version not found");
    }

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, version.document.projectId);

    const file = version.compiledPdfFile ?? version.pdfFile;

    if (!file) {
      throw new NotFoundException("No PDF available for this version");
    }

    return {
      buffer: await this.storageService.readObject(file.storagePath),
      fileName: file.originalName
    };
  }

  async getLatexTree(documentVersionId: string, user: AuthenticatedUser): Promise<{
    documentVersionId: string;
    files: Array<{ path: string; isDirectory: boolean }>;
  }> {
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: documentVersionId,
        deletedAt: null
      },
      select: {
        id: true,
        latexWorkspacePath: true,
        document: {
          select: { projectId: true }
        }
      }
    });

    if (!version) {
      throw new NotFoundException("Document version not found");
    }

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, version.document.projectId);

    if (!version.latexWorkspacePath) {
      throw new NotFoundException("This version has no editable latex workspace");
    }

    const workspaceRoot = this.workspaceAbsolutePath(version.latexWorkspacePath);

    const walk = async (relative = ""): Promise<Array<{ path: string; isDirectory: boolean }>> => {
      const targetDir = join(workspaceRoot, relative);
      const entries = await readdir(targetDir, { withFileTypes: true });
      const result: Array<{ path: string; isDirectory: boolean }> = [];

      for (const entry of entries) {
        const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          result.push({ path: entryPath, isDirectory: true });
          result.push(...(await walk(entryPath)));
        } else {
          result.push({ path: entryPath, isDirectory: false });
        }
      }

      return result;
    };

    return {
      documentVersionId,
      files: await walk()
    };
  }

  async getLatexFile(documentVersionId: string, filePath: string, user: AuthenticatedUser): Promise<{
    documentVersionId: string;
    path: string;
    content: string;
  }> {
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: documentVersionId,
        deletedAt: null
      },
      select: {
        id: true,
        latexWorkspacePath: true,
        document: {
          select: { projectId: true }
        }
      }
    });

    if (!version) {
      throw new NotFoundException("Document version not found");
    }

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, version.document.projectId);

    if (!version.latexWorkspacePath) {
      throw new NotFoundException("This version has no editable latex workspace");
    }

    const normalizedPath = this.normalizeLatexPath(filePath);
    const workspaceRoot = this.workspaceAbsolutePath(version.latexWorkspacePath);
    const absoluteFilePath = resolve(workspaceRoot, normalizedPath);
    if (absoluteFilePath !== workspaceRoot && !absoluteFilePath.startsWith(`${workspaceRoot}${sep}`)) {
      throw new BadRequestException("Invalid latex file path");
    }

    const content = await readFile(absoluteFilePath, "utf8");

    return {
      documentVersionId,
      path: normalizedPath,
      content
    };
  }

  async updateLatexFile(
    documentVersionId: string,
    filePath: string,
    content: string,
    user: AuthenticatedUser
  ): Promise<{ documentVersionId: string; path: string; sizeBytes: number }> {
    const version = await this.prisma.documentVersion.findFirst({
      where: {
        id: documentVersionId,
        deletedAt: null
      },
      select: {
        id: true,
        latexWorkspacePath: true,
        document: {
          select: { projectId: true }
        }
      }
    });

    if (!version) {
      throw new NotFoundException("Document version not found");
    }

    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, version.document.projectId);

    if (!version.latexWorkspacePath) {
      throw new NotFoundException("This version has no editable latex workspace");
    }

    const normalizedPath = this.normalizeLatexPath(filePath);
    const workspaceRoot = this.workspaceAbsolutePath(version.latexWorkspacePath);
    const absoluteFilePath = resolve(workspaceRoot, normalizedPath);
    if (absoluteFilePath !== workspaceRoot && !absoluteFilePath.startsWith(`${workspaceRoot}${sep}`)) {
      throw new BadRequestException("Invalid latex file path");
    }

    await mkdir(dirname(absoluteFilePath), { recursive: true });
    await writeFile(absoluteFilePath, content, "utf8");

    await this.prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: {
        compileStatus: CompileStatus.PENDING,
        compileLog: null
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: version.document.projectId,
      entityType: "document_latex_file",
      entityId: `${documentVersionId}:${normalizedPath}`,
      action: "document.version.latex_file.update"
    });

    return {
      documentVersionId,
      path: normalizedPath,
      sizeBytes: Buffer.byteLength(content, "utf8")
    };
  }
}
