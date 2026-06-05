"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ArchiveIndex, ArchiveRow, LoadingState, MetadataStrip, WorkspaceHeader } from "../../../../components/ui";
import {
  createDocumentVersionUpload,
  createProjectDocument,
  deleteDocument,
  DocumentListItem,
  DOCUMENTS_FLASH_SUCCESS_KEY,
  DocumentTypeValue,
  listProjectDocuments
} from "../../../../lib/documents";
import { getProjectAccess, ProjectAccess } from "../../../../lib/project-access";
import { useConfirmDialog } from "../../../../lib/use-confirm-dialog";

const documentTypes: Array<{ value: DocumentTypeValue; label: string }> = [
  { value: "paper", label: "Paper" },
  { value: "manual", label: "Manual" },
  { value: "model", label: "Model" },
  { value: "draft", label: "Draft" },
  { value: "minutes", label: "Minutes" },
  { value: "other", label: "Other" }
];

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
  const { confirm, confirmDialog } = useConfirmDialog();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [projectAccess, setProjectAccess] = useState<ProjectAccess | null>(null);
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
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const canWrite = projectAccess?.canWrite ?? false;

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

  const loadAccess = useCallback(
    async (authToken: string): Promise<void> => {
      try {
        const access = await getProjectAccess(params.projectId, authToken);
        setProjectAccess(access);
      } catch (fetchError) {
        setProjectAccess(null);
        setError((fetchError as Error).message);
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
    const flashSuccess = sessionStorage.getItem(DOCUMENTS_FLASH_SUCCESS_KEY);
    if (!flashSuccess) {
      return;
    }
    sessionStorage.removeItem(DOCUMENTS_FLASH_SUCCESS_KEY);
    setSuccess(flashSuccess);
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    void loadAccess(storedToken);
    void loadDocuments(storedToken);
  }, [loadAccess, loadDocuments, router]);

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

    if (!canWrite) {
      setError("You do not have write access to this project.");
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

  const onDeleteDocument = async (document: DocumentListItem): Promise<void> => {
    if (!token || !canWrite) {
      return;
    }

    const confirmed = await confirm({
      title: "Delete document",
      message: `Delete document "${document.title}"?`,
      confirmLabel: "Delete document",
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    setDeletingDocumentId(document.id);
    setError(null);
    setSuccess(null);

    try {
      await deleteDocument(document.id, token);
      setSuccess(`Deleted document "${document.title}".`);
      await loadDocuments(token);
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setDeletingDocumentId(null);
    }
  };

  return (
    <AppShell projectId={params.projectId}>
      <section className="panel module-entry-panel documents-page-toolbar">
        <WorkspaceHeader
          eyebrow="Documents"
          title="Document library"
          summary="Manage PDF and LaTeX archives, versions, compile state, and project document provenance."
          titleLevel="h2"
          metadata={
            <MetadataStrip
              items={[
                `${documents.length} document${documents.length === 1 ? "" : "s"}`,
                canWrite ? "Writable" : "Read only"
              ]}
            />
          }
          actions={canWrite ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setShowForm((current) => !current);
              }}
            >
              {showForm ? "Close" : "New document"}
            </button>
          ) : null}
        />
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

      {showForm && canWrite ? (
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
                  disabled={!canWrite || submitting}
                />
              </label>
              <label>
                Type
                <select
                  className="input"
                  value={type}
                  onChange={(event) => setType(event.target.value as DocumentTypeValue)}
                  disabled={!canWrite || submitting}
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
                  disabled={!canWrite || submitting}
                />
              </label>
              <label>
                Tags (comma separated)
                <input
                  className="input"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  disabled={!canWrite || submitting}
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
                disabled={!canWrite || submitting}
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
                  disabled={!canWrite || submitting}
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
                  disabled={!canWrite || submitting}
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
              <button className="button" type="submit" disabled={!canWrite || submitting}>
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
        <WorkspaceHeader
          eyebrow="Library"
          title="Documents"
          titleLevel="h3"
          metadata={newestDocument ? <MetadataStrip items={[`Most recently updated: ${newestDocument.title}`]} /> : null}
        />
        {loading ? <LoadingState title="Loading documents" detail="Preparing the project document archive." /> : null}
        {!loading && documents.length === 0 ? <p className="alert alert-info">{canWrite ? "No documents yet. Create your first one." : "No documents available yet."}</p> : null}
        {!loading && documents.length > 0 ? (
          <ArchiveIndex className="documents-library-index">
            {documents.map((document) => (
              <ArchiveRow className="documents-library-row" key={document.id}>
                <div className="archive-row-main">
                  <div className="stack-xxs">
                    <h4 className="archive-row-title">{document.title}</h4>
                    <MetadataStrip
                      items={[
                        `Type ${document.type}`,
                        document.authors.length > 0 ? `Authors ${document.authors.join(", ")}` : "No authors",
                        document.tags.length > 0 ? `Tags ${document.tags.join(", ")}` : "No tags"
                      ]}
                    />
                    {document.latestMainVersion ? (
                      <p className="archive-row-detail">
                        main v{document.latestMainVersion.versionNumber} -{" "}
                        {compileStatusLabel(document.latestMainVersion.compileStatus)}
                      </p>
                    ) : (
                      <p className="archive-row-detail">No version uploaded yet</p>
                    )}
                  </div>
                  <div className="archive-row-actions">
                    <Link className="button button-secondary" href={`/projects/${params.projectId}/documents/${document.id}`}>
                      Open
                    </Link>
                    {canWrite ? (
                      <button
                        className="button button-danger"
                        type="button"
                        onClick={() => {
                          void onDeleteDocument(document);
                        }}
                        disabled={deletingDocumentId === document.id}
                      >
                        {deletingDocumentId === document.id ? "Deleting..." : "Delete"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </ArchiveRow>
            ))}
          </ArchiveIndex>
        ) : null}
      </section>
      {confirmDialog}
    </AppShell>
  );
}
