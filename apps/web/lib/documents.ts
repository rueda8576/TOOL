import { API_BASE_URL, authFetch } from "./client-api";

export type DocumentTypeValue = "paper" | "manual" | "model" | "draft" | "minutes" | "other";
export type CompileStatusValue = "pending" | "running" | "succeeded" | "failed" | "timeout";

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

export type CreateDocumentInput = {
  title: string;
  type?: DocumentTypeValue;
  authors?: string[];
  tags?: string[];
  publishedAt?: string;
};

export type CreateDocumentVersionUploadInput = {
  pdf?: File;
  latexFiles?: File[];
  latexPaths?: string[];
  latexEntryFile?: string;
  notes?: string;
  branchName?: string;
};

export type DocumentVersionCompileLog = {
  documentVersionId: string;
  compileStatus: CompileStatusValue;
  compileLog: string | null;
  compiledPdfFileId: string | null;
};

function normalizeCompileStatus(status: string): CompileStatusValue {
  const normalized = status.toLowerCase();
  if (normalized === "running" || normalized === "succeeded" || normalized === "failed" || normalized === "timeout") {
    return normalized;
  }
  return "pending";
}

function normalizeVersionSummary(version: DocumentVersionSummary | null): DocumentVersionSummary | null {
  if (!version) {
    return null;
  }

  return {
    ...version,
    compileStatus: normalizeCompileStatus(version.compileStatus)
  };
}

async function requestWithFormData<T>(path: string, token: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export async function listProjectDocuments(projectId: string, token: string): Promise<DocumentListItem[]> {
  const documents = await authFetch<DocumentListItem[]>(`/projects/${projectId}/documents`, { token });
  return documents.map((document) => ({
    ...document,
    latestMainVersion: normalizeVersionSummary(document.latestMainVersion)
  }));
}

export async function getProjectDocument(projectId: string, documentId: string, token: string): Promise<DocumentDetail> {
  const document = await authFetch<DocumentDetail>(`/projects/${projectId}/documents/${documentId}`, { token });
  return {
    ...document,
    latestMainVersion: normalizeVersionSummary(document.latestMainVersion)
  };
}

export async function createProjectDocument(
  projectId: string,
  token: string,
  payload: CreateDocumentInput
): Promise<{ id: string; projectId: string; title: string; type: string; mainBranchId: string }> {
  return authFetch<{ id: string; projectId: string; title: string; type: string; mainBranchId: string }>(
    `/projects/${projectId}/documents`,
    {
      token,
      init: {
        method: "POST",
        body: JSON.stringify(payload)
      }
    }
  );
}

export async function createDocumentVersionUpload(
  documentId: string,
  token: string,
  payload: CreateDocumentVersionUploadInput
): Promise<{ id: string; documentId: string; branchId: string; versionNumber: number; compileStatus: string }> {
  const formData = new FormData();
  if (payload.branchName) {
    formData.append("branchName", payload.branchName);
  }
  if (payload.notes) {
    formData.append("notes", payload.notes);
  }
  if (payload.latexEntryFile) {
    formData.append("latexEntryFile", payload.latexEntryFile);
  }
  if (payload.pdf) {
    formData.append("pdf", payload.pdf);
  }

  if (payload.latexFiles && payload.latexFiles.length > 0) {
    for (const file of payload.latexFiles) {
      formData.append("latexFiles", file);
    }
    formData.append("latexPaths", JSON.stringify(payload.latexPaths ?? []));
  }

  return requestWithFormData<{ id: string; documentId: string; branchId: string; versionNumber: number; compileStatus: string }>(
    `/documents/${documentId}/versions`,
    token,
    formData
  );
}

export async function loadDocumentPdfBlobUrl(documentVersionId: string, token: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/document-versions/${documentVersionId}/pdf`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function compileDocumentVersion(
  documentVersionId: string,
  token: string
): Promise<{ compileJobId: string; documentVersionId: string; status: string }> {
  const response = await authFetch<{ compileJobId: string; documentVersionId: string; status: string }>(
    `/document-versions/${documentVersionId}/compile`,
    {
      token,
      init: {
        method: "POST"
      }
    }
  );
  return {
    ...response,
    status: normalizeCompileStatus(response.status)
  };
}

export async function getCompileLog(documentVersionId: string, token: string): Promise<DocumentVersionCompileLog> {
  const response = await authFetch<{
    documentVersionId: string;
    compileStatus: string;
    compileLog: string | null;
    compiledPdfFileId: string | null;
  }>(`/document-versions/${documentVersionId}/compile-log`, { token });
  return {
    ...response,
    compileStatus: normalizeCompileStatus(response.compileStatus)
  };
}

export async function getLatexTree(
  documentVersionId: string,
  token: string
): Promise<{ documentVersionId: string; files: Array<{ path: string; isDirectory: boolean }> }> {
  return authFetch<{ documentVersionId: string; files: Array<{ path: string; isDirectory: boolean }> }>(
    `/document-versions/${documentVersionId}/latex/tree`,
    { token }
  );
}

export async function getLatexFile(
  documentVersionId: string,
  filePath: string,
  token: string
): Promise<{ documentVersionId: string; path: string; content: string }> {
  return authFetch<{ documentVersionId: string; path: string; content: string }>(
    `/document-versions/${documentVersionId}/latex/file?path=${encodeURIComponent(filePath)}`,
    { token }
  );
}

export async function updateLatexFile(
  documentVersionId: string,
  filePath: string,
  content: string,
  token: string
): Promise<{ documentVersionId: string; path: string; sizeBytes: number }> {
  return authFetch<{ documentVersionId: string; path: string; sizeBytes: number }>(
    `/document-versions/${documentVersionId}/latex/file`,
    {
      token,
      init: {
        method: "PUT",
        body: JSON.stringify({ path: filePath, content })
      }
    }
  );
}
