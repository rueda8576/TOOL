"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ProjectSubtitle } from "../../../../components/project-subtitle";
import { LoginResponse } from "../../../../lib/client-api";
import {
  createDocumentVersionUpload,
  createProjectDocument,
  DocumentListItem,
  DocumentTypeValue,
  listProjectDocuments
} from "../../../../lib/documents";

const documentTypes: Array<{ value: DocumentTypeValue; label: string }> = [
  { value: "paper", label: "Paper" },
  { value: "manual", label: "Manual" },
  { value: "model", label: "Model" },
  { value: "draft", label: "Draft" },
  { value: "minutes", label: "Minutes" },
  { value: "other", label: "Other" }
];

function parseStoredUser(rawUser: string | null): LoginResponse["user"] | null {
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as LoginResponse["user"];
  } catch {
    return null;
  }
}

function parseCommaSeparatedList(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function inferLatexEntryFile(latexPaths: string[]): string | undefined {
  if (latexPaths.length === 0) {
    return undefined;
  }

  const mainTexAtRoot = latexPaths.find((path) => path.toLowerCase() === "main.tex");
  if (mainTexAtRoot) {
    return mainTexAtRoot;
  }

  const mainTexNested = latexPaths.find((path) => path.toLowerCase().endsWith("/main.tex"));
  if (mainTexNested) {
    return mainTexNested;
  }

  return latexPaths.find((path) => path.toLowerCase().endsWith(".tex")) ?? undefined;
}

export default function ProjectDocumentsPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  const router = useRouter();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocumentTypeValue>("other");
  const [authors, setAuthors] = useState("");
  const [tags, setTags] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [latexFiles, setLatexFiles] = useState<File[]>([]);
  const [latexPaths, setLatexPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [retryDocumentId, setRetryDocumentId] = useState<string | null>(null);

  const isReader = userRole === "reader";

  const loadDocuments = useCallback(
    async (authToken: string): Promise<void> => {
      setLoading(true);
      try {
        const data = await listProjectDocuments(params.projectId, authToken);
        setDocuments(data);
        setError(null);
      } catch (fetchError) {
        setError((fetchError as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [params.projectId]
  );

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    setUserRole(parseStoredUser(localStorage.getItem("doctoral_user"))?.globalRole ?? null);
    void loadDocuments(storedToken);
  }, [loadDocuments, router]);

  const newestDocument = useMemo(() => documents[0] ?? null, [documents]);

  const resetForm = (): void => {
    setTitle("");
    setType("other");
    setAuthors("");
    setTags("");
    setPublishedAt("");
    setPdfFile(null);
    setLatexFiles([]);
    setLatexPaths([]);
  };

  const onFolderChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setLatexFiles(selectedFiles);
    setLatexPaths(
      selectedFiles.map((file) => {
        const extendedFile = file as File & { webkitRelativePath?: string };
        return extendedFile.webkitRelativePath && extendedFile.webkitRelativePath.length > 0
          ? extendedFile.webkitRelativePath
          : file.name;
      })
    );
  };

  const onCreateDocument = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (isReader) {
      setError("Reader role cannot create documents.");
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Document title is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setRetryDocumentId(null);

    let createdDocumentId: string | null = null;

    try {
      const created = await createProjectDocument(params.projectId, token, {
        title: trimmedTitle,
        type,
        authors: parseCommaSeparatedList(authors),
        tags: parseCommaSeparatedList(tags),
        publishedAt: publishedAt || undefined
      });
      createdDocumentId = created.id;

      await createDocumentVersionUpload(created.id, token, {
        branchName: "main",
        pdf: pdfFile ?? undefined,
        latexFiles: latexFiles.length > 0 ? latexFiles : undefined,
        latexPaths: latexFiles.length > 0 ? latexPaths : undefined,
        latexEntryFile: inferLatexEntryFile(latexPaths)
      });

      setSuccess("Document created successfully.");
      resetForm();
      setShowForm(false);
      await loadDocuments(token);
      router.push(`/projects/${params.projectId}/documents/${created.id}`);
    } catch (submitError) {
      const message = (submitError as Error).message;
      if (createdDocumentId) {
        setRetryDocumentId(createdDocumentId);
        setError(`Document created but first version upload failed: ${message}`);
        await loadDocuments(token);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const compileStatusLabel = (status: string): string => {
    switch (status) {
      case "succeeded":
        return "Compiled";
      case "running":
        return "Compiling";
      case "failed":
        return "Compile failed";
      case "timeout":
        return "Compile timeout";
      case "pending":
      default:
        return "Pending compile";
    }
  };

  return (
    <AppShell
      title="Documents"
      subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Manage document list, uploads, and LaTeX workflows." />}
      projectId={params.projectId}
    >
      <section className="panel documents-page-toolbar">
        <div className="task-toolbar-row">
          <h3 className="section-heading">Document library</h3>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              if (isReader) {
                setError("Reader role cannot create documents.");
                return;
              }
              setShowForm((current) => !current);
            }}
            disabled={isReader}
          >
            {showForm ? "Close" : "New document"}
          </button>
        </div>
        {isReader ? <p className="alert alert-info">Reader role can view documents but cannot create or upload versions.</p> : null}
        {success ? <p className="alert alert-success">{success}</p> : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
        {retryDocumentId ? (
          <p className="inline-actions">
            <Link className="button button-secondary" href={`/projects/${params.projectId}/documents/${retryDocumentId}`}>
              Open document to retry upload
            </Link>
          </p>
        ) : null}
      </section>

      {showForm ? (
        <section className="panel">
          <h3 className="section-heading">Create document</h3>
          <form className="form-grid" onSubmit={onCreateDocument}>
            <div className="grid cols-2 grid-tight">
              <label>
                Title
                <input
                  className="input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={300}
                  required
                  disabled={isReader || submitting}
                />
              </label>
              <label>
                Type
                <select
                  className="input"
                  value={type}
                  onChange={(event) => setType(event.target.value as DocumentTypeValue)}
                  disabled={isReader || submitting}
                >
                  {documentTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid cols-2 grid-tight">
              <label>
                Authors (comma separated)
                <input
                  className="input"
                  value={authors}
                  onChange={(event) => setAuthors(event.target.value)}
                  disabled={isReader || submitting}
                />
              </label>
              <label>
                Tags (comma separated)
                <input
                  className="input"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  disabled={isReader || submitting}
                />
              </label>
            </div>
            <label>
              Published at
              <input
                className="input"
                type="date"
                value={publishedAt}
                onChange={(event) => setPublishedAt(event.target.value)}
                disabled={isReader || submitting}
              />
            </label>
            <div className="grid cols-2 grid-tight">
              <label>
                PDF file (optional)
                <input
                  className="input"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)}
                  disabled={isReader || submitting}
                />
              </label>
              <label>
                LaTeX folder (optional)
                <input
                  ref={folderInputRef}
                  className="input"
                  type="file"
                  multiple
                  onChange={onFolderChange}
                  disabled={isReader || submitting}
                />
              </label>
            </div>
            {latexFiles.length > 0 ? (
              <p className="alert alert-info">Selected {latexFiles.length} LaTeX files from folder upload.</p>
            ) : null}
            <p className="documents-list-meta">
              If you upload nothing, Atlasium creates a blank LaTeX workspace with <code>main.tex</code>, <code>references.bib</code>,
              and a <code>Figures/</code> folder.
            </p>
            <div className="task-form-actions">
              <button className="button" type="submit" disabled={isReader || submitting}>
                {submitting ? "Creating..." : "Create document"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={submitting}
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <h3 className="section-heading">Documents</h3>
        {loading ? <p className="alert alert-info">Loading documents...</p> : null}
        {!loading && documents.length === 0 ? <p className="alert alert-info">No documents yet. Create your first one.</p> : null}
        {!loading && documents.length > 0 ? (
          <ul className="list">
            {documents.map((document) => (
              <li className="list-item" key={document.id}>
                <div className="documents-list-row">
                  <div>
                    <strong>{document.title}</strong>
                    <p className="documents-list-meta">
                      Type: {document.type} {document.authors.length > 0 ? `| Authors: ${document.authors.join(", ")}` : ""}
                    </p>
                    <p className="documents-list-meta">
                      {document.tags.length > 0 ? `Tags: ${document.tags.join(", ")}` : "No tags"}
                    </p>
                    {document.latestMainVersion ? (
                      <p className="documents-list-meta">
                        main v{document.latestMainVersion.versionNumber} -{" "}
                        {compileStatusLabel(document.latestMainVersion.compileStatus)}
                      </p>
                    ) : (
                      <p className="documents-list-meta">No version uploaded yet</p>
                    )}
                  </div>
                  <Link className="button button-secondary" href={`/projects/${params.projectId}/documents/${document.id}`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {!loading && newestDocument ? (
          <p className="documents-list-meta">
            Most recently updated: <strong>{newestDocument.title}</strong>
          </p>
        ) : null}
      </section>
    </AppShell>
  );
}
