export type WikiUserSummary = {
  id: string;
  name: string;
  email: string;
};

export type WikiDocsKind = "research" | "implementation";
export type WikiDocsStructureKind = WikiDocsKind | "legacy";

export type WikiTreeNode = {
  type: "folder" | "page";
  name: string;
  displayName?: string;
  path: string;
  pageId?: string;
  title?: string;
  isDocsOverview?: boolean;
  docsKind?: WikiDocsStructureKind;
  repositoryName?: string | null;
  isUnpublished?: boolean;
  hasDraftChanges?: boolean;
  draftUpdatedAt?: string | null;
  draftUpdatedBy?: WikiUserSummary | null;
  children: WikiTreeNode[];
};

export type WikiPageSummary = {
  id: string;
  projectId: string;
  title: string;
  slug: string;
  folderPath: string;
  path: string;
  templateType: string | null;
  updatedAt: string;
};

export type WikiRevisionView = {
  id: string;
  revisionNumber: number;
  contentMarkdown: string;
  publishedAt: string;
  createdBy: WikiUserSummary;
  changeNote: string | null;
};

export type WikiDraftView = {
  title: string;
  contentMarkdown: string;
  draftVersion: number;
  updatedAt: string;
  updatedBy: WikiUserSummary;
};

export type WikiLinkView = {
  toPath: string;
  toPageId: string | null;
  title: string | null;
  path: string | null;
};

export type WikiBacklinkView = {
  fromPageId: string;
  fromTitle: string;
  fromPath: string;
};

export type WikiSearchResult = {
  pageId: string;
  path: string;
  title: string;
  snippet: string;
  score: number;
  matches: {
    title: boolean;
    path: boolean;
    published: boolean;
    draft: boolean;
  };
  updatedAt: string;
};

export type WikiPageDetail = {
  page: WikiPageSummary;
  published: WikiRevisionView | null;
  draft?: WikiDraftView;
  outgoingLinks: WikiLinkView[];
  backlinks: WikiBacklinkView[];
  docsSource?: WikiDocsSourceView | null;
};

export type WikiDocsSourceView = {
  repositoryId: string;
  repositoryName: string;
  pathWithNamespace: string;
  defaultBranch: string;
  docsPath: string;
  docsRoot: "Docs";
  wikiPrefix: string;
  docsKind: WikiDocsStructureKind;
  isOverview: boolean;
};

export type WikiDocsStructureCounts = {
  research: number;
  implementation: number;
  legacy: number;
  migrationAvailable: boolean;
};

export type WikiDocsSyncRepositoryStatus = {
  repositoryId: string;
  name: string;
  pathWithNamespace: string;
  defaultBranch: string;
  wikiDocsPrefix: string;
  docsRoot: "Docs";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  bindings: {
    active: number;
    deleted: number;
  };
  structure: WikiDocsStructureCounts;
};

export type WikiDocsSyncStatus = {
  repositories: WikiDocsSyncRepositoryStatus[];
  unassigned: WikiDocsSyncUnassignedPage[];
};

export type WikiDocsSyncConflict = {
  repositoryId: string;
  docsPath: string;
  wikiPath: string;
  reason: string;
};

export type WikiDocsSyncUnassignedPage = {
  pageId: string;
  wikiPath: string;
  title: string;
  hasDraftChanges: boolean;
  reason: string;
};

export type WikiDocsAssignPageResult = {
  pageId: string;
  title: string;
  oldWikiPath: string;
  newWikiPath: string;
  repositoryId: string;
  repositoryName: string;
  docsPath: string;
  docsKind: WikiDocsKind;
  status: "exportedToGit" | "linked" | "conflict" | "error";
  reason: string | null;
};

export type WikiDocsAssignResult = {
  pages: WikiDocsAssignPageResult[];
  totals: {
    assigned: number;
    exportedToGit: number;
    linked: number;
    conflicts: number;
    errors: number;
  };
};

export type WikiDocsSyncRepositoryResult = {
  repositoryId: string;
  name: string;
  wikiDocsPrefix: string;
  structure: WikiDocsStructureCounts;
  created: number;
  updatedFromGit: number;
  updatedToGit: number;
  exportedToGit: number;
  linked: number;
  deletedFromWiki: number;
  deletedFromGit: number;
  unchanged: number;
  conflicts: WikiDocsSyncConflict[];
  errors: string[];
};

export type WikiDocsSyncResult = {
  repositories: WikiDocsSyncRepositoryResult[];
  totals: {
    created: number;
    updatedFromGit: number;
    updatedToGit: number;
    exportedToGit: number;
    linked: number;
    deletedFromWiki: number;
    deletedFromGit: number;
    unchanged: number;
    unassigned: number;
    conflicts: number;
    errors: number;
  };
  unassigned: WikiDocsSyncUnassignedPage[];
};

export type WikiDocsStructureMigrationPreviewRow = {
  bindingId: string;
  pageId: string;
  title: string;
  repositoryId: string;
  repositoryName: string;
  currentWikiPath: string;
  currentDocsPath: string;
  targetKind: WikiDocsKind;
  targetWikiPath: string;
  targetDocsPath: string;
  hasDraftChanges: boolean;
  conflicts: string[];
};

export type WikiDocsStructureMigrationPreview = {
  rows: WikiDocsStructureMigrationPreviewRow[];
  totals: {
    legacy: number;
    ready: number;
    conflicts: number;
  };
};

export type WikiDocsStructureMigrationResultRow = WikiDocsStructureMigrationPreviewRow & {
  status: "migrated" | "conflict" | "error";
  reason: string | null;
};

export type WikiDocsStructureMigrationResult = {
  rows: WikiDocsStructureMigrationResultRow[];
  totals: {
    migrated: number;
    conflicts: number;
    errors: number;
  };
};
