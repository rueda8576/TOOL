"use client";

import { LoadingState } from "./ui";
import { WikiHistoryDiff } from "./wiki-history-diff";
import { WikiPageDetail, WikiRevisionSummary, WikiRevisionView } from "../lib/wiki";

function timeLabel(dateIso: string | null | undefined): string {
  if (!dateIso) {
    return "n/a";
  }
  return new Date(dateIso).toLocaleString();
}

export function WikiHistory({
  pageDetail,
  revisions,
  selectedRevisionId,
  selectedRevisionPreview,
  baseRevisionSummary,
  baseRevisionPreview,
  loadingHistory,
  loadingRevisionPreview,
  historyError,
  onSelectRevision
}: {
  pageDetail: WikiPageDetail;
  revisions: WikiRevisionSummary[];
  selectedRevisionId: string | null;
  selectedRevisionPreview: WikiRevisionView | null;
  baseRevisionSummary: WikiRevisionSummary | null;
  baseRevisionPreview: WikiRevisionView | null;
  loadingHistory: boolean;
  loadingRevisionPreview: boolean;
  historyError: string | null;
  onSelectRevision: (revisionId: string) => void;
}): JSX.Element {
  return (
    <section className="wiki-history-mode">
      <div className="wiki-history-mode-header">
        <div>
          <h4 className="section-heading">Revision history</h4>
          <p className="wiki-page-path">Read-only line diff against the previous published revision.</p>
        </div>
        {selectedRevisionPreview ? (
          <div className="wiki-history-preview-meta">
            <span className="badge">Revision #{selectedRevisionPreview.revisionNumber}</span>
            {pageDetail.published?.id === selectedRevisionPreview.id ? <span className="badge">Current</span> : null}
            <span>{timeLabel(selectedRevisionPreview.publishedAt)}</span>
            <span title={selectedRevisionPreview.createdBy.email}>By {selectedRevisionPreview.createdBy.name}</span>
            {selectedRevisionPreview.changeNote ? <span>Note: {selectedRevisionPreview.changeNote}</span> : null}
          </div>
        ) : null}
      </div>

      {loadingHistory ? <p className="alert alert-info">Loading revisions...</p> : null}
      {historyError ? <p className="alert alert-error">{historyError}</p> : null}
      {!loadingHistory && revisions.length === 0 ? <p className="alert alert-info">No revisions available.</p> : null}
      {!loadingHistory && revisions.length > 0 ? (
        <div className="wiki-history-layout">
          <div className="wiki-history-timeline">
            <ul className="wiki-history-list">
              {revisions.map((revision) => {
                const isActiveRevision = selectedRevisionId === revision.id;
                const isCurrentRevision = pageDetail.published?.id === revision.id;
                return (
                  <li key={revision.id}>
                    <button
                      type="button"
                      className={isActiveRevision ? "wiki-history-item wiki-history-item-active" : "wiki-history-item"}
                      onClick={() => onSelectRevision(revision.id)}
                    >
                      <div className="wiki-history-item-top">
                        <strong>Revision #{revision.revisionNumber}</strong>
                        {isCurrentRevision ? <span className="badge">Current</span> : null}
                      </div>
                      <div className="wiki-history-item-meta">
                        <span>{timeLabel(revision.publishedAt)}</span>
                        <span title={revision.createdBy.email}>By {revision.createdBy.name}</span>
                        {revision.changeNote ? <span>Note: {revision.changeNote}</span> : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="wiki-history-preview">
            {loadingRevisionPreview && (!selectedRevisionPreview || (baseRevisionSummary && !baseRevisionPreview)) ? (
              <LoadingState title="Loading revision diff" detail="Preparing the published change comparison." />
            ) : null}
            {!loadingRevisionPreview && !selectedRevisionPreview && selectedRevisionId ? (
              <p className="alert alert-info">Select a revision to inspect its published changes.</p>
            ) : null}
            {selectedRevisionPreview && (!baseRevisionSummary || baseRevisionPreview) ? (
              <>
                <div className="wiki-history-diff-meta">
                  <span className="badge">
                    {baseRevisionSummary ? `Compared with revision #${baseRevisionSummary.revisionNumber}` : "Initial revision"}
                  </span>
                  {baseRevisionPreview ? <span>{timeLabel(baseRevisionPreview.publishedAt)}</span> : null}
                  {baseRevisionPreview ? <span title={baseRevisionPreview.createdBy.email}>Base by {baseRevisionPreview.createdBy.name}</span> : null}
                </div>
                <WikiHistoryDiff
                  original={baseRevisionPreview?.contentMarkdown ?? ""}
                  modified={selectedRevisionPreview.contentMarkdown}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
