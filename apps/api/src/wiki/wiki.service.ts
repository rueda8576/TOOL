import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { CreateWikiPageDto } from "./dto/create-wiki-page.dto";
import { PublishWikiPageDto } from "./dto/publish-wiki-page.dto";
import { SaveWikiDraftDto } from "./dto/save-wiki-draft.dto";
import { SearchWikiPagesQueryDto } from "./dto/search-wiki-pages-query.dto";
import { UpdateWikiPageDto } from "./dto/update-wiki-page.dto";
import {
  WikiBacklinkView,
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
const WIKI_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const WIKI_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

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

@Injectable()
export class WikiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService
  ) {}

  private canReadDraft(user: AuthenticatedUser): boolean {
    return user.globalRole !== "reader";
  }

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

  private parseWikiLinks(contentMarkdown: string): string[] {
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
    return [...links];
  }

  private buildTreeNodes(
    pages: Array<{
      id: string;
      title: string;
      path: string;
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

  private async ensurePageReadable(pageId: string, user: AuthenticatedUser): Promise<{ id: string; projectId: string }> {
    const page = await this.prisma.wikiPage.findFirst({
      where: {
        id: pageId,
        deletedAt: null
      },
      select: {
        id: true,
        projectId: true
      }
    });

    if (!page) {
      throw new NotFoundException("Wiki page not found");
    }

    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, page.projectId);
    return page;
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
    params: { projectId: string; fromPageId: string; contentMarkdown: string }
  ): Promise<void> {
    const parsedPaths = this.parseWikiLinks(params.contentMarkdown);

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

  private buildPublishedRevision(page: WikiPageWithDraftAndRevision): WikiRevisionView {
    if (!page.currentRevision) {
      throw new NotFoundException("Wiki page has no published revision");
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

  private sanitizeSearchSnippet(rawSnippet: string | null | undefined): string {
    if (!rawSnippet) {
      return "";
    }
    return rawSnippet
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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

    const slug = this.normalizeSlug(dto.slug);
    const folderPath = this.normalizeFolderPath(dto.folderPath);
    const pagePath = this.composePath(folderPath, slug);

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

    const created = await this.prisma.$transaction(async (tx) => {
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
        contentMarkdown: dto.contentMarkdown
      });

      return {
        ...page,
        revisionNumber: revision.revisionNumber
      };
    });

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

  async listTree(projectId: string, user: AuthenticatedUser): Promise<WikiTreeNode[]> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);
    const canReadDraft = this.canReadDraft(user);

    const pages = await this.prisma.wikiPage.findMany({
      where: {
        projectId,
        deletedAt: null
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
        const hasDraftChanges =
          canReadDraft &&
          Boolean(
            page.draft &&
              (page.draft.title !== page.title || page.draft.contentMarkdown !== (page.currentRevision?.contentMarkdown ?? ""))
          );

        return {
          id: page.id,
          title: page.title,
          path: page.path,
          updatedAt: page.updatedAt,
          hasDraftChanges,
          draftUpdatedAt: canReadDraft ? page.draft?.updatedAt ?? null : null,
          draftUpdatedBy: canReadDraft ? page.draft?.updatedBy ?? null : null
        };
      })
    );
  }

  async getByPath(projectId: string, path: string, user: AuthenticatedUser): Promise<WikiPageDetail> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);
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
            path: true
          }
        }
      }
    });

    const backlinksRaw = await this.prisma.wikiLink.findMany({
      where: {
        OR: [{ toPageId: page.id }, { toPath: page.path }],
        fromPage: {
          deletedAt: null
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

    const outgoingLinks: WikiLinkView[] = outgoingLinksRaw.map((link) => ({
      toPath: link.toPath,
      toPageId: link.toPageId,
      title: link.toPage?.title ?? null,
      path: link.toPage?.path ?? null
    }));

    const canReadDraft = this.canReadDraft(user);
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

    return {
      page: this.buildWikiPageSummary(page),
      published: this.buildPublishedRevision(page),
      draft,
      outgoingLinks,
      backlinks: [...backlinkMap.values()].sort((left, right) => left.fromPath.localeCompare(right.fromPath))
    };
  }

  async searchPages(projectId: string, query: SearchWikiPagesQueryDto, user: AuthenticatedUser): Promise<WikiSearchResult[]> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);

    const searchText = query.q.trim();
    if (searchText.length < 2) {
      throw new BadRequestException("Search query must be at least 2 characters");
    }

    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const includeDraft = this.canReadDraft(user);

    const draftVectorPart = includeDraft
      ? Prisma.sql`COALESCE(d."contentMarkdown", '')`
      : Prisma.sql`''`;
    const draftMatchCondition = includeDraft
      ? Prisma.sql`to_tsvector('simple', COALESCE(d."contentMarkdown", '')) @@ query`
      : Prisma.sql`FALSE`;

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
        AND search_data.search_vector @@ query
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
        contentMarkdown: draft.contentMarkdown
      });

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
          deletedAt: null
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
