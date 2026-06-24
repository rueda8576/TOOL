import type { RepositoryDocsMarkdownFile } from "../gitlab/gitlab.service";
import type {
  WikiDocsKind,
  WikiDocsSourceView,
  WikiDocsStructureCounts,
  WikiDocsStructureMigrationPreviewRow,
  WikiDocsSyncRepositoryResult,
  WikiDocsSyncRepositoryStatus,
  WikiDocsSyncUnassignedPage,
  WikiPageSummary,
  WikiRevisionView,
  WikiTreeNode,
  WikiUserSummary
} from "./wiki.types";
import {
  docsPathToWikiPath,
  emptyStructureCounts,
  extractDocsKindFromWikiPath,
  extractRepositoryPrefixFromWikiPath,
  getDocsPathInfo,
  legacyDocsPathToCanonicalDocsPath,
  WIKI_DOCS_ROOT
} from "./wiki-docs-paths";
import { extractTitleFromMarkdown, hashMarkdownContent, humanizeFileStem } from "./wiki-paths";

const WIKI_DOCS_BINDING_STATUS_ACTIVE = "active";
const WIKI_DOCS_KIND_LABELS: Record<WikiDocsKind, string> = {
  research: "Research",
  implementation: "Implementation"
};

export type PreparedDocsPage = {
  title: string;
  slug: string;
  folderPath: string;
  wikiPath: string;
  docsPath: string;
  contentMarkdown: string;
  contentHash: string;
};

export type WikiTreePageInput = {
  id: string;
  title: string;
  path: string;
  docsPath: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  isUnpublished: boolean;
  updatedAt: Date;
  hasDraftChanges: boolean;
  draftUpdatedAt: Date | null;
  draftUpdatedBy: WikiUserSummary | null;
};

export type WikiDocsRepositoryViewRecord = {
  id: string;
  name: string;
  pathWithNamespace: string;
  defaultBranch: string;
  wikiDocsPrefix: string | null;
  wikiDocsLastSyncedAt: Date | null;
  wikiDocsLastSyncError: string | null;
};

export type WikiPageViewRecord = {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  folderPath: string;
  path: string;
  templateType: string | null;
  updatedAt: Date;
  currentRevision: {
    id: string;
    revisionNumber: number;
    contentMarkdown: string;
    createdAt: Date;
    changeNote: string | null;
    createdBy: WikiUserSummary;
  } | null;
};

export type WikiDocsBindingViewRecord = {
  id: string;
  repositoryId: string;
  docsPath: string;
  wikiPath: string;
  status: string;
  wikiRevisionId: string | null;
  wikiContentHash: string | null;
  wikiPage: {
    id: string;
    title: string;
    path: string;
    slug: string;
    folderPath: string;
    currentRevision: {
      id: string;
      revisionNumber: number;
      contentMarkdown: string;
    } | null;
  } | null;
};

export type WikiDocsBindingWithRepositoryViewRecord = WikiDocsBindingViewRecord & {
  repository: WikiDocsRepositoryViewRecord;
};

export type WikiDocsStructureBindingViewRecord = WikiDocsBindingWithRepositoryViewRecord & {
  wikiPage: NonNullable<WikiDocsBindingViewRecord["wikiPage"]> & {
    projectId: string;
    title: string;
    draft: {
      title: string;
      contentMarkdown: string;
    } | null;
  };
};

export type WikiDocsUnboundPageViewRecord = {
  id: string;
  title: string;
  path: string;
  currentRevision: {
    id: string;
    contentMarkdown: string;
  } | null;
  draft?: {
    title: string;
    contentMarkdown: string;
  } | null;
};

export type WikiDocsConflictInput = {
  repositoryId: string;
  docsPath: string;
  wikiPath: string;
  reason: string;
};

export function buildPreparedDocsPage(prefix: string, file: RepositoryDocsMarkdownFile): PreparedDocsPage {
  const wikiPath = docsPathToWikiPath(prefix, file.docsPath);
  const segments = wikiPath.split("/");
  const slug = segments[segments.length - 1]!;
  const folderPath = segments.slice(0, -1).join("/");
  const title = extractTitleFromMarkdown(file.content, file.docsPath);

  return {
    title,
    slug,
    folderPath,
    wikiPath,
    docsPath: file.docsPath,
    contentMarkdown: file.content,
    contentHash: hashMarkdownContent(file.content)
  };
}

export function buildWikiTreeNodes(
  pages: WikiTreePageInput[],
  repositories: WikiDocsRepositoryViewRecord[]
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
  const repositoryNamesByPrefix = new Map(
    repositories
      .filter((repository) => repository.wikiDocsPrefix)
      .map((repository) => [repository.wikiDocsPrefix as string, repository.name])
  );
  const repositoriesByPrefix = new Map(
    repositories
      .filter((repository) => repository.wikiDocsPrefix)
      .map((repository) => [repository.wikiDocsPrefix as string, repository])
  );

  const orderPrefixMatch = (segment: string): RegExpMatchArray | null => segment.match(/^(\d{2,})[-_](.+)$/);

  const orderLabelForSegment = (segment: string): string | null => orderPrefixMatch(segment)?.[1] ?? null;

  const displayNameForSegment = (segment: string): string => {
    const match = orderPrefixMatch(segment);
    return humanizeFileStem(match?.[2] ?? segment).replace(/\b[a-z]/g, (character) => character.toUpperCase());
  };

  const folderDisplayName = (path: string, name: string): string | undefined => {
    if (path === "research") {
      return WIKI_DOCS_KIND_LABELS.research;
    }
    if (path === "implementation") {
      return WIKI_DOCS_KIND_LABELS.implementation;
    }
    const segments = path.split("/").filter(Boolean);
    if ((segments[0] === "research" || segments[0] === "implementation") && segments.length === 2) {
      return repositoryNamesByPrefix.get(segments[1]!) ?? name;
    }
    if (segments.length === 1) {
      return repositoryNamesByPrefix.get(segments[0]!) ?? undefined;
    }
    return displayNameForSegment(name);
  };

  const applyFolderMetadata = (folderNode: MutableNode, path: string, name: string): void => {
    const segments = path.split("/").filter(Boolean);
    const folderDocsKind = extractDocsKindFromWikiPath(path);
    const displayName = folderDisplayName(path, name);
    if (displayName) {
      folderNode.displayName = displayName;
    }
    if (folderDocsKind !== "legacy") {
      folderNode.docsKind = folderDocsKind;
    }
    if (path === "research" || path === "implementation") {
      folderNode.nodeRole = "section";
      return;
    }

    const repositoryPrefix =
      (segments[0] === "research" || segments[0] === "implementation" ? segments[1] : segments[0]) ?? null;
    const repository = repositoryPrefix ? repositoriesByPrefix.get(repositoryPrefix) ?? null : null;
    if (repository && (segments.length === 1 || segments.length === 2)) {
      folderNode.nodeRole = "repository";
      folderNode.repositoryId = repository.id;
      folderNode.repositoryName = repository.name;
      folderNode.repositoryPrefix = repository.wikiDocsPrefix;
      return;
    }

    folderNode.nodeRole = "folder";
    folderNode.orderLabel = orderLabelForSegment(name);
  };

  for (const page of pages) {
    const segments = page.path.split("/");
    const folderSegments = segments.slice(0, -1);
    const pageName = segments[segments.length - 1] ?? page.path;
    const docsInfo = page.docsPath ? getDocsPathInfo(page.docsPath) : null;

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
        nodeRole: "folder",
        children: []
      };
      applyFolderMetadata(folderNode, currentPath, segment);
      folders.get(parentPath)?.children.push(folderNode);
      folders.set(currentPath, folderNode);
      parentPath = currentPath;
    }

    const parent = folders.get(parentPath) ?? root;
    const pageNode: MutableNode = {
      type: "page",
      name: pageName,
      path: page.path,
      nodeRole: "page",
      pageId: page.id,
      title: page.title,
      isUnpublished: page.isUnpublished,
      hasDraftChanges: page.hasDraftChanges,
      draftUpdatedAt: page.draftUpdatedAt?.toISOString() ?? null,
      draftUpdatedBy: page.draftUpdatedBy,
      children: []
    };
    if (docsInfo) {
      pageNode.docsKind = docsInfo.kind;
      pageNode.isDocsOverview = docsInfo.isOverview;
      pageNode.docsPath = docsInfo.docsPath;
      pageNode.docsRelativePath = docsInfo.relativePath;
      pageNode.nodeRole = docsInfo.isOverview ? "index" : "page";
    }
    if (page.repositoryName) {
      pageNode.repositoryName = page.repositoryName;
    }
    if (page.repositoryId) {
      pageNode.repositoryId = page.repositoryId;
    }
    const repositoryPrefix = extractRepositoryPrefixFromWikiPath(page.path);
    if (repositoryPrefix && repositoriesByPrefix.has(repositoryPrefix)) {
      pageNode.repositoryPrefix = repositoryPrefix;
    }
    pageNode.orderLabel = orderLabelForSegment(pageName);
    parent.children.push(pageNode);
  }

  const sortLabel = (node: MutableNode): string => (node.displayName ?? node.title ?? node.name).toLowerCase();

  const sortNodes = (nodes: MutableNode[]): MutableNode[] =>
    nodes
      .map((node) => ({
        ...node,
        children: sortNodes(node.children)
      }))
      .sort((left, right) => {
        const rootOrder = (node: MutableNode): number => {
          if (!node.path.includes("/")) {
            if (node.path === "research") {
              return 0;
            }
            if (node.path === "implementation") {
              return 1;
            }
          }
          return 2;
        };
        const roleOrder = (node: MutableNode): number => {
          if (node.nodeRole === "section") {
            return 0;
          }
          if (node.nodeRole === "repository") {
            return 1;
          }
          if (node.nodeRole === "index" || node.isDocsOverview) {
            return 2;
          }
          if (node.type === "folder") {
            return 3;
          }
          return 4;
        };
        const leftRootOrder = rootOrder(left);
        const rightRootOrder = rootOrder(right);
        if (leftRootOrder !== rightRootOrder) {
          return leftRootOrder - rightRootOrder;
        }
        const leftRoleOrder = roleOrder(left);
        const rightRoleOrder = roleOrder(right);
        if (leftRoleOrder !== rightRoleOrder) {
          return leftRoleOrder - rightRoleOrder;
        }
        const leftOrderLabel = left.orderLabel ? Number.parseInt(left.orderLabel, 10) : null;
        const rightOrderLabel = right.orderLabel ? Number.parseInt(right.orderLabel, 10) : null;
        if (leftOrderLabel !== null || rightOrderLabel !== null) {
          if (leftOrderLabel === null) {
            return 1;
          }
          if (rightOrderLabel === null) {
            return -1;
          }
          if (leftOrderLabel !== rightOrderLabel) {
            return leftOrderLabel - rightOrderLabel;
          }
        }
        return sortLabel(left).localeCompare(sortLabel(right));
      });

  return sortNodes(root.children);
}

export function buildWikiPageSummary(page: WikiPageViewRecord): WikiPageSummary {
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

export function buildPublishedRevision(page: WikiPageViewRecord): WikiRevisionView | null {
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

export function sanitizeSearchSnippet(rawSnippet: string | null | undefined): string {
  if (!rawSnippet) {
    return "";
  }
  return rawSnippet
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildDocsSourceView(binding: WikiDocsBindingWithRepositoryViewRecord): WikiDocsSourceView | null {
  const prefix = binding.repository.wikiDocsPrefix;
  if (!prefix || binding.status !== WIKI_DOCS_BINDING_STATUS_ACTIVE) {
    return null;
  }
  const docsInfo = getDocsPathInfo(binding.docsPath);

  return {
    repositoryId: binding.repositoryId,
    repositoryName: binding.repository.name,
    pathWithNamespace: binding.repository.pathWithNamespace,
    defaultBranch: binding.repository.defaultBranch,
    docsPath: binding.docsPath,
    docsRoot: WIKI_DOCS_ROOT,
    wikiPrefix: prefix,
    docsKind: docsInfo.kind,
    isOverview: docsInfo.isOverview
  };
}

export function buildSyncRepositoryStatus(
  repository: WikiDocsRepositoryViewRecord,
  active: number,
  deleted: number,
  structure: WikiDocsStructureCounts
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
    },
    structure
  };
}

export function hasStructureBindingDraftChanges(binding: WikiDocsStructureBindingViewRecord): boolean {
  return Boolean(
    binding.wikiPage.draft &&
      binding.wikiPage.currentRevision &&
      (binding.wikiPage.draft.title !== binding.wikiPage.title ||
        binding.wikiPage.draft.contentMarkdown !== binding.wikiPage.currentRevision.contentMarkdown)
  );
}

export function buildStructureMigrationRow(params: {
  binding: WikiDocsStructureBindingViewRecord;
  targetKind: WikiDocsKind;
  conflicts: string[];
}): WikiDocsStructureMigrationPreviewRow {
  const targetDocsPath = legacyDocsPathToCanonicalDocsPath(params.binding.docsPath, params.targetKind);
  const prefix = params.binding.repository.wikiDocsPrefix;
  const targetWikiPath = prefix ? docsPathToWikiPath(prefix, targetDocsPath) : params.binding.wikiPath;

  return {
    bindingId: params.binding.id,
    pageId: params.binding.wikiPage.id,
    title: params.binding.wikiPage.title,
    repositoryId: params.binding.repositoryId,
    repositoryName: params.binding.repository.name,
    currentWikiPath: params.binding.wikiPath,
    currentDocsPath: params.binding.docsPath,
    targetWikiPath,
    targetDocsPath,
    targetKind: params.targetKind,
    hasDraftChanges: hasStructureBindingDraftChanges(params.binding),
    conflicts: params.conflicts
  };
}

export function buildEmptyDocsSyncRepositoryResult(
  repository: WikiDocsRepositoryViewRecord
): WikiDocsSyncRepositoryResult {
  return {
    repositoryId: repository.id,
    name: repository.name,
    wikiDocsPrefix: repository.wikiDocsPrefix ?? "",
    structure: emptyStructureCounts(),
    created: 0,
    updatedFromGit: 0,
    updatedToGit: 0,
    exportedToGit: 0,
    linked: 0,
    deletedFromWiki: 0,
    deletedFromGit: 0,
    unchanged: 0,
    conflicts: [],
    errors: []
  };
}

export function buildDocsConflict(params: WikiDocsConflictInput): WikiDocsSyncRepositoryResult["conflicts"][number] {
  return {
    repositoryId: params.repositoryId,
    docsPath: params.docsPath,
    wikiPath: params.wikiPath,
    reason: params.reason
  };
}

export function isBindingWikiChanged(binding: WikiDocsBindingViewRecord): boolean {
  const currentRevision = binding.wikiPage?.currentRevision;
  if (!currentRevision) {
    return false;
  }
  return (
    binding.wikiRevisionId !== currentRevision.id ||
    binding.wikiContentHash !== hashMarkdownContent(currentRevision.contentMarkdown)
  );
}

export function hasUnboundPageDraftChanges(page: WikiDocsUnboundPageViewRecord): boolean {
  return Boolean(
    page.draft &&
      page.currentRevision &&
      (page.draft.title !== page.title || page.draft.contentMarkdown !== page.currentRevision.contentMarkdown)
  );
}

export function buildUnassignedDocsPages(
  pages: WikiDocsUnboundPageViewRecord[],
  repositories: WikiDocsRepositoryViewRecord[]
): WikiDocsSyncUnassignedPage[] {
  const prefixes = new Set(repositories.map((repository) => repository.wikiDocsPrefix).filter(Boolean));
  return pages
    .filter((page) => {
      const repositoryPrefix = extractRepositoryPrefixFromWikiPath(page.path);
      return !repositoryPrefix || !prefixes.has(repositoryPrefix);
    })
    .map((page) => ({
      pageId: page.id,
      wikiPath: page.path,
      title: page.title,
      hasDraftChanges: hasUnboundPageDraftChanges(page),
      reason: "Wiki page is not under any repository Docs prefix"
    }));
}

export function groupUnboundWikiPagesByRepository<TPage extends WikiDocsUnboundPageViewRecord>(params: {
  repositories: WikiDocsRepositoryViewRecord[];
  pages: TPage[];
}): {
  pagesByRepositoryId: Map<string, TPage[]>;
  pagesByWikiPath: Map<string, TPage>;
  unassigned: WikiDocsSyncUnassignedPage[];
} {
  const repositoriesByPrefix = new Map<string, WikiDocsRepositoryViewRecord>();
  for (const repository of params.repositories) {
    if (repository.wikiDocsPrefix) {
      repositoriesByPrefix.set(repository.wikiDocsPrefix, repository);
    }
  }

  const pagesByRepositoryId = new Map<string, TPage[]>();
  const pagesByWikiPath = new Map<string, TPage>();
  const unassigned: WikiDocsSyncUnassignedPage[] = [];

  for (const page of params.pages) {
    pagesByWikiPath.set(page.path, page);
    const prefix = extractRepositoryPrefixFromWikiPath(page.path) ?? "";
    const repository = repositoriesByPrefix.get(prefix);
    if (!repository) {
      unassigned.push({
        pageId: page.id,
        wikiPath: page.path,
        title: page.title,
        hasDraftChanges: hasUnboundPageDraftChanges(page),
        reason: "Wiki page is not under any repository Docs prefix"
      });
      continue;
    }

    const repositoryPages = pagesByRepositoryId.get(repository.id) ?? [];
    repositoryPages.push(page);
    pagesByRepositoryId.set(repository.id, repositoryPages);
  }

  return {
    pagesByRepositoryId,
    pagesByWikiPath,
    unassigned
  };
}
