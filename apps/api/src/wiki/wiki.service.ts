import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../common/authenticated-user";
import { ProjectAccessService } from "../common/project-access.service";
import { getDocumentsCollaborationServer } from "../documents/collaboration-server-registry";
import {
  GitlabService,
  RepositoryDocsMarkdownFile
} from "../gitlab/gitlab.service";
import { PrismaService } from "../prisma/prisma.service";
import { AssignWikiDocsPagesDto } from "./dto/assign-wiki-docs-pages.dto";
import { CreateWikiPageDto } from "./dto/create-wiki-page.dto";
import { ImportWikiPageEntryDto, ImportWikiPagesDto } from "./dto/import-wiki-pages.dto";
import { PublishWikiPageDto } from "./dto/publish-wiki-page.dto";
import { SaveWikiDraftDto } from "./dto/save-wiki-draft.dto";
import { SearchWikiPagesQueryDto } from "./dto/search-wiki-pages-query.dto";
import { UpdateWikiPageDto } from "./dto/update-wiki-page.dto";
import { WikiDocsStructureMigrationDto } from "./dto/wiki-docs-structure-migration.dto";
import {
  WikiAssetsService,
  WikiAssetContent,
  WikiAssetUploadResult
} from "./wiki-assets.service";
import {
  WikiBacklinkView,
  WikiDocsKind,
  WikiDocsAssignPageResult,
  WikiDocsAssignResult,
  WikiDocsStructureMigrationPreview,
  WikiDocsStructureMigrationPreviewRow,
  WikiDocsStructureMigrationResult,
  WikiDocsStructureMigrationResultRow,
  WikiDocsSyncRepositoryResult,
  WikiDocsSyncResult,
  WikiDocsSyncStatus,
  WikiDraftView,
  WikiLinkView,
  WikiPageDetail,
  WikiRevisionView,
  WikiSearchResult,
  WikiTreeNode,
  WikiUserSummary
} from "./wiki.types";
import {
  buildStructureCounts,
  docsPathToWikiPath,
  isLegacyDocsPath,
  legacyDocsPathToCanonicalDocsPath,
  normalizeDocsKind,
  splitWikiPath,
  wikiPathToDocsPath,
  WIKI_DOCS_DEFAULT_KIND
} from "./wiki-docs-paths";
import {
  WikiDocsRepositoriesService,
  WikiDocsRepositoryRecord
} from "./wiki-docs-repositories.service";
import {
  buildDocsAssignmentCommitMessage,
  buildDocsAssignmentDestination,
  buildDocsAssignmentKey,
  buildDocsAssignmentResult,
  buildDocsAssignTotals,
  groupDocsAssignmentsByRepository,
  sortDocsAssignmentResults
} from "./wiki-docs-assignment";
import { parseWikiLinks } from "./wiki-markdown-links";
import {
  composePath,
  hashMarkdownContent,
  normalizeFolderPath,
  normalizePath,
  normalizeSlug
} from "./wiki-paths";
import {
  buildDocsConflict,
  buildDocsSourceView,
  buildEmptyDocsSyncRepositoryResult,
  buildPreparedDocsPage,
  buildPublishedRevision,
  buildStructureMigrationRow,
  buildSyncRepositoryStatus,
  buildUnassignedDocsPages,
  buildWikiPageSummary,
  buildWikiTreeNodes,
  groupUnboundWikiPagesByRepository,
  hasStructureBindingDraftChanges,
  isBindingWikiChanged,
  PreparedDocsPage,
  sanitizeSearchSnippet
} from "./wiki-view-builders";

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

type WikiDocsUnboundPageRecord = {
  id: string;
  projectId: string;
  title: string;
  path: string;
  currentRevisionId: string | null;
  currentRevision: {
    id: string;
    contentMarkdown: string;
  } | null;
  draft?: {
    title: string;
    contentMarkdown: string;
  } | null;
};

type PreparedDocsAssignment = {
  page: WikiDocsUnboundPageRecord;
  repository: WikiDocsRepositoryRecord;
  slug: string;
  folderPath: string;
  oldWikiPath: string;
  newWikiPath: string;
  docsPath: string;
  docsKind: WikiDocsKind;
  contentMarkdown: string;
  contentHash: string;
  remoteFile: RepositoryDocsMarkdownFile | null;
  mode: "exportedToGit" | "linked";
};

type WikiDocsStructureBindingRecord = WikiDocsBindingRecord & {
  repository: WikiDocsRepositoryRecord;
  wikiPage: NonNullable<WikiDocsBindingRecord["wikiPage"]> & {
    projectId: string;
    title: string;
    draft: {
      title: string;
      contentMarkdown: string;
    } | null;
  };
};

@Injectable()
export class WikiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: ProjectAccessService,
    private readonly auditService: AuditService,
    private readonly gitlabService: GitlabService,
    private readonly wikiAssetsService: WikiAssetsService,
    private readonly docsRepositoriesService: WikiDocsRepositoriesService
  ) {}

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
    const slug = normalizeSlug(entry.slug);
    const folderPath = normalizeFolderPath(entry.folderPath);
    return {
      slug,
      folderPath,
      path: composePath(folderPath, slug)
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
    const parsedPaths = parseWikiLinks(params.contentMarkdown, params.docsSource);

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

  private async listDocsRepositories(projectId: string): Promise<WikiDocsRepositoryRecord[]> {
    return this.docsRepositoriesService.listDocsRepositories(projectId);
  }

  private async ensureRepositoryWikiDocsPrefix(repository: WikiDocsRepositoryRecord): Promise<WikiDocsRepositoryRecord> {
    return this.docsRepositoriesService.ensureRepositoryWikiDocsPrefix(repository);
  }

  private async ensureAllRepositoryWikiDocsPrefixes(projectId: string): Promise<WikiDocsRepositoryRecord[]> {
    return this.docsRepositoriesService.ensureAllRepositoryWikiDocsPrefixes(projectId);
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

  async getDocsSyncStatus(projectId: string, user: AuthenticatedUser): Promise<WikiDocsSyncStatus> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);
    const repositories = await this.ensureAllRepositoryWikiDocsPrefixes(projectId);
    const bindings = (await this.prisma.wikiDocsBinding.findMany({
      where: {
        projectId
      },
      select: {
        repositoryId: true,
        docsPath: true,
        status: true
      }
    })) ?? [];

    const countByRepository = new Map<string, { active: number; deleted: number }>();
    const docsPathsByRepository = new Map<string, string[]>();
    for (const row of bindings) {
      const current = countByRepository.get(row.repositoryId) ?? { active: 0, deleted: 0 };
      if (row.status === WIKI_DOCS_BINDING_STATUS_DELETED) {
        current.deleted += 1;
      } else {
        current.active += 1;
        const docsPaths = docsPathsByRepository.get(row.repositoryId) ?? [];
        docsPaths.push(row.docsPath);
        docsPathsByRepository.set(row.repositoryId, docsPaths);
      }
      countByRepository.set(row.repositoryId, current);
    }

    return {
      repositories: repositories.map((repository) => {
        const repositoryCounts = countByRepository.get(repository.id) ?? { active: 0, deleted: 0 };
        return buildSyncRepositoryStatus(
          repository,
          repositoryCounts.active,
          repositoryCounts.deleted,
          buildStructureCounts(docsPathsByRepository.get(repository.id) ?? [])
        );
      }),
      unassigned: buildUnassignedDocsPages(await this.loadUnboundPublishedWikiPages(projectId), repositories)
    };
  }

  private async loadStructureMigrationBindings(
    projectId: string,
    bindingIds?: string[]
  ): Promise<WikiDocsStructureBindingRecord[]> {
    const bindings = await this.prisma.wikiDocsBinding.findMany({
      where: {
        projectId,
        status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
        ...(bindingIds ? { id: { in: bindingIds } } : {})
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
            projectId: true,
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
            },
            draft: {
              select: {
                title: true,
                contentMarkdown: true
              }
            }
          }
        }
      }
    });

    return bindings.filter((binding) => binding.wikiPage && isLegacyDocsPath(binding.docsPath)) as WikiDocsStructureBindingRecord[];
  }

  private async buildStructureMigrationPreviewRows(params: {
    projectId: string;
    user: AuthenticatedUser;
    operationsByBindingId?: Map<string, WikiDocsKind>;
  }): Promise<WikiDocsStructureMigrationPreviewRow[]> {
    const bindingIds = params.operationsByBindingId ? [...params.operationsByBindingId.keys()] : undefined;
    const bindings = await this.loadStructureMigrationBindings(params.projectId, bindingIds);
    const rows: WikiDocsStructureMigrationPreviewRow[] = [];
    const targetWikiPathCounts = new Map<string, number>();
    const targetDocsPathCounts = new Map<string, number>();

    for (const binding of bindings) {
      const targetKind = params.operationsByBindingId?.get(binding.id) ?? WIKI_DOCS_DEFAULT_KIND;
      const targetDocsPath = legacyDocsPathToCanonicalDocsPath(binding.docsPath, targetKind);
      const targetWikiPath = binding.repository.wikiDocsPrefix
        ? docsPathToWikiPath(binding.repository.wikiDocsPrefix, targetDocsPath)
        : binding.wikiPath;
      targetWikiPathCounts.set(targetWikiPath, (targetWikiPathCounts.get(targetWikiPath) ?? 0) + 1);
      targetDocsPathCounts.set(`${binding.repositoryId}:${targetDocsPath}`, (targetDocsPathCounts.get(`${binding.repositoryId}:${targetDocsPath}`) ?? 0) + 1);
    }

    for (const binding of bindings) {
      const targetKind = params.operationsByBindingId?.get(binding.id) ?? WIKI_DOCS_DEFAULT_KIND;
      const targetDocsPath = legacyDocsPathToCanonicalDocsPath(binding.docsPath, targetKind);
      const targetWikiPath = binding.repository.wikiDocsPrefix
        ? docsPathToWikiPath(binding.repository.wikiDocsPrefix, targetDocsPath)
        : binding.wikiPath;
      const conflicts: string[] = [];

      if (!binding.repository.wikiDocsPrefix) {
        conflicts.push("Repository Docs prefix is missing");
      }
      if (!binding.wikiPageId || !binding.wikiPage.currentRevision) {
        conflicts.push("Wiki page has no published revision");
      }
      if (hasStructureBindingDraftChanges(binding)) {
        conflicts.push("Wiki page has unpublished draft changes");
      }
      if ((targetWikiPathCounts.get(targetWikiPath) ?? 0) > 1 || (targetDocsPathCounts.get(`${binding.repositoryId}:${targetDocsPath}`) ?? 0) > 1) {
        conflicts.push("Another migration operation uses the same destination");
      }

      const targetWikiPage = await this.prisma.wikiPage.findFirst({
        where: {
          projectId: params.projectId,
          path: targetWikiPath,
          deletedAt: null,
          id: {
            not: binding.wikiPage.id
          }
        },
        select: { id: true }
      });
      if (targetWikiPage) {
        conflicts.push("Destination wiki path is already used");
      }

      const targetBinding = await this.prisma.wikiDocsBinding.findFirst({
        where: {
          OR: [
            {
              projectId: params.projectId,
              wikiPath: targetWikiPath,
              id: {
                not: binding.id
              }
            },
            {
              repositoryId: binding.repositoryId,
              docsPath: targetDocsPath,
              id: {
                not: binding.id
              }
            }
          ]
        },
        select: { id: true }
      });
      if (targetBinding) {
        conflicts.push("Destination Docs binding already exists");
      }

      const currentRemoteFile = await this.gitlabService.getRepositoryTextFileForDocsSync(
        params.projectId,
        params.user,
        binding.repositoryId,
        binding.docsPath
      );
      if (!currentRemoteFile) {
        conflicts.push("Current Docs file is missing");
      }
      const targetRemoteFile = await this.gitlabService.getRepositoryTextFileForDocsSync(
        params.projectId,
        params.user,
        binding.repositoryId,
        targetDocsPath
      );
      if (targetRemoteFile) {
        conflicts.push("Destination Docs file already exists");
      }

      rows.push(buildStructureMigrationRow({ binding, targetKind, conflicts: [...new Set(conflicts)] }));
    }

    return rows;
  }

  async getDocsStructureMigrationPreview(projectId: string, user: AuthenticatedUser): Promise<WikiDocsStructureMigrationPreview> {
    await this.accessService.ensureProjectReadable(user.userId, user.globalRole, projectId);
    const rows = await this.buildStructureMigrationPreviewRows({ projectId, user });
    return {
      rows,
      totals: {
        legacy: rows.length,
        ready: rows.filter((row) => row.conflicts.length === 0).length,
        conflicts: rows.filter((row) => row.conflicts.length > 0).length
      }
    };
  }

  async applyDocsStructureMigration(
    projectId: string,
    dto: WikiDocsStructureMigrationDto,
    user: AuthenticatedUser
  ): Promise<WikiDocsStructureMigrationResult> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);
    const operationsByBindingId = new Map<string, WikiDocsKind>();
    for (const operation of dto.operations) {
      operationsByBindingId.set(operation.bindingId.trim(), normalizeDocsKind(operation.targetKind));
    }

    const previewRows = await this.buildStructureMigrationPreviewRows({ projectId, user, operationsByBindingId });
    const bindingsById = new Map((await this.loadStructureMigrationBindings(projectId, [...operationsByBindingId.keys()])).map((binding) => [binding.id, binding]));
    const resultRows: WikiDocsStructureMigrationResultRow[] = [];
    const previewBindingIds = new Set(previewRows.map((row) => row.bindingId));

    for (const [bindingId, targetKind] of operationsByBindingId) {
      if (previewBindingIds.has(bindingId)) {
        continue;
      }
      resultRows.push({
        bindingId,
        pageId: "",
        title: "Unavailable Docs binding",
        repositoryId: "",
        repositoryName: "",
        currentWikiPath: "",
        currentDocsPath: "",
        targetKind,
        targetWikiPath: "",
        targetDocsPath: "",
        hasDraftChanges: false,
        conflicts: ["Docs binding is not available for migration"],
        status: "conflict",
        reason: "Docs binding is not available for migration"
      });
    }

    for (const previewRow of previewRows) {
      const binding = bindingsById.get(previewRow.bindingId);
      if (!binding) {
        resultRows.push({ ...previewRow, status: "conflict", reason: "Docs binding is not available for migration" });
        continue;
      }
      if (previewRow.conflicts.length > 0) {
        resultRows.push({ ...previewRow, status: "conflict", reason: previewRow.conflicts.join("; ") });
        continue;
      }

      try {
        const currentRemoteFile = await this.gitlabService.getRepositoryTextFileForDocsSync(projectId, user, binding.repositoryId, binding.docsPath);
        if (!currentRemoteFile) {
          resultRows.push({ ...previewRow, status: "conflict", reason: "Current Docs file is missing" });
          continue;
        }
        const contentHash = hashMarkdownContent(currentRemoteFile.content);
        const commit = await this.gitlabService.commitRepositoryFileActions(
          projectId,
          user,
          binding.repositoryId,
          [
            {
              action: "create",
              filePath: previewRow.targetDocsPath,
              content: currentRemoteFile.content
            },
            {
              action: "delete",
              filePath: binding.docsPath,
              lastCommitId: currentRemoteFile.lastCommitId
            }
          ],
          `Move wiki docs file ${binding.docsPath} to ${previewRow.targetDocsPath}`
        );
        const movedRemoteFile = await this.gitlabService.getRepositoryTextFileForDocsSync(projectId, user, binding.repositoryId, previewRow.targetDocsPath);
        const splitPath = splitWikiPath(previewRow.targetWikiPath);

        await this.prisma.$transaction(async (tx) => {
          await tx.wikiPage.update({
            where: { id: binding.wikiPage.id },
            data: {
              slug: splitPath.slug,
              folderPath: splitPath.folderPath,
              path: previewRow.targetWikiPath
            }
          });

          await tx.wikiDocsBinding.update({
            where: { id: binding.id },
            data: {
              docsPath: previewRow.targetDocsPath,
              wikiPath: previewRow.targetWikiPath,
              gitBlobId: movedRemoteFile?.blobId ?? null,
              gitLastCommitId: commit.id,
              gitContentHash: contentHash,
              wikiContentHash: contentHash,
              status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
              lastSyncedAt: new Date()
            }
          });

          await tx.wikiLink.updateMany({
            where: {
              toPageId: binding.wikiPage.id
            },
            data: {
              toPath: previewRow.targetWikiPath
            }
          });

          await tx.wikiLink.updateMany({
            where: {
              toPath: binding.wikiPath,
              fromPage: {
                projectId
              }
            },
            data: {
              toPath: previewRow.targetWikiPath,
              toPageId: binding.wikiPage.id
            }
          });

          await this.rebuildLinks(tx, {
            projectId,
            fromPageId: binding.wikiPage.id,
            contentMarkdown: currentRemoteFile.content,
            docsSource: binding.repository.wikiDocsPrefix
              ? { prefix: binding.repository.wikiDocsPrefix, docsPath: previewRow.targetDocsPath }
              : undefined
          });

          await this.hydrateLinksToPage(tx, {
            projectId,
            pageId: binding.wikiPage.id,
            path: previewRow.targetWikiPath
          });

          await tx.projectRepository.update({
            where: { id: binding.repositoryId },
            data: {
              wikiDocsLastSyncedAt: new Date(),
              wikiDocsLastSyncError: null
            }
          });
        });

        resultRows.push({ ...previewRow, conflicts: [], status: "migrated", reason: null });
      } catch (error) {
        resultRows.push({ ...previewRow, status: "error", reason: (error as Error).message || "Docs structure migration failed" });
      }
    }

    return {
      rows: resultRows,
      totals: {
        migrated: resultRows.filter((row) => row.status === "migrated").length,
        conflicts: resultRows.filter((row) => row.status === "conflict").length,
        errors: resultRows.filter((row) => row.status === "error").length
      }
    };
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

  private async loadUnboundPublishedWikiPages(projectId: string): Promise<WikiDocsUnboundPageRecord[]> {
    const pages = await this.prisma.wikiPage.findMany({
      where: {
        projectId,
        deletedAt: null,
        currentRevisionId: {
          not: null
        },
        docsBinding: {
          is: null
        }
      },
      orderBy: {
        path: "asc"
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        path: true,
        currentRevisionId: true,
        currentRevision: {
          select: {
            id: true,
            contentMarkdown: true
          }
        },
        draft: {
          select: {
            title: true,
            contentMarkdown: true
          }
        }
      }
    });
    return pages as WikiDocsUnboundPageRecord[];
  }

  private async createDocsBindingForUnboundWikiPage(params: {
    projectId: string;
    repository: WikiDocsRepositoryRecord;
    page: WikiDocsUnboundPageRecord;
    docsPath: string;
    remoteFile: RepositoryDocsMarkdownFile | null;
    commitId: string | null;
    contentHash: string;
  }): Promise<void> {
    await this.prisma.wikiDocsBinding.create({
      data: {
        projectId: params.projectId,
        repositoryId: params.repository.id,
        wikiPageId: params.page.id,
        docsPath: params.docsPath,
        wikiPath: params.page.path,
        gitBlobId: params.remoteFile?.blobId ?? null,
        gitLastCommitId: params.commitId ?? params.remoteFile?.lastCommitId ?? null,
        gitContentHash: params.contentHash,
        wikiRevisionId: params.page.currentRevision?.id ?? params.page.currentRevisionId,
        wikiContentHash: params.contentHash,
        status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
        lastSyncedAt: new Date()
      }
    });
  }

  private async reconcileUnboundWikiPagesForRepository(params: {
    projectId: string;
    repository: WikiDocsRepositoryRecord;
    pages: WikiDocsUnboundPageRecord[];
    filesByPath: Map<string, RepositoryDocsMarkdownFile>;
    user: AuthenticatedUser;
    result: WikiDocsSyncRepositoryResult;
  }): Promise<void> {
    const { projectId, repository, pages, filesByPath, user, result } = params;
    const prefix = repository.wikiDocsPrefix;
    if (!prefix || pages.length === 0) {
      return;
    }

    for (const page of pages) {
      try {
        const currentRevision = page.currentRevision;
        if (!currentRevision) {
          continue;
        }

        const docsPath = wikiPathToDocsPath(prefix, page.path);
        const existingBinding = await this.prisma.wikiDocsBinding.findFirst({
          where: {
            OR: [
              {
                projectId,
                wikiPath: page.path
              },
              {
                repositoryId: repository.id,
                docsPath
              }
            ]
          },
          select: {
            id: true
          }
        });
        if (existingBinding) {
          result.conflicts.push(buildDocsConflict({
            repositoryId: repository.id,
            docsPath,
            wikiPath: page.path,
            reason: "Wiki page or Docs path already has a Docs binding"
          }));
          continue;
        }

        const contentMarkdown = currentRevision.contentMarkdown;
        const contentHash = hashMarkdownContent(contentMarkdown);
        const remoteFile =
          filesByPath.get(docsPath) ??
          (await this.gitlabService.getRepositoryTextFileForDocsSync(projectId, user, repository.id, docsPath));

        if (remoteFile) {
          const remoteHash = hashMarkdownContent(remoteFile.content);
          if (remoteHash !== contentHash) {
            result.conflicts.push(buildDocsConflict({
              repositoryId: repository.id,
              docsPath,
              wikiPath: page.path,
              reason: "Unbound Wiki page and existing Docs file have different content"
            }));
            continue;
          }

          await this.createDocsBindingForUnboundWikiPage({
            projectId,
            repository,
            page,
            docsPath,
            remoteFile,
            commitId: null,
            contentHash
          });
          result.linked += 1;
          continue;
        }

        const commit = await this.gitlabService.commitRepositoryFileActions(
          projectId,
          user,
          repository.id,
          [
            {
              action: "create",
              filePath: docsPath,
              content: contentMarkdown
            }
          ],
          `Create wiki docs file ${docsPath}`
        );

        await this.createDocsBindingForUnboundWikiPage({
          projectId,
          repository,
          page,
          docsPath,
          remoteFile: null,
          commitId: commit.id,
          contentHash
        });
        result.exportedToGit += 1;
      } catch (error) {
        const message = (error as Error).message || "Unbound wiki page export failed";
        result.errors.push(`/${page.path}: ${message}`);
      }
    }
  }

  private async applyPreparedDocsAssignment(params: {
    projectId: string;
    assignment: PreparedDocsAssignment;
    commitId: string | null;
  }): Promise<void> {
    const { projectId, assignment, commitId } = params;
    const page = assignment.page;

    await this.prisma.$transaction(async (tx) => {
      await tx.wikiPage.update({
        where: {
          id: page.id
        },
        data: {
          slug: assignment.slug,
          folderPath: assignment.folderPath,
          path: assignment.newWikiPath
        }
      });

      await tx.wikiDocsBinding.create({
        data: {
          projectId,
          repositoryId: assignment.repository.id,
          wikiPageId: page.id,
          docsPath: assignment.docsPath,
          wikiPath: assignment.newWikiPath,
          gitBlobId: assignment.remoteFile?.blobId ?? null,
          gitLastCommitId: commitId ?? assignment.remoteFile?.lastCommitId ?? null,
          gitContentHash: assignment.contentHash,
          wikiRevisionId: page.currentRevision?.id ?? page.currentRevisionId,
          wikiContentHash: assignment.contentHash,
          status: WIKI_DOCS_BINDING_STATUS_ACTIVE,
          lastSyncedAt: new Date()
        }
      });

      await tx.wikiLink.updateMany({
        where: {
          toPageId: page.id
        },
        data: {
          toPath: assignment.newWikiPath
        }
      });

      await tx.wikiLink.updateMany({
        where: {
          toPath: assignment.oldWikiPath,
          fromPage: {
            projectId
          }
        },
        data: {
          toPath: assignment.newWikiPath,
          toPageId: page.id
        }
      });

      await this.hydrateLinksToPage(tx, {
        projectId,
        pageId: page.id,
        path: assignment.newWikiPath
      });

      await tx.projectRepository.update({
        where: {
          id: assignment.repository.id
        },
        data: {
          wikiDocsLastSyncedAt: new Date(),
          wikiDocsLastSyncError: null
        }
      });
    });
  }

  async assignDocsPages(projectId: string, dto: AssignWikiDocsPagesDto, user: AuthenticatedUser): Promise<WikiDocsAssignResult> {
    await this.accessService.ensureProjectWritable(user.userId, user.globalRole, projectId);
    const repositories = await this.ensureAllRepositoryWikiDocsPrefixes(projectId);
    const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));
    const requestedPageIds = [...new Set(dto.assignments.map((assignment) => assignment.pageId.trim()).filter(Boolean))];
    const pages = await this.prisma.wikiPage.findMany({
      where: {
        projectId,
        id: {
          in: requestedPageIds
        },
        deletedAt: null,
        currentRevisionId: {
          not: null
        },
        docsBinding: {
          is: null
        }
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        path: true,
        currentRevisionId: true,
        currentRevision: {
          select: {
            id: true,
            contentMarkdown: true
          }
        },
        draft: {
          select: {
            title: true,
            contentMarkdown: true
          }
        }
      }
    });
    const pagesById = new Map((pages as WikiDocsUnboundPageRecord[]).map((page) => [page.id, page]));
    const results: WikiDocsAssignPageResult[] = [];
    const prepared: PreparedDocsAssignment[] = [];
    const seenWikiPaths = new Set<string>();
    const seenDocsKeys = new Set<string>();

    for (const rawAssignment of dto.assignments) {
      const pageId = rawAssignment.pageId.trim();
      const repositoryId = rawAssignment.repositoryId.trim();
      const repository = repositoriesById.get(repositoryId);
      const fallbackRepository =
        repository ??
        ({
          id: repositoryId || "unknown",
          name: "Unknown repository",
          projectId,
          pathWithNamespace: "",
          defaultBranch: "",
          wikiDocsPrefix: null,
          wikiDocsLastSyncedAt: null,
          wikiDocsLastSyncError: null
        } satisfies WikiDocsRepositoryRecord);
      const page =
        pagesById.get(pageId) ??
        ({
          id: pageId || "unknown",
          projectId,
          title: "Unknown wiki page",
          path: "",
          currentRevisionId: null,
          currentRevision: null,
          draft: null
        } satisfies WikiDocsUnboundPageRecord);

      if (!repository || !repository.wikiDocsPrefix) {
        results.push(
          buildDocsAssignmentResult({
            page,
            repository: fallbackRepository,
            oldWikiPath: page.path,
            newWikiPath: page.path,
            docsPath: "",
            status: "conflict",
            reason: "Repository is not available for Docs sync"
          })
        );
        continue;
      }

      if (!pagesById.has(pageId) || !page.currentRevision) {
        results.push(
          buildDocsAssignmentResult({
            page,
            repository,
            oldWikiPath: page.path,
            newWikiPath: page.path,
            docsPath: "",
            status: "conflict",
            reason: "Wiki page is not a published unbound page"
          })
        );
        continue;
      }

      const docsKind = normalizeDocsKind(rawAssignment.docsKind);
      let destination: ReturnType<typeof buildDocsAssignmentDestination>;
      try {
        destination = buildDocsAssignmentDestination({
          docsKind,
          repositoryPrefix: repository.wikiDocsPrefix,
          slug: rawAssignment.slug,
          folderPath: rawAssignment.folderPath
        });
      } catch (error) {
        results.push(
          buildDocsAssignmentResult({
            page,
            repository,
            oldWikiPath: page.path,
            newWikiPath: page.path,
            docsPath: "",
            docsKind,
            status: "conflict",
            reason: (error as Error).message || "Invalid assignment path"
          })
        );
        continue;
      }

      const { slug, folderPath, newWikiPath, docsPath } = destination;
      const docsKey = buildDocsAssignmentKey(repository.id, docsPath);

      if (seenWikiPaths.has(newWikiPath) || seenDocsKeys.has(docsKey)) {
        results.push(
          buildDocsAssignmentResult({
            page,
            repository,
            oldWikiPath: page.path,
            newWikiPath,
            docsPath,
            docsKind,
            status: "conflict",
            reason: "Another assignment uses the same destination"
          })
        );
        continue;
      }
      seenWikiPaths.add(newWikiPath);
      seenDocsKeys.add(docsKey);

      const wikiPathAvailable = await this.ensureDocsWikiPathAvailable(projectId, newWikiPath, page.id, null);
      if (!wikiPathAvailable) {
        results.push(
          buildDocsAssignmentResult({
            page,
            repository,
            oldWikiPath: page.path,
            newWikiPath,
            docsPath,
            docsKind,
            status: "conflict",
            reason: "Destination wiki path is already used"
          })
        );
        continue;
      }

      const existingBinding = await this.prisma.wikiDocsBinding.findFirst({
        where: {
          OR: [
            {
              projectId,
              wikiPath: newWikiPath
            },
            {
              repositoryId: repository.id,
              docsPath
            }
          ]
        },
        select: {
          id: true
        }
      });
      if (existingBinding) {
        results.push(
          buildDocsAssignmentResult({
            page,
            repository,
            oldWikiPath: page.path,
            newWikiPath,
            docsPath,
            docsKind,
            status: "conflict",
            reason: "Destination Docs path already has a binding"
          })
        );
        continue;
      }

      try {
        const contentMarkdown = page.currentRevision.contentMarkdown;
        const contentHash = hashMarkdownContent(contentMarkdown);
        const remoteFile = await this.gitlabService.getRepositoryTextFileForDocsSync(projectId, user, repository.id, docsPath);
        if (remoteFile) {
          const remoteHash = hashMarkdownContent(remoteFile.content);
          if (remoteHash !== contentHash) {
            results.push(
              buildDocsAssignmentResult({
                page,
                repository,
                oldWikiPath: page.path,
                newWikiPath,
                docsPath,
                docsKind,
                status: "conflict",
                reason: "Destination Docs file exists with different content"
              })
            );
            continue;
          }
        }

        prepared.push({
          page,
          repository,
          slug,
          folderPath,
          oldWikiPath: page.path,
          newWikiPath,
          docsPath,
          docsKind,
          contentMarkdown,
          contentHash,
          remoteFile,
          mode: remoteFile ? "linked" : "exportedToGit"
        });
      } catch (error) {
        results.push(
          buildDocsAssignmentResult({
            page,
            repository,
            oldWikiPath: page.path,
            newWikiPath,
            docsPath,
            docsKind,
            status: "error",
            reason: (error as Error).message || "Failed to inspect destination Docs file"
          })
        );
      }
    }

    const createAssignmentsByRepository = groupDocsAssignmentsByRepository(prepared);

    const commitIdByRepository = new Map<string, string>();
    const failedCreateRepositoryIds = new Set<string>();
    for (const [repositoryId, assignments] of createAssignmentsByRepository) {
      const repository = assignments[0]?.repository;
      if (!repository) {
        continue;
      }
      try {
        const commit = await this.gitlabService.commitRepositoryFileActions(
          projectId,
          user,
          repositoryId,
          assignments.map((assignment) => ({
            action: "create",
            filePath: assignment.docsPath,
            content: assignment.contentMarkdown
          })),
          buildDocsAssignmentCommitMessage(assignments)
        );
        commitIdByRepository.set(repositoryId, commit.id);
      } catch (error) {
        failedCreateRepositoryIds.add(repositoryId);
        const message = (error as Error).message || "Failed to commit Docs assignment";
        for (const assignment of assignments) {
          results.push(
            buildDocsAssignmentResult({
              page: assignment.page,
              repository: assignment.repository,
              oldWikiPath: assignment.oldWikiPath,
              newWikiPath: assignment.newWikiPath,
              docsPath: assignment.docsPath,
              docsKind: assignment.docsKind,
              status: "error",
              reason: message
            })
          );
        }
      }
    }

    for (const assignment of prepared) {
      if (assignment.mode === "exportedToGit" && failedCreateRepositoryIds.has(assignment.repository.id)) {
        continue;
      }

      await this.applyPreparedDocsAssignment({
        projectId,
        assignment,
        commitId: assignment.mode === "exportedToGit" ? commitIdByRepository.get(assignment.repository.id) ?? null : null
      });
      results.push(
        buildDocsAssignmentResult({
          page: assignment.page,
          repository: assignment.repository,
          oldWikiPath: assignment.oldWikiPath,
          newWikiPath: assignment.newWikiPath,
          docsPath: assignment.docsPath,
          docsKind: assignment.docsKind,
          status: assignment.mode,
          reason: null
        })
      );
    }

    const totals = buildDocsAssignTotals(results);

    await this.auditService.log({
      userId: user.userId,
      projectId,
      entityType: "wiki_docs_assignment",
      entityId: projectId,
      action: "wiki.docs.assign",
      metadata: totals
    });

    return {
      pages: sortDocsAssignmentResults(results),
      totals
    };
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
    const contentHash = params.contentMarkdown === null ? null : hashMarkdownContent(params.contentMarkdown);
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

    const remoteHash = hashMarkdownContent(remoteFile.content);
    if (binding.gitContentHash !== remoteHash) {
      throw new ConflictException("Docs file changed in GitLab; run Docs sync before publishing.");
    }

    const contentHash = hashMarkdownContent(draft.contentMarkdown);
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

    const remoteHash = hashMarkdownContent(remoteFile.content);
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

    const prepared = buildPreparedDocsPage(prefix, file);
    const remoteHash = prepared.contentHash;
    const remoteChanged = binding.gitContentHash !== remoteHash;
    const wikiChanged = isBindingWikiChanged(binding);
    const wikiPage = binding.wikiPage;

    if (!wikiPage) {
      result.conflicts.push(buildDocsConflict({
        repositoryId: repository.id,
        docsPath: file.docsPath,
        wikiPath: prepared.wikiPath,
        reason: "Docs binding no longer points to a wiki page"
      }));
      return;
    }

    if (!(await this.ensureDocsWikiPathAvailable(projectId, prepared.wikiPath, wikiPage.id, binding.id))) {
      result.conflicts.push(buildDocsConflict({
        repositoryId: repository.id,
        docsPath: file.docsPath,
        wikiPath: prepared.wikiPath,
        reason: "Wiki path is already used by another page or Docs binding"
      }));
      return;
    }

    if (wikiPage.deletedAt) {
      if (binding.status === WIKI_DOCS_BINDING_STATUS_DELETED) {
        await this.updatePublishedPageFromDocs({ projectId, repository, binding, file, prepared, user });
        result.updatedFromGit += 1;
        return;
      }

      if (remoteChanged) {
        result.conflicts.push(buildDocsConflict({
          repositoryId: repository.id,
          docsPath: file.docsPath,
          wikiPath: prepared.wikiPath,
          reason: "Wiki page was deleted while Docs changed"
        }));
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
      result.conflicts.push(buildDocsConflict({
        repositoryId: repository.id,
        docsPath: file.docsPath,
        wikiPath: prepared.wikiPath,
        reason: "Wiki and Docs both changed since the last sync"
      }));
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

    if (isBindingWikiChanged(binding)) {
      result.conflicts.push(buildDocsConflict({
        repositoryId: repository.id,
        docsPath: binding.docsPath,
        wikiPath: binding.wikiPath,
        reason: "Docs file was deleted while Wiki changed"
      }));
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
    const unboundPages = await this.loadUnboundPublishedWikiPages(projectId);
    const {
      pagesByRepositoryId: unboundPagesByRepositoryId,
      pagesByWikiPath: unboundPagesByWikiPath,
      unassigned
    } = groupUnboundWikiPagesByRepository({ repositories, pages: unboundPages });
    const repositoryResults: WikiDocsSyncRepositoryResult[] = [];

    for (const repository of repositories) {
      const result = buildEmptyDocsSyncRepositoryResult(repository);
      repositoryResults.push(result);

      try {
        const files = await this.gitlabService.listRepositoryDocsMarkdownFiles(projectId, user, repository.id);
        const filesByPath = new Map(files.map((file) => [file.docsPath, file]));
        const seenDocsPaths = new Set<string>();
        const bindings = await this.loadDocsBindings(repository.id);
        result.structure = buildStructureCounts([
          ...files.map((file) => file.docsPath),
          ...bindings
            .filter((binding) => binding.status === WIKI_DOCS_BINDING_STATUS_ACTIVE)
            .map((binding) => binding.docsPath)
        ]);
        const bindingsByPath = new Map(bindings.map((binding) => [binding.docsPath, binding]));
        const prefix = repository.wikiDocsPrefix;
        if (!prefix) {
          throw new BadRequestException("Repository Docs prefix is missing");
        }

        for (const file of files) {
          seenDocsPaths.add(file.docsPath);
          const prepared = buildPreparedDocsPage(prefix, file);
          const binding = bindingsByPath.get(file.docsPath);

          if (!binding) {
            if (unboundPagesByWikiPath.has(prepared.wikiPath)) {
              continue;
            }

            if (!(await this.ensureDocsWikiPathAvailable(projectId, prepared.wikiPath))) {
              result.conflicts.push(buildDocsConflict({
                repositoryId: repository.id,
                docsPath: file.docsPath,
                wikiPath: prepared.wikiPath,
                reason: "Wiki path is already used by another page or Docs binding"
              }));
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

        await this.reconcileUnboundWikiPagesForRepository({
          projectId,
          repository,
          pages: unboundPagesByRepositoryId.get(repository.id) ?? [],
          filesByPath,
          user,
          result
        });

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
        exportedToGit: accumulator.exportedToGit + result.exportedToGit,
        linked: accumulator.linked + result.linked,
        deletedFromWiki: accumulator.deletedFromWiki + result.deletedFromWiki,
        deletedFromGit: accumulator.deletedFromGit + result.deletedFromGit,
        unchanged: accumulator.unchanged + result.unchanged,
        unassigned: accumulator.unassigned,
        conflicts: accumulator.conflicts + result.conflicts.length,
        errors: accumulator.errors + result.errors.length
      }),
      {
        created: 0,
        updatedFromGit: 0,
        updatedToGit: 0,
        exportedToGit: 0,
        linked: 0,
        deletedFromWiki: 0,
        deletedFromGit: 0,
        unchanged: 0,
        unassigned: unassigned.length,
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
      totals,
      unassigned
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

      const docsKind = normalizeDocsKind(dto.docsKind);
      const relativeFolderPath = normalizeFolderPath(dto.folderPath);
      folderPath = relativeFolderPath ? `${docsKind}/${prefix}/${relativeFolderPath}` : `${docsKind}/${prefix}`;
      slug = normalizeSlug(dto.slug);
      pagePath = composePath(folderPath, slug);
      docsPath = wikiPathToDocsPath(prefix, pagePath);
      docsContentHash = hashMarkdownContent(dto.contentMarkdown);
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
    const repositories = await this.ensureAllRepositoryWikiDocsPrefixes(projectId);

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
        },
        docsBinding: {
          select: {
            docsPath: true,
            repository: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });

    return buildWikiTreeNodes(
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
          docsPath: page.docsBinding?.docsPath ?? null,
          repositoryName: page.docsBinding?.repository.name ?? null,
          isUnpublished,
          updatedAt: page.updatedAt,
          hasDraftChanges,
          draftUpdatedAt: canReadDraft ? page.draft?.updatedAt ?? null : null,
          draftUpdatedBy: canReadDraft ? page.draft?.updatedBy ?? null : null
        };
      }),
      repositories
    );
  }

  async getByPath(projectId: string, path: string, user: AuthenticatedUser): Promise<WikiPageDetail> {
    const access = await this.accessService.getProjectAccess(user.userId, user.globalRole, projectId);
    const normalizedPath = normalizePath(path);

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
      page: buildWikiPageSummary(page),
      published: buildPublishedRevision(page),
      draft,
      outgoingLinks,
      backlinks: [...backlinkMap.values()].sort((left, right) => left.fromPath.localeCompare(right.fromPath)),
      docsSource: docsBinding ? buildDocsSourceView(docsBinding) : null
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
      const snippet = sanitizeSearchSnippet(row.snippet);
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
  ): Promise<WikiAssetUploadResult> {
    return this.wikiAssetsService.uploadWikiAsset(projectId, file, user);
  }

  async getWikiAssetContent(
    assetId: string,
    user: AuthenticatedUser
  ): Promise<WikiAssetContent> {
    return this.wikiAssetsService.getWikiAssetContent(assetId, user);
  }
}
