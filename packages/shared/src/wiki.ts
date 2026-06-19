import { z } from "zod";

export const WIKI_DOCS_KINDS = ["research", "implementation"] as const;
export const WIKI_DOCS_STRUCTURE_KINDS = ["research", "implementation", "legacy"] as const;

export const WikiDocsKindSchema = z.enum(WIKI_DOCS_KINDS);
export const WikiDocsStructureKindSchema = z.enum(WIKI_DOCS_STRUCTURE_KINDS);

export type WikiUserSummary = {
  id: string;
  name: string;
  email: string;
};

export type WikiDocsKind = (typeof WIKI_DOCS_KINDS)[number];
export type WikiDocsStructureKind = (typeof WIKI_DOCS_STRUCTURE_KINDS)[number];

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

export type WikiRevisionSummary = Omit<WikiRevisionView, "contentMarkdown">;

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

export type WikiDocsAssignPageInput = {
  pageId: string;
  repositoryId: string;
  folderPath?: string;
  slug: string;
  docsKind?: WikiDocsKind;
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

export const CreateWikiPageSchema = z.object({
  title: z.string().min(1).max(300),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  folderPath: z.string().max(500).optional(),
  templateType: z.string().max(120).optional(),
  docsRepositoryId: z.string().cuid().optional(),
  docsKind: WikiDocsKindSchema.optional(),
  contentMarkdown: z.string().default("")
});

export type CreateWikiPageInput = {
  title: string;
  slug: string;
  folderPath?: string;
  templateType?: string;
  docsRepositoryId?: string;
  docsKind?: WikiDocsKind;
  contentMarkdown: string;
};

export type ImportWikiPageEntryInput = {
  title: string;
  slug: string;
  folderPath?: string;
  templateType?: string;
  contentMarkdown: string;
  sourcePath: string;
};

export type ImportWikiPagesInput = {
  entries: ImportWikiPageEntryInput[];
};

export type ImportWikiPagesResult = {
  created: Array<{ id: string; title: string; path: string; sourcePath: string }>;
  skipped: Array<{ title: string; path: string; sourcePath: string; reason: "path_exists" }>;
};

export type SaveWikiDraftInput = {
  title: string;
  contentMarkdown: string;
  baseDraftVersion: number;
};

export const UpdateWikiPageSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  contentMarkdown: z.string().min(0),
  changeNote: z.string().max(500).optional()
});

export type UpdateWikiPageInput = z.input<typeof UpdateWikiPageSchema>;

export type PublishWikiPageInput = {
  baseDraftVersion: number;
  changeNote?: string;
};

export type DraftConflictPayload = {
  title: string;
  contentMarkdown: string;
  draftVersion: number;
  updatedAt: string;
  updatedBy: WikiUserSummary;
};
