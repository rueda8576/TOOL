export type WikiUserSummary = {
  id: string;
  name: string;
  email: string;
};

export type WikiTreeNode = {
  type: "folder" | "page";
  name: string;
  path: string;
  pageId?: string;
  title?: string;
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
  published: WikiRevisionView;
  draft?: WikiDraftView;
  outgoingLinks: WikiLinkView[];
  backlinks: WikiBacklinkView[];
};
