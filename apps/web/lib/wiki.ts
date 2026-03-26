import { API_BASE_URL, authFetch } from "./client-api";

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

export type WikiRevisionSummary = {
  id: string;
  revisionNumber: number;
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

export type CreateWikiPageInput = {
  title: string;
  slug: string;
  folderPath?: string;
  templateType?: string;
  contentMarkdown: string;
};

export type SaveWikiDraftInput = {
  title: string;
  contentMarkdown: string;
  baseDraftVersion: number;
};

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

export class WikiDraftConflictError extends Error {
  readonly currentDraft: DraftConflictPayload;

  constructor(message: string, currentDraft: DraftConflictPayload) {
    super(message);
    this.name = "WikiDraftConflictError";
    this.currentDraft = currentDraft;
  }
}

async function authRequestRaw(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...(init ?? {}),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
}

function replaceMathDelimitersOutsideCodeSpans(markdown: string): string {
  let index = 0;
  let result = "";
  let buffer = "";

  const flushBuffer = (): void => {
    if (!buffer) {
      return;
    }

    const withDisplayMath = buffer.replace(/\\\[([\s\S]*?)\\\]/g, (_match, content: string) => {
      const trimmedContent = content.trim();
      return trimmedContent ? `\n$$\n${trimmedContent}\n$$\n` : "\n$$\n$$\n";
    });
    result += withDisplayMath.replace(/\\\((.+?)\\\)/g, (_match, content: string) => `$${content.trim()}$`);
    buffer = "";
  };

  while (index < markdown.length) {
    if (markdown[index] !== "`") {
      buffer += markdown[index];
      index += 1;
      continue;
    }

    flushBuffer();

    let tickCount = 1;
    while (markdown[index + tickCount] === "`") {
      tickCount += 1;
    }

    const fence = "`".repeat(tickCount);
    const closingIndex = markdown.indexOf(fence, index + tickCount);
    if (closingIndex === -1) {
      result += markdown.slice(index);
      return result;
    }

    result += markdown.slice(index, closingIndex + tickCount);
    index = closingIndex + tickCount;
  }

  flushBuffer();
  return result;
}

function normalizeWikiPath(rawPath: string): string {
  return rawPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

export function normalizeWikiMathMarkdown(markdown: string): string {
  if (!markdown.includes("\\[") && !markdown.includes("\\(")) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const normalizedLines: string[] = [];
  const textBuffer: string[] = [];
  let activeFenceMarker: string | null = null;

  const flushTextBuffer = (): void => {
    if (textBuffer.length === 0) {
      return;
    }
    normalizedLines.push(replaceMathDelimitersOutsideCodeSpans(textBuffer.join("\n")));
    textBuffer.length = 0;
  };

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(```+|~~~+)/);

    if (activeFenceMarker) {
      normalizedLines.push(line);
      if (fenceMatch && fenceMatch[1] === activeFenceMarker) {
        activeFenceMarker = null;
      }
      continue;
    }

    if (fenceMatch) {
      flushTextBuffer();
      activeFenceMarker = fenceMatch[1];
      normalizedLines.push(line);
      continue;
    }

    textBuffer.push(line);
  }

  flushTextBuffer();
  return normalizedLines.join("\n");
}

async function parseError(response: Response): Promise<Error> {
  const rawText = await response.text();
  try {
    const payload = JSON.parse(rawText) as { message?: string | string[]; currentDraft?: DraftConflictPayload };
    const message = Array.isArray(payload.message) ? payload.message.join(", ") : payload.message ?? rawText;
    if (response.status === 409 && payload.currentDraft) {
      return new WikiDraftConflictError(message, payload.currentDraft);
    }
    return new Error(message);
  } catch {
    return new Error(rawText);
  }
}

export async function listWikiTree(projectId: string, token: string): Promise<WikiTreeNode[]> {
  return authFetch<WikiTreeNode[]>(`/projects/${projectId}/wiki-pages/tree`, { token });
}

export async function getWikiPageByPath(projectId: string, path: string, token: string): Promise<WikiPageDetail> {
  const normalizedPath = normalizeWikiPath(path);
  return authFetch<WikiPageDetail>(`/projects/${projectId}/wiki-pages/by-path?path=${encodeURIComponent(normalizedPath)}`, {
    token
  });
}

export async function createWikiPage(
  projectId: string,
  token: string,
  payload: CreateWikiPageInput
): Promise<{ id: string; projectId: string; slug: string; title: string; path: string; revisionNumber: number }> {
  return authFetch<{ id: string; projectId: string; slug: string; title: string; path: string; revisionNumber: number }>(
    `/projects/${projectId}/wiki-pages`,
    {
      token,
      init: {
        method: "POST",
        body: JSON.stringify(payload)
      }
    }
  );
}

export async function saveWikiDraft(
  pageId: string,
  token: string,
  payload: SaveWikiDraftInput
): Promise<{ draftVersion: number; updatedAt: string; updatedBy: WikiUserSummary }> {
  const response = await authRequestRaw(`/wiki-pages/${pageId}/draft`, token, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<{ draftVersion: number; updatedAt: string; updatedBy: WikiUserSummary }>;
}

export async function flushWikiRealtimeDraft(
  pageId: string,
  token: string
): Promise<{ draftVersion: number; updatedAt: string; updatedBy: WikiUserSummary }> {
  const response = await authRequestRaw(`/wiki-pages/${pageId}/realtime-flush`, token, {
    method: "POST"
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<{ draftVersion: number; updatedAt: string; updatedBy: WikiUserSummary }>;
}

export async function publishWikiPage(
  pageId: string,
  token: string,
  payload: PublishWikiPageInput
): Promise<{ pageId: string; revisionNumber: number; publishedAt: string; draftVersion: number }> {
  const response = await authRequestRaw(`/wiki-pages/${pageId}/publish`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<{ pageId: string; revisionNumber: number; publishedAt: string; draftVersion: number }>;
}

export async function deleteWikiPage(pageId: string, token: string): Promise<{ id: string; deletedAt: string }> {
  const response = await authRequestRaw(`/wiki-pages/${pageId}`, token, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<{ id: string; deletedAt: string }>;
}

export async function listWikiRevisions(pageId: string, token: string): Promise<WikiRevisionSummary[]> {
  return authFetch<WikiRevisionSummary[]>(`/wiki-pages/${pageId}/revisions`, { token });
}

export async function listWikiBacklinks(pageId: string, token: string): Promise<WikiBacklinkView[]> {
  return authFetch<WikiBacklinkView[]>(`/wiki-pages/${pageId}/backlinks`, { token });
}

export async function searchWikiPages(
  projectId: string,
  token: string,
  params: { q: string; limit?: number }
): Promise<WikiSearchResult[]> {
  const searchParams = new URLSearchParams();
  searchParams.set("q", params.q);
  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }
  return authFetch<WikiSearchResult[]>(`/projects/${projectId}/wiki-pages/search?${searchParams.toString()}`, { token });
}

export async function uploadWikiAsset(
  projectId: string,
  token: string,
  file: File
): Promise<{ assetId: string; url: string; mimeType: string; sizeBytes: number; originalName: string }> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await authRequestRaw(`/projects/${projectId}/wiki-assets`, token, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<{ assetId: string; url: string; mimeType: string; sizeBytes: number; originalName: string }>;
}
