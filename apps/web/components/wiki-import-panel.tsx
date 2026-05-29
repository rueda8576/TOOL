"use client";

import { RefObject } from "react";

import { ImportWikiPagesResult } from "../lib/wiki";

export type WikiImportDraftEntry = {
  id: string;
  sourcePath: string;
  title: string;
  slug: string;
  folderPath: string;
  templateType: string;
  contentMarkdown: string;
  localConflict: boolean;
  warnings: string[];
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function composeWikiPath(folderPath: string, slug: string): string {
  return folderPath ? `${folderPath}/${slug}` : slug;
}

export function WikiImportPanel({
  importFolderInputRef,
  importFilesInputRef,
  importWarnings,
  importSummary,
  importEntries,
  importingPages,
  onEntryFieldChange,
  onRunImport,
  onClose
}: {
  importFolderInputRef: RefObject<HTMLInputElement>;
  importFilesInputRef: RefObject<HTMLInputElement>;
  importWarnings: string[];
  importSummary: ImportWikiPagesResult | null;
  importEntries: WikiImportDraftEntry[];
  importingPages: boolean;
  onEntryFieldChange: (entryId: string, field: "title" | "slug" | "folderPath" | "templateType", value: string) => void;
  onRunImport: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <section className="wiki-import-panel">
      <div className="wiki-import-toolbar">
        <button type="button" className="button button-secondary" onClick={() => importFolderInputRef.current?.click()}>
          Import folder
        </button>
        <button type="button" className="button button-secondary" onClick={() => importFilesInputRef.current?.click()}>
          Import files
        </button>
      </div>

      <p className="wiki-import-copy">
        Batch import creates draft-only pages. Review title, slug, folder path, and optional template before creating them.
      </p>

      {importWarnings.length > 0 ? (
        <div className="alert alert-info">
          <ul className="list">
            {importWarnings.map((warning) => (
              <li key={warning} className="list-item">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {importSummary ? (
        <div className="wiki-import-summary">
          <p className="alert alert-success">
            Created {importSummary.created.length} page(s), skipped {importSummary.skipped.length}.
          </p>
          {importSummary.skipped.length > 0 ? (
            <ul className="list">
              {importSummary.skipped.map((entry) => (
                <li key={`${entry.sourcePath}-${entry.path}`} className="list-item">
                  <strong>{entry.sourcePath}</strong>
                  <span className="wiki-page-path">/{entry.path}</span>
                  <span>Skipped: {entry.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {importEntries.length > 0 ? (
        <div className="wiki-import-review-list">
          {importEntries.map((entry) => (
            <article key={entry.id} className="wiki-import-entry">
              <div className="wiki-import-entry-header">
                <strong>{entry.sourcePath}</strong>
                {entry.localConflict ? <span className="badge">Path exists</span> : <span className="badge">Draft only</span>}
              </div>
              <label>
                Title
                <input
                  className="input"
                  value={entry.title}
                  maxLength={300}
                  onChange={(event) => onEntryFieldChange(entry.id, "title", event.target.value)}
                  disabled={importingPages}
                />
              </label>
              <label>
                Slug
                <input
                  className="input"
                  value={entry.slug}
                  maxLength={120}
                  onChange={(event) => onEntryFieldChange(entry.id, "slug", event.target.value)}
                  disabled={importingPages}
                />
              </label>
              <label>
                Folder path
                <input
                  className="input"
                  value={entry.folderPath}
                  maxLength={300}
                  onChange={(event) => onEntryFieldChange(entry.id, "folderPath", event.target.value)}
                  placeholder="research/methods"
                  disabled={importingPages}
                />
              </label>
              <label>
                Template type
                <input
                  className="input"
                  value={entry.templateType}
                  maxLength={120}
                  onChange={(event) => onEntryFieldChange(entry.id, "templateType", event.target.value)}
                  placeholder="paper-review"
                  disabled={importingPages}
                />
              </label>
              <p className="wiki-page-path">/{composeWikiPath(entry.folderPath, slugify(entry.slug) || entry.slug)}</p>
              {entry.warnings.length > 0 ? (
                <ul className="list">
                  {entry.warnings.map((warning) => (
                    <li key={`${entry.id}-${warning}`} className="list-item">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="alert alert-info">Choose a folder or a group of Markdown files to prepare the import.</p>
      )}

      <div className="inline-actions">
        <button className="button" type="button" onClick={onRunImport} disabled={importingPages || importEntries.length === 0}>
          {importingPages ? "Importing..." : "Create draft-only pages"}
        </button>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={importingPages}>
          Close
        </button>
      </div>
    </section>
  );
}
