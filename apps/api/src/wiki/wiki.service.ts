import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { getDocumentsCollaborationServer } from "../documents/collaboration-server-registry";
import {
  GitlabService,
  RepositoryDocsMarkdownFile
} from "../gitlab/gitlab.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { CreateWikiPageDto } from "./dto/create-wiki-page.dto";
import { ImportWikiPageEntryDto, ImportWikiPagesDto } from "./dto/import-wiki-pages.dto";
import { PublishWikiPageDto } from "./dto/publish-wiki-page.dto";
import { SaveWikiDraftDto } from "./dto/save-wiki-draft.dto";
import { SearchWikiPagesQueryDto } from "./dto/search-wiki-pages-query.dto";
import { UpdateWikiPageDto } from "./dto/update-wiki-page.dto";
import {
  WikiBacklinkView,
  WikiDocsSourceView,
  WikiDocsSyncConflict,
  WikiDocsSyncRepositoryResult,
  WikiDocsSyncRepositoryStatus,
  WikiDocsSyncResult,
  WikiDocsSyncStatus,
  WikiDraftView,
  WikiLinkView,
  WikiPageDetail,
  WikiPageSummary,
  WikiRevisionView,
  WikiSearchResult,
  WikiTreeNode,
  WikiUserSummary
} from "./wiki.types";

const WIKI_SEGMENT_PATTERN = /^[a-z0-9-]+$/;
const WIKI_LINK_PATTERN = /\[\[([^[\]]+)\]\]/g;
const MARKDOWN_LINK_PATTERN = /(?<!!)\[[^\]]+]\(([^)]+)\)/g;
const WIKI_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const WIKI_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const WIKI_DOCS_ROOT = "Docs";
const WIKI_DOCS_BINDING_STATUS_ACTIVE = "active";
const WIKI_DOCS_BINDING_STATUS_DELETED = "deleted";

type DbClient = PrismaClient | Prisma.TransactionClient;

type WikiPageWithDraftAndRevision = {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  folderPath: string;
  path: string;
  templateType: string | null;
  updatedAt: Date;
  createdById: string;
  currentRevision: {
    id: string;
    revisionNumber: number;
    contentMarkdown: string;
    createdAt: Date;
    changeNote: string | null;
    createdBy: WikiUserSummary;
  } | null;
  draft: {
    id: string;
    title: string;
    contentMarkdown: string;
    draftVersion: number;
    updatedAt: Date;
    updatedBy: WikiUserSummary;
  } | null;
};

type WikiSearchRow = {
  pageId: string;
  path: string;
  title: string;
  snippet: string | null;
  score: number;
  matchTitle: boolean;
  matchPath: boolean;
  matchPublished: boolean;
  matchDraft: boolean;
  updatedAt: Date;
};

type PreparedImportEntry = ImportWikiPageEntryDto & {
  slug: string;
  folderPath: string;
  path: string;
};

type WikiDocsRepositoryRecord = {
  id: string;
  projectId: string;
  name: string;
  pathWithNamespace: string;
  defaultBranch: string;
  wikiDocsPrefix: string | null;
  wikiDocsLastSyncedAt: Date | null;
  wikiDocsLastSyncError: string | null;
};

type WikiDocsBindingRecord = {
  id: string;
  projectId: string;
  repositoryId: string;
  wikiPageId: string | null;
  docsPath: string;
  wikiPath: string;
  gitBlobId: string | null;
  gitLastCommitId: string | null;
  gitContentHash: string | null;
  wikiRevisionId: string | null;
  wikiContentHash: string | null;
  status: string;
  lastSyncedAt: Date | null;
  wikiPage: {
    id: string;
    title: string;
    path: string;
    slug: string;
    folderPath: string;
    deletedAt: Date | null;
    currentRevisionId: string | null;
    currentRevision: {
      id: string;
      revisionNumber: number;
      contentMarkdown: string;
    } | null;
  } | null;
};

type PreparedDocsPage = {
  title: string;
  slug: string;
  folderPath: string;
  wikiPath: string;
  docsPath: string;
  contentMarkdown: string;
  contentHash: string;
};

@Injectable()
export class WikiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
    private readonly gitlabService: GitlabService
  ) {}

  private normalizeSlug(rawSlug: string): string {
    const slug = rawSlug.trim().toLowerCase();
    if (!WIKI_SEGMENT_PATTERN.test(slug)) {
      throw new BadRequestException("Invalid wiki slug");
    }
    return slug;
  }

  private normalizeFolderPath(rawFolderPath?: string): string {
    if (!rawFolderPath) {
      return "";
    }

    const cleaned = rawFolderPath.trim().toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!cleaned) {
      return "";
    }

    const segments = cleaned.split("/").filter(Boolean);
    for (const segment of segments) {
      if (!WIKI_SEGMENT_PATTERN.test(segment)) {
        throw new BadRequestException("Invalid wiki folder path");
      }
    }

    return segments.join("/");
  }

  private normalizePath(rawPath: string): string {
    const cleaned = rawPath.trim().toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!cleaned) {
      throw new BadRequestException("Wiki path is required");
    }

    const segments = cleaned.split("/").filter(Boolean);
    if (segments.length === 0) {
      throw new BadRequestException("Wiki path is required");
    }

    for (const segment of segments) {
      if (!WIKI_SEGMENT_PATTERN.test(segment)) {
        throw new BadRequestException("Invalid wiki path");
      }
    }

    return segments.join("/");
  }

  private composePath(folderPath: string, slug: string): string {
    return folderPath ? `${folderPath}/${slug}` : slug;
  }

  private hashMarkdownContent(contentMarkdown: string): string {
    return createHash("sha256").update(contentMarkdown, "utf8").digest("hex");
  }

  private toWikiPathSegment(rawSegment: string, fallback = "page"): string {
    const normalized = rawSegment
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
    return normalized || fallback;
  }

  private stripMarkdownExtension(fileName: string): string {
    return fileName.replace(/\.(md|markdown)$/i, "");
  }

  private humanizeFileStem(fileStem: string): string {
    const humanized = fileStem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return humanized || fileStem || "Untitled";
  }

  private extractTitleFromMarkdown(contentMarkdown: string, docsPath: string): string {
    for (const line of contentMarkdown.split("\n")) {
      const match = line.match(/^#\s+(.+?)\s*$/);
      if (match?.[1]?.trim()) {
        return match[1].trim().slice(0, 300);
      }
    }

    const fileName = docsPath.split("/").pop() ?? docsPath;
    return this.humanizeFileStem(this.stripMarkdownExtension(fileName)).slice(0, 300);
  }

  private docsPathToWikiPath(prefix: string, docsPath: string): string {
    const normalizedDocsPath = docsPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const relativePath = normalizedDocsPath.startsWith(`${WIKI_DOCS_ROOT}/`)
      ? normalizedDocsPath.slice(`${WIKI_DOCS_ROOT}/`.length)
      : normalizedDocsPath;
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length === 0) {
      throw new BadRequestException("Docs path is required");
    }

    const last = segments[segments.length - 1]!;
    const fileStem = this.stripMarkdownExtension(last);
    const wikiSegments = [
      prefix,
      ...segments.slice(0, -1).map((segment) => this.toWikiPathSegment(segment, "folder")),
      this.toWikiPathSegment(fileStem)
    ];
    return wikiSegments.join("/");
  }

  private wikiPathToDocsPath(prefix: string, wikiPath: string): string {
    const normalizedWikiPath = this.normalizePath(wikiPath);
    if (normalizedWikiPath !== prefix && !normalizedWikiPath.startsWith(`${prefix}/`)) {
      throw new BadRequestException("Wiki page is outside the repository Docs prefix");
    }

    const relativeWikiPath = normalizedWikiPath === prefix ? "index" : normalizedWikiPath.slice(prefix.length + 1);
    return `${WIKI_DOCS_ROOT}/${relativeWikiPath}.md`;
  }

  private buildPreparedDocsPage(prefix: string, file: RepositoryDocsMarkdownFile): PreparedDocsPage {
    const wikiPath = this.docsPathToWikiPath(prefix, file.docsPath);
    const segments = wikiPath.split("/");
    const slug = segments[segments.length - 1]!;
    const folderPath = segments.slice(0, -1).join("/");
    const title = this.extractTitleFromMarkdown(file.content, file.docsPath);
    return {
      title,
      slug,
      folderPath,
      wikiPath,
      docsPath: file.docsPath,
      contentMarkdown: file.content,
      contentHash: this.hashMarkdownContent(file.content)
    };
  }

  private isExternalMarkdownTarget(rawTarget: string): boolean {
    const target = rawTarget.trim();
    return (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("data:") ||
      target.startsWith("mailto:") ||
      target.startsWith("#") ||
      target.startsWith("/") ||
      target.startsWith("//")
    );
  }

  private resolveRelativeDocsPath(fromDocsPath: string, rawTarget: string): string | null {
    if (!rawTarget.trim() || this.isExternalMarkdownTarget(rawTarget)) {
      return null;
    }

    let targetPath = rawTarget.trim().replace(/^<|>$/g, "").split("#")[0]?.split("?")[0] ?? "";
    try {
      targetPath = decodeURIComponent(targetPath);
    } catch {
      // Keep raw target when it is not URI-encoded.
    }
    if (!/\.(md|markdown)$/i.test(targetPath)) {
      return null;
    }

    const sourceSegments = fromDocsPath.replace(/\\/g, "/").split("/").filter(Boolean);
    sourceSegments.pop();
    const resolvedSegments = [...sourceSegments];
    for (const segment of targetPath.replace(/\\/g, "/").split("/")) {
      if (!segment || segment === ".") {
        continue;
      }
      if (segment === "..") {
        if (resolvedSegments.length === 0) {
          return null;
        }
        resolvedSegments.pop();
        continue;
      }
      resolvedSegments.push(segment);
    }

    return resolvedSegments.join("/");
  }

  private parseMarkdownRelativeWikiLinks(contentMarkdown: string, docsSource?: { prefix: string; docsPath: string }): string[] {
    if (!docsSource) {
      return [];
    }

    const links = new Set<string>();
    for (const match of contentMarkdown.matchAll(MARKDOWN_LINK_PATTERN)) {
      const rawTarget = (match[1] ?? "").trim();
      const resolvedDocsPath = this.resolveRelativeDocsPath(docsSource.docsPath, rawTarget);
      if (!resolvedDocsPath) {
        continue;
      }
      links.add(this.docsPathToWikiPath(docsSource.prefix, resolvedDocsPath));
    }
    return [...links];
  }

  private parseWikiLinks(contentMarkdown: string, docsSource?: { prefix: string; docsPath: string }): string[] {
    const links = new Set<string>();
    for (const match of contentMarkdown.matchAll(WIKI_LINK_PATTERN)) {
      const rawPath = (match[1] ?? "").trim().toLowerCase().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!rawPath) {
        continue;
      }

      const segments = rawPath.split("/").filter(Boolean);
      if (segments.length === 0) {
        continue;
      }
      if (segments.some((segment) => !WIKI_SEGMENT_PATTERN.test(segment))) {
        continue;
      }

      links.add(segments.join("/"));
    }
    for (const docsLink of this.parseMarkdownRelativeWikiLinks(contentMarkdown, docsSource)) {
      links.add(docsLink);
    }
    return [...links];
  }

  private buildTreeNodes(
    pages: Array<{
      id: string;
      title: string;
      path: string;
      isUnpublished: boolean;
      updatedAt: Date;
      hasDraftChanges: boolean;
      draftUpdatedAt: Date | null;
      draftUpdatedBy: WikiUserSummary | null;
    }>
  ): WikiTreeNode[] {
    type MutableNode = WikiTreeNode & { children: MutableNode[] };
    const root: MutableNode = {
      type: "folder",
      name: "",
      path: "",
      children: []
    };

    const folders = new Map<string, MutableNode>();
    folders.set("", root);

    for (const page of pages) {
      const segments = page.path.split("/");
      const folderSegments = segments.slice(0, -1);
      const pageName = segments[segments.length - 1] ?? page.path;

      let parentPath = "";
      for (let index = 0; index < folderSegments.length; index += 1) {
        const segment = folderSegments[index]!;
        const currentPath = folderSegments.slice(0, index + 1).join("/");
        if (folders.has(currentPath)) {
          parentPath = currentPath;
          continue;
        }

        const folderNode: MutableNode = {
          type: "folder",
          name: segment,
          path: currentPath,
          children: []
        };
        folders.get(parentPath)?.children.push(folderNode);
        folders.set(currentPath, folderNode);
        parentPath = currentPath;
      }

      const parent = folders.get(parentPath) ?? root;
      parent.children.push({
        type: "page",
        name: pageName,
        path: page.path,
        pageId: page.id,
        title: page.title,
        isUnpublished: page.isUnpublished,
        hasDraftChanges: page.hasDraftChanges,
        draftUpdatedAt: page.draftUpdatedAt?.toISOString() ?? null,
        draftUpdatedBy: page.draftUpdatedBy,
        children: []
      });
    }

    const sortNodes = (nodes: MutableNode[]): MutableNode[] =>
      nodes
        .map((node) => ({
          ...node,
          children: sortNodes(node.children)
        }))
        .sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === "folder" ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });

    return sortNodes(root.children);
  }

  private async ensurePageReadable(pageId: string, user: AuthenticatedUser): Promise<{ id: string; projectId: string; canWrite: boolean }> {
    const page = await this.prisma.wikiPage.findFirst({
      where: {
        id: pageId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true,
        currentRevisionId: true
      }
    });

    if (!page) {
      throw new NotFoundException("Wiki page not found");
    }

    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, page.projectId);
    if (!access.canWrite && !page.currentRevisionId) {
      throw new NotFoundException("Wiki page not found");
    }

    return {
      id: page.id,
      projectId: page.projectId,
      canWrite: access.canWrite
    };
  }

  private preparePageEntry(entry: Pick<CreateWikiPageDto, "slug" | "folderPath">): { slug: string; folderPath: string; path: string } {
    const slug = this.normalizeSlug(entry.slug);
    const folderPath = this.normalizeFolderPath(entry.folderPath);
    return {
      slug,
      folderPath,
      path: this.composePath(folderPath, slug)
    };
  }

  private async getPageForMutation(pageId: string, tx?: DbClient): Promise<WikiPageWithDraftAndRevision> {
    const client = tx ?? this.prisma;
    const page = await client.wikiPage.findFirst({
      where: {
        id: pageId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        slug: true,
        folderPath: true,
        path: true,
        templateType: true,
        updatedAt: true,
        createdById: true,
        currentRevision: {
          select: {
            id: true,
            revisionNumber: true,
            contentMarkdown: true,
            createdAt: true,
            changeNote: true,
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        draft: {
          select: {
            id: true,
            title: true,
            contentMarkdown: true,
            draftVersion: true,
            updatedAt: true,
            updatedBy: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!page) {
      throw new NotFoundException("Wiki page not found");
    }

    return page;
  }

  private async ensureDraftExists(tx: DbClient, page: WikiPageWithDraftAndRevision, updatedById: string): Promise<{
    id: string;
    title: string;
    contentMarkdown: string;
    draftVersion: number;
    updatedAt: Date;
    updatedBy: WikiUserSummary;
  }> {
    if (page.draft) {
      return page.draft;
    }

    const contentMarkdown = page.currentRevision?.contentMarkdown ?? "";
    const createdDraft = await tx.wikiDraft.create({
      data: {
        pageId: page.id,
        title: page.title,
        contentMarkdown,
        draftVersion: 1,
        updatedById
      },
      select: {
        id: true,
        title: true,
        contentMarkdown: true,
        draftVersion: true,
        updatedAt: true,
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return createdDraft;
  }

  private async rebuildLinks(
    tx: DbClient,
    params: {
      projectId: string;
      fromPageId: string;
      contentMarkdown: string;
      docsSource?: { prefix: string; docsPath: string };
    }
  ): Promise<void> {
    const parsedPaths = this.parseWikiLinks(params.contentMarkdown, params.docsSource);

    await tx.wikiLink.deleteMany({
      where: {
        fromPageId: params.fromPageId
      }
    });

    if (parsedPaths.length === 0) {
      return;
    }

    const targetPages = await tx.wikiPage.findMany({
      where: {
        projectId: params.projectId,
        deletedAt: null,
        path: {
          in: parsedPaths
        }
      },
      select: {
        id: true,
        path: true
      }
    });

    const targetByPath = new Map(targetPages.map((page) => [page.path, page.id]));
    await tx.wikiLink.createMany({
      data: parsedPaths.map((toPath) => ({
        fromPageId: params.fromPageId,
        toPath,
        toPageId: targetByPath.get(toPath) ?? null
      })),
      skipDuplicates: true
    });
  }

  private async hydrateLinksToPage(tx: DbClient, params: { projectId: string; pageId: string; path: string }): Promise<void> {
    await tx.wikiLink.updateMany({
      where: {
        toPath: params.path,
        toPageId: null,
        fromPage: {
          projectId: params.projectId,
          deletedAt: null
        }
      },
      data: {
        toPageId: params.pageId
      }
    });
  }

  private buildWikiPageSummary(page: WikiPageWithDraftAndRevision): WikiPageSummary {
    return {
      id: page.id,
      projectId: page.projectId,
      title: page.title,
      slug: page.slug,
      folderPath: page.folderPath,
      path: page.path,
      templateType: page.templateType,
      updatedAt: page.updatedAt.toISOString()
    };
  }

  private buildPublishedRevision(page: WikiPageWithDraftAndRevision): WikiRevisionView | null {
    if (!page.currentRevision) {
      return null;
    }

    return {
      id: page.currentRevision.id,
      revisionNumber: page.currentRevision.revisionNumber,
      contentMarkdown: page.currentRevision.contentMarkdown,
      publishedAt: page.currentRevision.createdAt.toISOString(),
      createdBy: page.currentRevision.createdBy,
      changeNote: page.currentRevision.changeNote
    };
  }

  private async createDraftOnlyPageRecord(
    tx: DbClient,
    projectId: string,
    entry: PreparedImportEntry,
    userId: string
  ): Promise<{ id: string; title: string; path: string }> {
    const page = await tx.wikiPage.create({
      data: {
        projectId,
        title: entry.title,
        slug: entry.slug,
        folderPath: entry.folderPath,
        path: entry.path,
        templateType: entry.templateType,
        createdById: userId
      },
      select: {
        id: true,
        title: true,
        path: true
      }
    });

    await tx.wikiDraft.create({
      data: {
        pageId: page.id,
        title: entry.title,
        contentMarkdown: entry.contentMarkdown,
        draftVersion: 1,
        updatedById: userId
      }
    });

    await this.rebuildLinks(tx, {
      projectId,
      fromPageId: page.id,
      contentMarkdown: entry.contentMarkdown
    });

    await this.hydrateLinksToPage(tx, {
      projectId,
      pageId: page.id,
      path: page.path
    });

    return page;
  }

  private sanitizeSearchSnippet(rawSnippet: string | null | undefined): string {
    if (!rawSnippet) {
      return "";
    }
    return rawSnippet
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async listDocsRepositories(projectId: string): Promise<WikiDocsRepositoryRecord[]> {
    return this.prisma.projectRepository.findMany({
      where: {
        projectId
      },
      orderBy: [
        { name: "asc" },
        { pathWithNamespace: "asc" }
      ],
      select: {
        id: true,
        projectId: true,
        name: true,
        pathWithNamespace: true,
        defaultBranch: true,
        wikiDocsPrefix: true,
        wikiDocsLastSyncedAt: true,
        wikiDocsLastSyncError: true
      }
    });
  }

  private async ensureRepositoryWikiDocsPrefix(repository: WikiDocsRepositoryRecord): Promise<WikiDocsRepositoryRecord> {
    if (repository.wikiDocsPrefix) {
      return repository;
    }

    const rawBase = repository.name || repository.pathWithNamespace.split("/").pop() || "repository";
    const basePrefix = this.toWikiPathSegment(rawBase, "repository");
    const existingPrefixes = new Set(
      (
        await this.prisma.projectRepository.findMany({
          where: {
            projectId: repository.projectId,
            wikiDocsPrefix: {
              not: null
            }
          },
          select: {
            wikiDocsPrefix: true
          }
        })
      )
        .map((row) => row.wikiDocsPrefix)
        .filter((prefix): prefix is string => Boolean(prefix))
    );

    let candidate = basePrefix;
    let suffix = 2;
    while (existingPrefixes.has(candidate)) {
      candidate = `${basePrefix}-${suffix}`;
      suffix += 1;
    }

    try {
      const updated = await this.prisma.projectRepository.update({
        where: {
          id: repository.id
        },
        data: {
          wikiDocsPrefix: candidate
        },
        select: {
          id: true,
          projectId: true,
          name: true,
          pathWithNamespace: true,
          defaultBranch: true,
          wikiDocsPrefix: true,
          wikiDocsLastSyncedAt: true,
          wikiDocsLastSyncError: true
        }
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const reloaded = await this.prisma.projectRepository.findUnique({
          where: { id: repository.id },
          select: {
            id: true,
            projectId: true,
            name: true,
            pathWithNamespace: true,
            defaultBranch: true,
            wikiDocsPrefix: true,
            wikiDocsLastSyncedAt: true,
            wikiDocsLastSyncError: true
          }
        });
        if (reloaded?.wikiDocsPrefix) {
          return reloaded;
        }
      }
      throw error;
    }
  }

  private async ensureAllRepositoryWikiDocsPrefixes(projectId: string): Promise<WikiDocsRepositoryRecord[]> {
    const repositories = await this.listDocsRepositories(projectId);
    const ensured: WikiDocsRepositoryRecord[] = [];
    for (const repository of repositories) {
      ensured.push(await this.ensureRepositoryWikiDocsPrefix(repository));
    }
    return ensured;
  }

  private async findDocsBindingForPage(pageId: string): Promise<(WikiDocsBindingRecord & {
    repository: WikiDocsRepositoryRecord;
  }) | null> {
    const binding = await this.prisma.wikiDocsBinding.findUnique({
      where: {
        wikiPageId: pageId
      },
      select: {
        id: true,
        projectId: true,
        repositoryId: true,
        wikiPageId: true,
        docsPath: true,
        wikiPath: true,
        gitBlobId: true,
        gitLastCommitId: true,
        gitContentHash: true,
        wikiRevisionId: true,
        wikiContentHash: true,
        status: true,
        lastSyncedAt: true,
        repository: {
          select: {
            id: true,
            projectId: true,
            name: true,
            pathWithNamespace: true,
            defaultBranch: true,
            wikiDocsPrefix: true,
            wikiDocsLastSyncedAt: true,
            wikiDocsLastSyncError: true
          }
        },
        wikiPage: {
          select: {
            id: true,
            title: true,
            path: true,
            slug: true,
            folderPath: true,
            deletedAt: true,
            currentRevisionId: true,
            currentRevision: {
              select: {
                id: true,
                revisionNumber: true,
                contentMarkdown: true
              }
            }
          }
        }
      }
    });
    return binding as (WikiDocsBindingRecord & { repository: WikiDocsRepositoryRecord }) | null;
  }

  private buildDocsSourceView(binding: WikiDocsBindingRecord & { repository: WikiDocsRepositoryRecord }): WikiDocsSourceView | null {
    const prefix = binding.repository.wikiDocsPrefix;
    if (!prefix || binding.status !== WIKI_DOCS_BINDING_STATUS_ACTIVE) {
      return null;
    }

    return {
      repositoryId: binding.repositoryId,
      repositoryName: binding.repository.name,
      pathWithNamespace: binding.repository.pathWithNamespace,
      defaultBranch: binding.repository.defaultBranch,
      docsPath: binding.docsPath,
      docsRoot: WIKI_DOCS_ROOT,
      wikiPrefix: prefix
    };
  }

  private buildSyncRepositoryStatus(
    repository: WikiDocsRepositoryRecord,
    active: number,
    deleted: number
  ): WikiDocsSyncRepositoryStatus {
    return {
      repositoryId: repository.id,
      name: repository.name,
      pathWithNamespace: repository.pathWithNamespace,
      defaultBranch: repository.defaultBranch,
      wikiDocsPrefix: repository.wikiDocsPrefix ?? "",
      docsRoot: WIKI_DOCS_ROOT,
      lastSyncedAt: repository.wikiDocsLastSyncedAt?.toISOString() ?? null,
      lastSyncError: repository.wikiDocsLastSyncError,
      bindings: {
        active,
        deleted
      }
    };
  }

  async getDocsSyncStatus(projectId: string, user: AuthenticatedUser): Promise<WikiDocsSyncStatus> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);
    const repositories = await this.ensureAllRepositoryWikiDocsPrefixes(projectId);
    const counts = await this.prisma.wikiDocsBinding.groupBy({
      by: ["repositoryId", "status"],
      where: {
        projectId
      },
      _count: {
        _all: true
      }
    });

    const countByRepository = new Map<string, { active: number; deleted: number }>();
    for (const row of counts) {
      const current = countByRepository.get(row.repositoryId) ?? { active: 0, deleted: 0 };
      if (row.status === WIKI_DOCS_BINDING_STATUS_DELETED) {
        current.deleted += row._count._all;
      } else {
        current.active += row._count._all;
      }
      countByRepository.set(row.repositoryId, current);
    }

    return {
      repositories: repositories.map((repository) => {
        const repositoryCounts = countByRepository.get(repository.id) ?? { active: 0, deleted: 0 };
        return this.buildSyncRepositoryStatus(repository, repositoryCounts.active, repositoryCounts.deleted);
      })
    };
  }

  private buildEmptyDocsSyncRepositoryResult(repository: WikiDocsRepositoryRecord): WikiDocsSyncRepositoryResult {
    return {
      repositoryId: repository.id,
      name: repository.name,
      wikiDocsPrefix: repository.wikiDocsPrefix ?? "",
      created: 0,
      updatedFromGit: 0,
      updatedToGit: 0,
      deletedFromWiki: 0,
      deletedFromGit: 0,
      unchanged: 0,
      conflicts: [],
      errors: []
    };
  }

  private addDocsConflict(
    result: WikiDocsSyncRepositoryResult,
    params: { repositoryId: string; docsPath: string; wikiPath: string; reason: string }
  ): void {
    result.conflicts.push({
      repositoryId: params.repositoryId,
      docsPath: params.docsPath,
      wikiPath: params.wikiPath,
      reason: params.reason
    });
  }

  private isBindingWikiChanged(binding: WikiDocsBindingRecord): boolean {
    const currentRevision = binding.wikiPage?.currentRevision;
    if (!currentRevision) {
      return false;
    }
    return (
      binding.wikiRevisionId !== currentRevision.id ||
      binding.wikiContentHash !== this.hashMarkdownContent(currentRevision.contentMarkdown)
    );
  }

  private async loadDocsBindings(repositoryId: string): Promise<WikiDocsBindingRecord[]> {
    const bindings = await this.prisma.wikiDocsBinding.findMany({
      where: {
        repositoryId
      },
      orderBy: {
        docsPath: "asc"
      },
      select: {
        id: true,
        projectId: true,
        repositoryId: true,
        wikiPageId: true,
        docsPath: true,
        wikiPath: true,
        gitBlobId: true,
        gitLastCommitId: true,
        gitContentHash: true,
        wikiRevisionId: true,
        wikiContentHash: true,
        status: true,
        lastSyncedAt: true,
        wikiPage: {
          select: {
            id: true,
            title: true,
            path: true,
            slug: true,
            folderPath: true,
            deletedAt: true,
            currentRevisionId: true,
            currentRevision: {
              select: {
                id: true,
                revisionNumber: true,
                contentMarkdown: true
              }
            }
          }
        }
      }
    });
    return bindings as WikiDocsBindingRecord[];
  }

  private async createPublishedPageFromDocs(params: {
    projectId: string;
    repository: WikiDocsRepositoryRecord;
    file: RepositoryDocsMarkdownFile;
    prepared: PreparedDocsPage;
    user: AuthenticatedUser;
  }): Promise<void> {
    const { projectId, repository, file, prepared, user } = params;
    const existingPage = await this.prisma.wikiPage.findFirst({
      where: {
        projectId,
        path: prepared.wikiPath,
        deletedAt: null
      },
      select: {
        id: true
      }
    });
    if (existingPage) {
      throw new ConflictException(`Wiki path already exists: ${prepared.wikiPath}`);
    }

    await this.prisma.$transaction(async (tx) => {
      const page = await tx.wikiPage.create({
        data: {
          projectId,
          title: prepared.title,
          slug: prepared.slug,
          folderPath: prepared.folderPath,
          path: prepared.wikiPath,
          templateType: "docs",
          createdById: user.userId
        },
        select: {
          id: true,
          path: true
        }
      });

      const revision = await tx.wikiRevision.create({
        data: {
          pageId: page.id,
          revisionNumber: 1,
          contentMarkdown: prepared.contentMarkdown,
          changeNote: `Imported from ${file.docsPath}`,
          createdById: user.userId
        },
        select: {
          id: true
        }
      });

      await tx.wikiPage.update({
        where: { id: page.id },
        data: {
          currentRevisionId: revision.id
        }
      });

      await tx.wikiDraft.create({
        data: {
          pageId: page.id,
          title: prepared.title,
          contentMarkdown: prepared.contentMarkdown,
          draftVersion: 1,
          updatedById: user.userId
        }
      });

      await tx.wikiDocsBinding.create({
        data: {
          projectId,
          repositoryId: repository.id,
          wikiPageId: page.id,
          docsPath: file.docsPath,
          wikiPath: page.path,
          gitBlobId: file.blobId,
          gitLastCommitId: file.lastCommitId,
          gitContentHash: prepared.contentHash,
          wikiRevisionId: revision.id,
          wikiContentHash: prepared.contentHash,
          status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
          lastSyncedAt: new Date()
        }
      });

      await this.rebuildLinks(tx, {
        projectId,
        fromPageId: page.id,
        contentMarkdown: prepared.contentMarkdown,
        docsSource: {
          prefix: repository.wikiDocsPrefix ?? "",
          docsPath: file.docsPath
        }
      });

      await this.hydrateLinksToPage(tx, {
        projectId,
        pageId: page.id,
        path: page.path
      });
    });
  }

  private async updatePublishedPageFromDocs(params: {
    projectId: string;
    repository: WikiDocsRepositoryRecord;
    binding: WikiDocsBindingRecord;
    file: RepositoryDocsMarkdownFile;
    prepared: PreparedDocsPage;
    user: AuthenticatedUser;
  }): Promise<void> {
    const { projectId, repository, binding, file, prepared, user } = params;
    if (!binding.wikiPage) {
      throw new ConflictException(`Docs binding has no wiki page: ${binding.docsPath}`);
    }
    const wikiPage = binding.wikiPage;

    await this.prisma.$transaction(async (tx) => {
      const lastRevision = await tx.wikiRevision.findFirst({
        where: { pageId: wikiPage.id },
        orderBy: { revisionNumber: "desc" },
        select: { revisionNumber: true }
      });

      const revision = await tx.wikiRevision.create({
        data: {
          pageId: wikiPage.id,
          revisionNumber: (lastRevision?.revisionNumber ?? 0) + 1,
          contentMarkdown: prepared.contentMarkdown,
          changeNote: `Synced from ${file.docsPath}`,
          createdById: user.userId
        },
        select: {
          id: true
        }
      });

      await tx.wikiPage.update({
        where: { id: wikiPage.id },
        data: {
          title: prepared.title,
          slug: prepared.slug,
          folderPath: prepared.folderPath,
          path: prepared.wikiPath,
          currentRevisionId: revision.id,
          deletedAt: null
        }
      });

      await tx.wikiDraft.upsert({
        where: {
          pageId: wikiPage.id
        },
        create: {
          pageId: wikiPage.id,
          title: prepared.title,
          contentMarkdown: prepared.contentMarkdown,
          draftVersion: 1,
          updatedById: user.userId
        },
        update: {
          title: prepared.title,
          contentMarkdown: prepared.contentMarkdown,
          draftVersion: {
            increment: 1
          },
          updatedById: user.userId
        }
      });

      await tx.wikiDocsBinding.update({
        where: { id: binding.id },
        data: {
          wikiPageId: wikiPage.id,
          docsPath: file.docsPath,
          wikiPath: prepared.wikiPath,
          gitBlobId: file.blobId,
          gitLastCommitId: file.lastCommitId,
          gitContentHash: prepared.contentHash,
          wikiRevisionId: revision.id,
          wikiContentHash: prepared.contentHash,
          status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
          lastSyncedAt: new Date()
        }
      });

      await this.rebuildLinks(tx, {
        projectId,
        fromPageId: wikiPage.id,
        contentMarkdown: prepared.contentMarkdown,
        docsSource: {
          prefix: repository.wikiDocsPrefix ?? "",
          docsPath: file.docsPath
        }
      });

      await this.hydrateLinksToPage(tx, {
        projectId,
        pageId: wikiPage.id,
        path: prepared.wikiPath
      });
    });
  }

  private async softDeleteDocsBoundPageFromGit(params: {
    binding: WikiDocsBindingRecord;
    user: AuthenticatedUser;
  }): Promise<void> {
    const { binding } = params;
    if (!binding.wikiPageId) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.wikiLink.deleteMany({
        where: {
          fromPageId: binding.wikiPageId ?? ""
        }
      });

      await tx.wikiLink.updateMany({
        where: {
          toPageId: binding.wikiPageId ?? ""
        },
        data: {
          toPageId: null
        }
      });

      await tx.wikiPage.update({
        where: {
          id: binding.wikiPageId ?? ""
        },
        data: {
          deletedAt: new Date()
        }
      });

      await tx.wikiDocsBinding.update({
        where: { id: binding.id },
        data: {
          status: WIKI_DOCS_BINDING_STATUS_DELETED,
          gitBlobId: null,
          gitLastCommitId: null,
          gitContentHash: null,
          lastSyncedAt: new Date()
        }
      });
    });
  }

  private async updateBindingAfterWikiExport(params: {
    binding: WikiDocsBindingRecord;
    file: RepositoryDocsMarkdownFile | null;
    commitId: string | null;
    contentMarkdown: string | null;
    status: string;
  }): Promise<void> {
    const contentHash = params.contentMarkdown === null ? null : this.hashMarkdownContent(params.contentMarkdown);
    await this.prisma.wikiDocsBinding.update({
      where: { id: params.binding.id },
      data: {
        gitBlobId: params.file?.blobId ?? null,
        gitLastCommitId: params.commitId ?? params.file?.lastCommitId ?? null,
        gitContentHash: contentHash,
        wikiRevisionId: params.binding.wikiPage?.currentRevision?.id ?? params.binding.wikiRevisionId,
        wikiContentHash: contentHash,
        status: params.status,
        lastSyncedAt: new Date()
      }
    });
  }

  private async exportDocsBindingBeforePublish(
    page: WikiPageWithDraftAndRevision,
    draft: { contentMarkdown: string },
    user: AuthenticatedUser
  ): Promise<{
    binding: WikiDocsBindingRecord & { repository: WikiDocsRepositoryRecord };
    remoteFile: RepositoryDocsMarkdownFile;
    commitId: string | null;
    contentHash: string;
  } | null> {
    const binding = await this.findDocsBindingForPage(page.id);
    if (!binding || binding.status !== WIKI_DOCS_BINDING_STATUS_ACTIVE) {
      return null;
    }

    const remoteFile = await this.gitlabService.getRepositoryTextFileForDocsSync(
      page.projectId,
      user,
      binding.repositoryId,
      binding.docsPath
    );
    if (!remoteFile) {
      throw new ConflictException("Docs file was deleted in GitLab; run Docs sync before publishing.");
    }

    const remoteHash = this.hashMarkdownContent(remoteFile.content);
    if (binding.gitContentHash !== remoteHash) {
      throw new ConflictException("Docs file changed in GitLab; run Docs sync before publishing.");
    }

    const contentHash = this.hashMarkdownContent(draft.contentMarkdown);
    if (contentHash === remoteHash) {
      return {
        binding,
        remoteFile,
        commitId: null,
        contentHash
      };
    }

    const commit = await this.gitlabService.commitRepositoryFileActions(
      page.projectId,
      user,
      binding.repositoryId,
      [
        {
          action: "update",
          filePath: binding.docsPath,
          content: draft.contentMarkdown,
          lastCommitId: remoteFile.lastCommitId
        }
      ],
      `Update wiki docs file ${binding.docsPath}`
    );

    return {
      binding,
      remoteFile,
      commitId: commit.id,
      contentHash
    };
  }

  private async exportDocsBindingBeforeDelete(
    page: WikiPageWithDraftAndRevision,
    user: AuthenticatedUser
  ): Promise<{
    binding: WikiDocsBindingRecord & { repository: WikiDocsRepositoryRecord };
    commitId: string;
  } | null> {
    const binding = await this.findDocsBindingForPage(page.id);
    if (!binding || binding.status !== WIKI_DOCS_BINDING_STATUS_ACTIVE) {
      return null;
    }

    const remoteFile = await this.gitlabService.getRepositoryTextFileForDocsSync(
      page.projectId,
      user,
      binding.repositoryId,
      binding.docsPath
    );
    if (!remoteFile) {
      throw new ConflictException("Docs file was deleted in GitLab; run Docs sync before deleting this page.");
    }

    const remoteHash = this.hashMarkdownContent(remoteFile.content);
    if (binding.gitContentHash !== remoteHash) {
      throw new ConflictException("Docs file changed in GitLab; run Docs sync before deleting this page.");
    }

    const commit = await this.gitlabService.commitRepositoryFileActions(
      page.projectId,
      user,
      binding.repositoryId,
      [
        {
          action: "delete",
          filePath: binding.docsPath,
          lastCommitId: remoteFile.lastCommitId
        }
      ],
      `Delete wiki docs file ${binding.docsPath}`
    );

    return {
      binding,
      commitId: commit.id
    };
  }

  private async ensureDocsWikiPathAvailable(
    projectId: string,
    wikiPath: string,
    allowedPageId?: string | null,
    allowedBindingId?: string | null
  ): Promise<boolean> {
    const existingPage = await this.prisma.wikiPage.findFirst({
      where: {
        projectId,
        path: wikiPath,
        deletedAt: null,
        ...(allowedPageId ? { id: { not: allowedPageId } } : {})
      },
      select: {
        id: true
      }
    });
    if (existingPage) {
      return false;
    }

    const existingBinding = await this.prisma.wikiDocsBinding.findFirst({
      where: {
        projectId,
        wikiPath,
        ...(allowedBindingId ? { id: { not: allowedBindingId } } : {})
      },
      select: {
        id: true
      }
    });
    return !existingBinding;
  }

  private async reconcileExistingDocsBinding(params: {
    projectId: string;
    repository: WikiDocsRepositoryRecord;
    binding: WikiDocsBindingRecord;
    file: RepositoryDocsMarkdownFile;
    user: AuthenticatedUser;
    result: WikiDocsSyncRepositoryResult;
  }): Promise<void> {
    const { projectId, repository, binding, file, user, result } = params;
    const prefix = repository.wikiDocsPrefix;
    if (!prefix) {
      throw new BadRequestException("Repository Docs prefix is missing");
    }

    const prepared = this.buildPreparedDocsPage(prefix, file);
    const remoteHash = prepared.contentHash;
    const remoteChanged = binding.gitContentHash !== remoteHash;
    const wikiChanged = this.isBindingWikiChanged(binding);
    const wikiPage = binding.wikiPage;

    if (!wikiPage) {
      this.addDocsConflict(result, {
        repositoryId: repository.id,
        docsPath: file.docsPath,
        wikiPath: prepared.wikiPath,
        reason: "Docs binding no longer points to a wiki page"
      });
      return;
    }

    if (!(await this.ensureDocsWikiPathAvailable(projectId, prepared.wikiPath, wikiPage.id, binding.id))) {
      this.addDocsConflict(result, {
        repositoryId: repository.id,
        docsPath: file.docsPath,
        wikiPath: prepared.wikiPath,
        reason: "Wiki path is already used by another page or Docs binding"
      });
      return;
    }

    if (wikiPage.deletedAt) {
      if (binding.status === WIKI_DOCS_BINDING_STATUS_DELETED) {
        await this.updatePublishedPageFromDocs({ projectId, repository, binding, file, prepared, user });
        result.updatedFromGit += 1;
        return;
      }

      if (remoteChanged) {
        this.addDocsConflict(result, {
          repositoryId: repository.id,
          docsPath: file.docsPath,
          wikiPath: prepared.wikiPath,
          reason: "Wiki page was deleted while Docs changed"
        });
        return;
      }

      const commit = await this.gitlabService.commitRepositoryFileActions(
        projectId,
        user,
        repository.id,
        [
          {
            action: "delete",
            filePath: file.docsPath,
            lastCommitId: file.lastCommitId
          }
        ],
        `Delete wiki docs file ${file.docsPath}`
      );
      await this.updateBindingAfterWikiExport({
        binding,
        file: null,
        commitId: commit.id,
        contentMarkdown: null,
        status: WIKI_DOCS_BINDING_STATUS_DELETED
      });
      result.deletedFromGit += 1;
      return;
    }

    if (remoteChanged && wikiChanged) {
      this.addDocsConflict(result, {
        repositoryId: repository.id,
        docsPath: file.docsPath,
        wikiPath: prepared.wikiPath,
        reason: "Wiki and Docs both changed since the last sync"
      });
      return;
    }

    if (remoteChanged || binding.status === WIKI_DOCS_BINDING_STATUS_DELETED) {
      await this.updatePublishedPageFromDocs({ projectId, repository, binding, file, prepared, user });
      result.updatedFromGit += 1;
      return;
    }

    if (wikiChanged) {
      const contentMarkdown = wikiPage.currentRevision?.contentMarkdown ?? "";
      const commit = await this.gitlabService.commitRepositoryFileActions(
        projectId,
        user,
        repository.id,
        [
          {
            action: "update",
            filePath: file.docsPath,
            content: contentMarkdown,
            lastCommitId: file.lastCommitId
          }
        ],
        `Update wiki docs file ${file.docsPath}`
      );
      await this.updateBindingAfterWikiExport({
        binding,
        file,
        commitId: commit.id,
        contentMarkdown,
        status: WIKI_DOCS_BINDING_STATUS_ACTIVE
      });
      result.updatedToGit += 1;
      return;
    }

    result.unchanged += 1;
  }

  private async reconcileMissingDocsFile(params: {
    repository: WikiDocsRepositoryRecord;
    binding: WikiDocsBindingRecord;
    user: AuthenticatedUser;
    result: WikiDocsSyncRepositoryResult;
  }): Promise<void> {
    const { repository, binding, result } = params;
    if (binding.status === WIKI_DOCS_BINDING_STATUS_DELETED) {
      result.unchanged += 1;
      return;
    }

    if (!binding.wikiPage || binding.wikiPage.deletedAt) {
      await this.updateBindingAfterWikiExport({
        binding,
        file: null,
        commitId: null,
        contentMarkdown: null,
        status: WIKI_DOCS_BINDING_STATUS_DELETED
      });
      result.unchanged += 1;
      return;
    }

    if (this.isBindingWikiChanged(binding)) {
      this.addDocsConflict(result, {
        repositoryId: repository.id,
        docsPath: binding.docsPath,
        wikiPath: binding.wikiPath,
        reason: "Docs file was deleted while Wiki changed"
      });
      return;
    }

    await this.softDeleteDocsBoundPageFromGit({
      binding,
      user: params.user
    });
    result.deletedFromWiki += 1;
  }

  async syncDocs(projectId: string, user: AuthenticatedUser): Promise<WikiDocsSyncResult> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);
    const repositories = await this.ensureAllRepositoryWikiDocsPrefixes(projectId);
    const repositoryResults: WikiDocsSyncRepositoryResult[] = [];

    for (const repository of repositories) {
      const result = this.buildEmptyDocsSyncRepositoryResult(repository);
      repositoryResults.push(result);

      try {
        const files = await this.gitlabService.listRepositoryDocsMarkdownFiles(projectId, user, repository.id);
        const filesByPath = new Map(files.map((file) => [file.docsPath, file]));
        const seenDocsPaths = new Set<string>();
        const bindings = await this.loadDocsBindings(repository.id);
        const bindingsByPath = new Map(bindings.map((binding) => [binding.docsPath, binding]));
        const prefix = repository.wikiDocsPrefix;
        if (!prefix) {
          throw new BadRequestException("Repository Docs prefix is missing");
        }

        for (const file of files) {
          seenDocsPaths.add(file.docsPath);
          const prepared = this.buildPreparedDocsPage(prefix, file);
          const binding = bindingsByPath.get(file.docsPath);

          if (!binding) {
            if (!(await this.ensureDocsWikiPathAvailable(projectId, prepared.wikiPath))) {
              this.addDocsConflict(result, {
                repositoryId: repository.id,
                docsPath: file.docsPath,
                wikiPath: prepared.wikiPath,
                reason: "Wiki path is already used by another page or Docs binding"
              });
              continue;
            }

            await this.createPublishedPageFromDocs({ projectId, repository, file, prepared, user });
            result.created += 1;
            continue;
          }

          await this.reconcileExistingDocsBinding({ projectId, repository, binding, file, user, result });
        }

        for (const binding of bindings) {
          if (seenDocsPaths.has(binding.docsPath) || filesByPath.has(binding.docsPath)) {
            continue;
          }
          await this.reconcileMissingDocsFile({ repository, binding, user, result });
        }

        const lastSyncError =
          result.errors.length > 0
            ? result.errors.join("; ")
            : result.conflicts.length > 0
              ? `${result.conflicts.length} Docs sync conflict(s)`
              : null;
        await this.prisma.projectRepository.update({
          where: { id: repository.id },
          data: {
            wikiDocsLastSyncedAt: new Date(),
            wikiDocsLastSyncError: lastSyncError
          }
        });
      } catch (error) {
        const message = (error as Error).message || "Docs sync failed";
        result.errors.push(message);
        await this.prisma.projectRepository.update({
          where: { id: repository.id },
          data: {
            wikiDocsLastSyncError: message
          }
        });
      }
    }

    const totals = repositoryResults.reduce(
      (accumulator, result) => ({
        created: accumulator.created + result.created,
        updatedFromGit: accumulator.updatedFromGit + result.updatedFromGit,
        updatedToGit: accumulator.updatedToGit + result.updatedToGit,
        deletedFromWiki: accumulator.deletedFromWiki + result.deletedFromWiki,
        deletedFromGit: accumulator.deletedFromGit + result.deletedFromGit,
        unchanged: accumulator.unchanged + result.unchanged,
        conflicts: accumulator.conflicts + result.conflicts.length,
        errors: accumulator.errors + result.errors.length
      }),
      {
        created: 0,
        updatedFromGit: 0,
        updatedToGit: 0,
        deletedFromWiki: 0,
        deletedFromGit: 0,
        unchanged: 0,
        conflicts: 0,
        errors: 0
      }
    );

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "wiki_docs_sync",
      entityId: projectId,
      action: "wiki.docs.sync",
      metadata: totals
    });

    return {
      repositories: repositoryResults,
      totals
    };
  }

  async createPage(projectId: string, dto: CreateWikiPageDto, user: AuthenticatedUser): Promise<{
    id: string;
    projectId: string;
    slug: string;
    title: string;
    path: string;
    revisionNumber: number;
  }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    let docsRepository: WikiDocsRepositoryRecord | null = null;
    let docsPath: string | null = null;
    let docsContentHash: string | null = null;
    let docsCommitId: string | null = null;

    const prepared = this.preparePageEntry(dto);
    let slug = prepared.slug;
    let folderPath = prepared.folderPath;
    let pagePath = prepared.path;

    if (dto.docsRepositoryId?.trim()) {
      const repository = await this.prisma.projectRepository.findFirst({
        where: {
          id: dto.docsRepositoryId.trim(),
          projectId
        },
        select: {
          id: true,
          projectId: true,
          name: true,
          pathWithNamespace: true,
          defaultBranch: true,
          wikiDocsPrefix: true,
          wikiDocsLastSyncedAt: true,
          wikiDocsLastSyncError: true
        }
      });
      if (!repository) {
        throw new NotFoundException("Project repository not found");
      }

      docsRepository = await this.ensureRepositoryWikiDocsPrefix(repository);
      const prefix = docsRepository.wikiDocsPrefix;
      if (!prefix) {
        throw new BadRequestException("Repository Docs prefix could not be assigned");
      }

      const relativeFolderPath = this.normalizeFolderPath(dto.folderPath);
      folderPath = relativeFolderPath ? `${prefix}/${relativeFolderPath}` : prefix;
      slug = this.normalizeSlug(dto.slug);
      pagePath = this.composePath(folderPath, slug);
      docsPath = this.wikiPathToDocsPath(prefix, pagePath);
      docsContentHash = this.hashMarkdownContent(dto.contentMarkdown);
    }

    const existingPath = await this.prisma.wikiPage.findFirst({
      where: {
        projectId,
        path: pagePath,
        deletedAt: null
      },
      select: { id: true }
    });

    if (existingPath) {
      throw new BadRequestException("Wiki path already exists in this project");
    }

    if (docsRepository && docsPath) {
      const existingBinding = await this.prisma.wikiDocsBinding.findFirst({
        where: {
          repositoryId: docsRepository.id,
          docsPath
        },
        select: {
          id: true
        }
      });
      if (existingBinding) {
        throw new BadRequestException("Docs file is already bound to a wiki page");
      }

      const docsCommit = await this.gitlabService.commitRepositoryFileActions(
        projectId,
        user,
        docsRepository.id,
        [
          {
            action: "create",
            filePath: docsPath,
            content: dto.contentMarkdown
          }
        ],
        `Create wiki page ${pagePath}`
      );
      docsCommitId = docsCommit.id;
    }

    let created: {
      id: string;
      projectId: string;
      slug: string;
      title: string;
      path: string;
      revisionNumber: number;
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const page = await tx.wikiPage.create({
          data: {
            projectId,
            title: dto.title,
            slug,
            folderPath,
            path: pagePath,
            templateType: dto.templateType,
            createdById: user.userId
          },
          select: { id: true, projectId: true, slug: true, title: true, path: true }
        });

        const revision = await tx.wikiRevision.create({
          data: {
            pageId: page.id,
            revisionNumber: 1,
            contentMarkdown: dto.contentMarkdown,
            createdById: user.userId
          },
          select: { id: true, revisionNumber: true }
        });

        await tx.wikiPage.update({
          where: { id: page.id },
          data: {
            currentRevisionId: revision.id
          }
        });

        await tx.wikiDraft.create({
          data: {
            pageId: page.id,
            title: dto.title,
            contentMarkdown: dto.contentMarkdown,
            draftVersion: 1,
            updatedById: user.userId
          }
        });

        await this.rebuildLinks(tx, {
          projectId,
          fromPageId: page.id,
          contentMarkdown: dto.contentMarkdown,
          docsSource: docsRepository?.wikiDocsPrefix && docsPath
            ? { prefix: docsRepository.wikiDocsPrefix, docsPath }
            : undefined
        });

        await this.hydrateLinksToPage(tx, {
          projectId,
          pageId: page.id,
          path: page.path
        });

        if (docsRepository && docsPath && docsContentHash) {
          await tx.wikiDocsBinding.create({
            data: {
              projectId,
              repositoryId: docsRepository.id,
              wikiPageId: page.id,
              docsPath,
              wikiPath: page.path,
              gitLastCommitId: docsCommitId,
              gitContentHash: docsContentHash,
              wikiRevisionId: revision.id,
              wikiContentHash: docsContentHash,
              status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
              lastSyncedAt: new Date()
            }
          });

          await tx.projectRepository.update({
            where: {
              id: docsRepository.id
            },
            data: {
              wikiDocsLastSyncedAt: new Date(),
              wikiDocsLastSyncError: null
            }
          });
        }

        return {
          ...page,
          revisionNumber: revision.revisionNumber
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Wiki path already exists in this project");
      }
      throw error;
    }

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "wiki_page",
      entityId: created.id,
      action: "wiki.page.create",
      metadata: {
        path: created.path
      }
    });

    return created;
  }

  async importPages(
    projectId: string,
    dto: ImportWikiPagesDto,
    user: AuthenticatedUser
  ): Promise<{
    created: Array<{ id: string; title: string; path: string; sourcePath: string }>;
    skipped: Array<{ title: string; path: string; sourcePath: string; reason: "path_exists" }>;
  }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    const entries = dto.entries.map((entry) => {
      const prepared = this.preparePageEntry(entry);
      return {
        ...entry,
        ...prepared
      } satisfies PreparedImportEntry;
    });

    const created: Array<{ id: string; title: string; path: string; sourcePath: string }> = [];
    const skipped: Array<{ title: string; path: string; sourcePath: string; reason: "path_exists" }> = [];

    const existingPaths = new Set(
      (
        await this.prisma.wikiPage.findMany({
          where: {
            projectId,
            deletedAt: null,
            path: {
              in: entries.map((entry) => entry.path)
            }
          },
          select: {
            path: true
          }
        })
      ).map((page) => page.path)
    );

    for (const entry of entries) {
      if (existingPaths.has(entry.path)) {
        skipped.push({
          title: entry.title,
          path: entry.path,
          sourcePath: entry.sourcePath,
          reason: "path_exists"
        });
        continue;
      }

      try {
        const page = await this.prisma.$transaction((tx) => this.createDraftOnlyPageRecord(tx, projectId, entry, user.userId));
        existingPaths.add(entry.path);
        created.push({
          id: page.id,
          title: page.title,
          path: page.path,
          sourcePath: entry.sourcePath
        });

        await this.auditService.log({
          userId: user.userId,
          projectId,
          entityType: "wiki_page",
          entityId: page.id,
          action: "wiki.page.import",
          metadata: {
            path: page.path,
            sourcePath: entry.sourcePath
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          existingPaths.add(entry.path);
          skipped.push({
            title: entry.title,
            path: entry.path,
            sourcePath: entry.sourcePath,
            reason: "path_exists"
          });
          continue;
        }
        throw error;
      }
    }

    return {
      created,
      skipped
    };
  }

  async listTree(projectId: string, user: AuthenticatedUser): Promise<WikiTreeNode[]> {
    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);
    const canReadDraft = access.canWrite;

    const pages = await this.prisma.wikiPage.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(canReadDraft ? {} : { currentRevisionId: { not: null } })
      },
      orderBy: {
        path: "asc"
      },
      select: {
        id: true,
        title: true,
        path: true,
        updatedAt: true,
        currentRevision: {
          select: {
            contentMarkdown: true
          }
        },
        draft: {
          select: {
            title: true,
            contentMarkdown: true,
            updatedAt: true,
            updatedBy: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    return this.buildTreeNodes(
      pages.map((page) => {
        const isUnpublished = !page.currentRevision;
        const hasDraftChanges =
          canReadDraft &&
          !isUnpublished &&
          Boolean(
            page.draft &&
              (page.draft.title !== page.title || page.draft.contentMarkdown !== (page.currentRevision?.contentMarkdown ?? ""))
          );

        return {
          id: page.id,
          title: page.title,
          path: page.path,
          isUnpublished,
          updatedAt: page.updatedAt,
          hasDraftChanges,
          draftUpdatedAt: canReadDraft ? page.draft?.updatedAt ?? null : null,
          draftUpdatedBy: canReadDraft ? page.draft?.updatedBy ?? null : null
        };
      })
    );
  }

  async getByPath(projectId: string, path: string, user: AuthenticatedUser): Promise<WikiPageDetail> {
    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);
    const normalizedPath = this.normalizePath(path);

    const page = await this.prisma.wikiPage.findFirst({
      where: {
        projectId,
        path: normalizedPath,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        slug: true,
        folderPath: true,
        path: true,
        templateType: true,
        updatedAt: true,
        createdById: true,
        currentRevision: {
          select: {
            id: true,
            revisionNumber: true,
            contentMarkdown: true,
            createdAt: true,
            changeNote: true,
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        draft: {
          select: {
            id: true,
            title: true,
            contentMarkdown: true,
            draftVersion: true,
            updatedAt: true,
            updatedBy: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!page) {
      throw new NotFoundException("Wiki page not found");
    }
    if (!access.canWrite && !page.currentRevision) {
      throw new NotFoundException("Wiki page not found");
    }

    const outgoingLinksRaw = await this.prisma.wikiLink.findMany({
      where: {
        fromPageId: page.id
      },
      orderBy: {
        toPath: "asc"
      },
      select: {
        toPath: true,
        toPageId: true,
        toPage: {
          select: {
            title: true,
            path: true,
            currentRevisionId: true
          }
        }
      }
    });

    const canReadDraft = access.canWrite;
    const backlinksRaw = await this.prisma.wikiLink.findMany({
      where: {
        OR: [{ toPageId: page.id }, { toPath: page.path }],
        fromPage: {
          deletedAt: null,
          ...(canReadDraft ? {} : { currentRevisionId: { not: null } })
        }
      },
      select: {
        fromPageId: true,
        fromPage: {
          select: {
            title: true,
            path: true,
            currentRevisionId: true
          }
        }
      }
    });

    const backlinkMap = new Map<string, WikiBacklinkView>();
    for (const backlink of backlinksRaw) {
      if (!backlink.fromPage) {
        continue;
      }

      backlinkMap.set(backlink.fromPageId, {
        fromPageId: backlink.fromPageId,
        fromTitle: backlink.fromPage.title,
        fromPath: backlink.fromPage.path
      });
    }

    const outgoingLinks: WikiLinkView[] = outgoingLinksRaw
      .filter((link) => canReadDraft || !link.toPageId || Boolean(link.toPage?.currentRevisionId))
      .map((link) => ({
        toPath: link.toPath,
        toPageId: link.toPageId,
        title: link.toPage?.title ?? null,
        path: link.toPage?.path ?? null
      }));

    const draft: WikiDraftView | undefined =
      canReadDraft && page.draft
        ? {
            title: page.draft.title,
            contentMarkdown: page.draft.contentMarkdown,
            draftVersion: page.draft.draftVersion,
            updatedAt: page.draft.updatedAt.toISOString(),
            updatedBy: page.draft.updatedBy
          }
        : undefined;
    const docsBinding = await this.findDocsBindingForPage(page.id);

    return {
      page: this.buildWikiPageSummary(page),
      published: this.buildPublishedRevision(page),
      draft,
      outgoingLinks,
      backlinks: [...backlinkMap.values()].sort((left, right) => left.fromPath.localeCompare(right.fromPath)),
      docsSource: docsBinding ? this.buildDocsSourceView(docsBinding) : null
    };
  }

  async searchPages(projectId: string, query: SearchWikiPagesQueryDto, user: AuthenticatedUser): Promise<WikiSearchResult[]> {
    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);

    const searchText = query.q.trim();
    if (searchText.length < 2) {
      throw new BadRequestException("Search query must be at least 2 characters");
    }

    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const includeDraft = access.canWrite;
    const visibilityCondition = includeDraft ? Prisma.sql`TRUE` : Prisma.sql`p."currentRevisionId" IS NOT NULL`;

    const draftVectorPart = includeDraft
      ? Prisma.sql`COALESCE(d."contentMarkdown", '')`
      : Prisma.sql`''`;
    const draftMatchCondition = includeDraft
      ? Prisma.sql`to_tsvector('simple', COALESCE(d."contentMarkdown", '')) @@ query`
      : Prisma.sql`FALSE`;
    const pageMatchCondition = Prisma.sql`(
      to_tsvector('simple', COALESCE(p.title, '')) @@ query OR
      to_tsvector('simple', COALESCE(p.path, '')) @@ query
    )`;
    const publishedMatchCondition = Prisma.sql`to_tsvector('simple', COALESCE(pr."contentMarkdown", '')) @@ query`;

    const rows = await this.prisma.$queryRaw<WikiSearchRow[]>(Prisma.sql`
      SELECT
        p.id AS "pageId",
        p.path AS "path",
        p.title AS "title",
        p."updatedAt" AS "updatedAt",
        ts_rank_cd(search_data.search_vector, query) AS "score",
        ts_headline(
          'simple',
          CASE
            WHEN to_tsvector('simple', COALESCE(p.title, '')) @@ query THEN COALESCE(p.title, '')
            WHEN to_tsvector('simple', COALESCE(p.path, '')) @@ query THEN COALESCE(p.path, '')
            WHEN ${draftMatchCondition} THEN COALESCE(d."contentMarkdown", '')
            ELSE COALESCE(pr."contentMarkdown", '')
          END,
          query,
          'MaxFragments=2, MinWords=5, MaxWords=20, FragmentDelimiter= ... '
        ) AS "snippet",
        to_tsvector('simple', COALESCE(p.title, '')) @@ query AS "matchTitle",
        to_tsvector('simple', COALESCE(p.path, '')) @@ query AS "matchPath",
        to_tsvector('simple', COALESCE(pr."contentMarkdown", '')) @@ query AS "matchPublished",
        ${draftMatchCondition} AS "matchDraft"
      FROM "WikiPage" p
      LEFT JOIN "WikiRevision" pr ON pr.id = p."currentRevisionId"
      LEFT JOIN "WikiDraft" d ON d."pageId" = p.id
      CROSS JOIN websearch_to_tsquery('simple', ${searchText}) AS query
      CROSS JOIN LATERAL (
        SELECT to_tsvector(
          'simple',
          COALESCE(p.title, '') || ' ' ||
          COALESCE(p.path, '') || ' ' ||
          COALESCE(pr."contentMarkdown", '') || ' ' ||
          ${draftVectorPart}
        ) AS search_vector
      ) AS search_data
      WHERE p."projectId" = ${projectId}
        AND p."deletedAt" IS NULL
        AND ${visibilityCondition}
        AND (${pageMatchCondition} OR ${publishedMatchCondition} OR ${draftMatchCondition})
      ORDER BY "score" DESC, p."updatedAt" DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => {
      const snippet = this.sanitizeSearchSnippet(row.snippet);
      return {
        pageId: row.pageId,
        path: row.path,
        title: row.title,
        snippet: snippet || `${row.title} (${row.path})`,
        score: Number(row.score),
        matches: {
          title: row.matchTitle,
          path: row.matchPath,
          published: row.matchPublished,
          draft: includeDraft ? row.matchDraft : false
        },
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  async saveDraft(pageId: string, dto: SaveWikiDraftDto, user: AuthenticatedUser): Promise<{
    draftVersion: number;
    updatedAt: string;
    updatedBy: WikiUserSummary;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const page = await this.getPageForMutation(pageId, tx);
      await this.accessService.ensureProjectWritable(user.userId, user.globalRole, page.projectId);
      const draft = await this.ensureDraftExists(tx, page, user.userId);

      if (dto.baseDraftVersion !== draft.draftVersion) {
        throw new ConflictException({
          message: "Draft version conflict",
          currentDraft: {
            title: draft.title,
            contentMarkdown: draft.contentMarkdown,
            draftVersion: draft.draftVersion,
            updatedAt: draft.updatedAt.toISOString(),
            updatedBy: draft.updatedBy
          }
        });
      }

      const updated = await tx.wikiDraft.update({
        where: {
          pageId
        },
        data: {
          title: dto.title,
          contentMarkdown: dto.contentMarkdown,
          draftVersion: {
            increment: 1
          },
          updatedById: user.userId
        },
        select: {
          draftVersion: true,
          updatedAt: true,
          updatedBy: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      return {
        page,
        updated
      };
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: result.page.projectId,
      entityType: "wiki_page",
      entityId: pageId,
      action: "wiki.page.draft.save",
      metadata: {
        draftVersion: result.updated.draftVersion
      }
    });

    return {
      draftVersion: result.updated.draftVersion,
      updatedAt: result.updated.updatedAt.toISOString(),
      updatedBy: result.updated.updatedBy
    };
  }

  async flushRealtimeDraft(pageId: string, user: AuthenticatedUser): Promise<{
    draftVersion: number;
    updatedAt: string;
    updatedBy: WikiUserSummary;
  }> {
    const collabServer = getDocumentsCollaborationServer();
    if (collabServer) {
      return collabServer.flushWikiPageDraft(pageId, user);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const page = await this.getPageForMutation(pageId, tx);
      await this.accessService.ensureProjectWritable(user.userId, user.globalRole, page.projectId);
      const draft = await this.ensureDraftExists(tx, page, user.userId);
      return draft;
    });

    return {
      draftVersion: result.draftVersion,
      updatedAt: result.updatedAt.toISOString(),
      updatedBy: result.updatedBy
    };
  }

  async publishDraft(pageId: string, dto: PublishWikiPageDto, user: AuthenticatedUser): Promise<{
    pageId: string;
    revisionNumber: number;
    publishedAt: string;
    draftVersion: number;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const page = await this.getPageForMutation(pageId, tx);
      await this.accessService.ensureProjectWritable(user.userId, user.globalRole, page.projectId);
      const draft = await this.ensureDraftExists(tx, page, user.userId);

      if (dto.baseDraftVersion !== draft.draftVersion) {
        throw new ConflictException({
          message: "Draft version conflict",
          currentDraft: {
            title: draft.title,
            contentMarkdown: draft.contentMarkdown,
            draftVersion: draft.draftVersion,
            updatedAt: draft.updatedAt.toISOString(),
            updatedBy: draft.updatedBy
          }
        });
      }

      const docsExport = await this.exportDocsBindingBeforePublish(page, draft, user);

      const lastRevision = await tx.wikiRevision.findFirst({
        where: { pageId },
        orderBy: { revisionNumber: "desc" },
        select: { revisionNumber: true }
      });

      const revision = await tx.wikiRevision.create({
        data: {
          pageId,
          revisionNumber: (lastRevision?.revisionNumber ?? 0) + 1,
          contentMarkdown: draft.contentMarkdown,
          changeNote: dto.changeNote,
          createdById: user.userId
        },
        select: {
          id: true,
          revisionNumber: true,
          createdAt: true
        }
      });

      await tx.wikiPage.update({
        where: { id: pageId },
        data: {
          title: draft.title,
          currentRevisionId: revision.id
        }
      });

      const syncedDraft = await tx.wikiDraft.update({
        where: {
          pageId
        },
        data: {
          title: draft.title,
          contentMarkdown: draft.contentMarkdown,
          draftVersion: {
            increment: 1
          },
          updatedById: user.userId
        },
        select: {
          draftVersion: true
        }
      });

      await this.rebuildLinks(tx, {
        projectId: page.projectId,
        fromPageId: page.id,
        contentMarkdown: draft.contentMarkdown,
        docsSource:
          docsExport?.binding.repository.wikiDocsPrefix
            ? { prefix: docsExport.binding.repository.wikiDocsPrefix, docsPath: docsExport.binding.docsPath }
            : undefined
      });

      await this.hydrateLinksToPage(tx, {
        projectId: page.projectId,
        pageId: page.id,
        path: page.path
      });

      if (docsExport) {
        await tx.wikiDocsBinding.update({
          where: {
            id: docsExport.binding.id
          },
          data: {
            gitBlobId: docsExport.remoteFile.blobId,
            gitLastCommitId: docsExport.commitId ?? docsExport.remoteFile.lastCommitId,
            gitContentHash: docsExport.contentHash,
            wikiRevisionId: revision.id,
            wikiContentHash: docsExport.contentHash,
            status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
            lastSyncedAt: new Date()
          }
        });

        await tx.projectRepository.update({
          where: {
            id: docsExport.binding.repositoryId
          },
          data: {
            wikiDocsLastSyncedAt: new Date(),
            wikiDocsLastSyncError: null
          }
        });
      }

      return {
        page,
        revision,
        draftVersion: syncedDraft.draftVersion
      };
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: result.page.projectId,
      entityType: "wiki_page",
      entityId: pageId,
      action: "wiki.page.publish",
      metadata: {
        revisionNumber: result.revision.revisionNumber
      }
    });

    return {
      pageId,
      revisionNumber: result.revision.revisionNumber,
      publishedAt: result.revision.createdAt.toISOString(),
      draftVersion: result.draftVersion
    };
  }

  async updatePage(pageId: string, dto: UpdateWikiPageDto, user: AuthenticatedUser): Promise<{
    pageId: string;
    revisionNumber: number;
  }> {
    const page = await this.getPageForMutation(pageId);
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, page.projectId);
    const currentDraft = page.draft;
    const baseDraftVersion = currentDraft?.draftVersion ?? 1;

    const savedDraft = await this.saveDraft(
      pageId,
      {
        title: dto.title?.trim() || page.title,
        contentMarkdown: dto.contentMarkdown,
        baseDraftVersion
      },
      user
    );

    const published = await this.publishDraft(
      pageId,
      {
        baseDraftVersion: savedDraft.draftVersion,
        changeNote: dto.changeNote
      },
      user
    );

    return {
      pageId,
      revisionNumber: published.revisionNumber
    };
  }

  async deletePage(pageId: string, user: AuthenticatedUser): Promise<{ id: string; deletedAt: string }> {
    const page = await this.getPageForMutation(pageId);
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, page.projectId);
    const docsDelete = await this.exportDocsBindingBeforeDelete(page, user);

    const deletedPage = await this.prisma.$transaction(async (tx) => {
      await tx.wikiLink.deleteMany({
        where: {
          fromPageId: pageId
        }
      });

      await tx.wikiLink.updateMany({
        where: {
          toPageId: pageId
        },
        data: {
          toPageId: null
        }
      });

      const deletedAt = new Date();
      const deleted = await tx.wikiPage.update({
        where: {
          id: pageId
        },
        data: {
          deletedAt
        },
        select: {
          id: true,
          deletedAt: true
        }
      });

      if (docsDelete) {
        await tx.wikiDocsBinding.update({
          where: {
            id: docsDelete.binding.id
          },
          data: {
            status: WIKI_DOCS_BINDING_STATUS_DELETED,
            gitBlobId: null,
            gitLastCommitId: docsDelete.commitId,
            gitContentHash: null,
            lastSyncedAt: new Date()
          }
        });

        await tx.projectRepository.update({
          where: {
            id: docsDelete.binding.repositoryId
          },
          data: {
            wikiDocsLastSyncedAt: new Date(),
            wikiDocsLastSyncError: null
          }
        });
      }

      return {
        projectId: page.projectId,
        id: deleted.id,
        deletedAt: deleted.deletedAt
      };
    });

    await this.auditService.log({
      userId: user.userId,
      projectId: deletedPage.projectId,
      entityType: "wiki_page",
      entityId: deletedPage.id,
      action: "wiki.page.delete"
    });

    if (!deletedPage.deletedAt) {
      throw new NotFoundException("Wiki page not found");
    }

    return {
      id: deletedPage.id,
      deletedAt: deletedPage.deletedAt.toISOString()
    };
  }

  async listBacklinks(pageId: string, user: AuthenticatedUser): Promise<WikiBacklinkView[]> {
    const page = await this.ensurePageReadable(pageId, user);

    const wikiPage = await this.prisma.wikiPage.findUnique({
      where: {
        id: page.id
      },
      select: {
        path: true
      }
    });

    if (!wikiPage) {
      throw new NotFoundException("Wiki page not found");
    }

    const backlinks = await this.prisma.wikiLink.findMany({
      where: {
        OR: [{ toPageId: page.id }, { toPath: wikiPage.path }],
        fromPage: {
          deletedAt: null,
          ...(page.canWrite ? {} : { currentRevisionId: { not: null } })
        }
      },
      select: {
        fromPageId: true,
        fromPage: {
          select: {
            title: true,
            path: true
          }
        }
      }
    });

    const deduped = new Map<string, WikiBacklinkView>();
    for (const row of backlinks) {
      if (!row.fromPage) {
        continue;
      }

      deduped.set(row.fromPageId, {
        fromPageId: row.fromPageId,
        fromTitle: row.fromPage.title,
        fromPath: row.fromPage.path
      });
    }

    return [...deduped.values()].sort((left, right) => left.fromPath.localeCompare(right.fromPath));
  }

  async listRevisions(pageId: string, user: AuthenticatedUser): Promise<
    Array<{
      id: string;
      revisionNumber: number;
      publishedAt: string;
      createdBy: WikiUserSummary;
      changeNote: string | null;
    }>
  > {
    const page = await this.ensurePageReadable(pageId, user);

    const revisions = await this.prisma.wikiRevision.findMany({
      where: { pageId: page.id },
      orderBy: { revisionNumber: "desc" },
      select: {
        id: true,
        revisionNumber: true,
        createdAt: true,
        changeNote: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return revisions.map((revision) => ({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      publishedAt: revision.createdAt.toISOString(),
      createdBy: revision.createdBy,
      changeNote: revision.changeNote
    }));
  }

  async getRevision(pageId: string, revisionId: string, user: AuthenticatedUser): Promise<WikiRevisionView> {
    const page = await this.ensurePageReadable(pageId, user);

    const revision = await this.prisma.wikiRevision.findFirst({
      where: {
        id: revisionId,
        pageId: page.id
      },
      select: {
        id: true,
        revisionNumber: true,
        contentMarkdown: true,
        createdAt: true,
        changeNote: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!revision) {
      throw new NotFoundException("Wiki revision not found");
    }

    return {
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      contentMarkdown: revision.contentMarkdown,
      publishedAt: revision.createdAt.toISOString(),
      createdBy: revision.createdBy,
      changeNote: revision.changeNote
    };
  }

  async uploadWikiAsset(
    projectId: string,
    file: Express.Multer.File | undefined,
    user: AuthenticatedUser
  ): Promise<{ assetId: string; url: string; mimeType: string; sizeBytes: number; originalName: string }> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);

    if (!file) {
      throw new BadRequestException("Missing asset upload");
    }
    if (!WIKI_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Unsupported wiki image type");
    }
    if (file.size > WIKI_IMAGE_MAX_BYTES) {
      throw new BadRequestException(`Wiki image exceeds ${WIKI_IMAGE_MAX_BYTES} bytes`);
    }

    const savedFile = await this.storageService.saveUpload(file, user.userId);
    const fileObject = await this.prisma.fileObject.findUnique({
      where: {
        id: savedFile.id
      },
      select: {
        id: true,
        mimeType: true,
        sizeBytes: true,
        originalName: true
      }
    });

    if (!fileObject) {
      throw new NotFoundException("Uploaded file metadata not found");
    }

    const asset = await this.prisma.wikiAsset.create({
      data: {
        projectId,
        fileObjectId: fileObject.id,
        uploadedById: user.userId
      },
      select: {
        id: true
      }
    });

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "wiki_asset",
      entityId: asset.id,
      action: "wiki.asset.upload"
    });

    return {
      assetId: asset.id,
      url: `/wiki-assets/${asset.id}/content`,
      mimeType: fileObject.mimeType,
      sizeBytes: Number(fileObject.sizeBytes),
      originalName: fileObject.originalName
    };
  }

  async getWikiAssetContent(
    assetId: string,
    user: AuthenticatedUser
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const asset = await this.prisma.wikiAsset.findFirst({
      where: {
        id: assetId
      },
      select: {
        id: true,
        projectId: true,
        fileObject: {
          select: {
            storagePath: true,
            mimeType: true,
            originalName: true
          }
        }
      }
    });

    if (!asset) {
      throw new NotFoundException("Wiki asset not found");
    }

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, asset.projectId);
    const buffer = await this.storageService.readObject(asset.fileObject.storagePath);

    return {
      buffer,
      mimeType: asset.fileObject.mimeType,
      fileName: asset.fileObject.originalName
    };
  }
}
