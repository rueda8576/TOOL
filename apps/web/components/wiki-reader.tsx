"use client";

import { MouseEvent as ReactMouseEvent, RefObject } from "react";

import { WikiMarkdown } from "./wiki-markdown";
import { WikiPageDetail } from "../lib/wiki";

function timeLabel(dateIso: string | null | undefined): string {
  if (!dateIso) {
    return "n/a";
  }
  return new Date(dateIso).toLocaleString();
}

export function WikiReader({
  projectId,
  pageDetail,
  token,
  onOpenPath,
  activeWord,
  activeWordOccurrenceIndex,
  renderedMarkdownRef,
  onRenderedWordDoubleClick
}: {
  projectId: string;
  pageDetail: WikiPageDetail;
  token: string | null;
  onOpenPath: (path: string) => void;
  activeWord?: string | null;
  activeWordOccurrenceIndex?: number;
  renderedMarkdownRef?: RefObject<HTMLElement>;
  onRenderedWordDoubleClick?: (event: ReactMouseEvent<HTMLElement>) => void;
}): JSX.Element {
  return (
    <div className="wiki-read-view">
      <div className="wiki-read-meta">
        {pageDetail.published ? (
          <>
            <span className="badge">Published revision #{pageDetail.published.revisionNumber}</span>
            <span>Published at {timeLabel(pageDetail.published.publishedAt)}</span>
            {pageDetail.published.changeNote ? <span>Note: {pageDetail.published.changeNote}</span> : null}
          </>
        ) : (
          <>
            <span className="badge">Unpublished</span>
            {pageDetail.draft ? <span>Draft updated at {timeLabel(pageDetail.draft.updatedAt)}</span> : null}
            {pageDetail.draft ? <span title={pageDetail.draft.updatedBy.email}>By {pageDetail.draft.updatedBy.name}</span> : null}
          </>
        )}
      </div>
      <article className="wiki-markdown" ref={renderedMarkdownRef} onDoubleClick={onRenderedWordDoubleClick}>
        <WikiMarkdown
          contentMarkdown={pageDetail.published ? pageDetail.published.contentMarkdown : pageDetail.draft?.contentMarkdown ?? ""}
          links={pageDetail.outgoingLinks}
          token={token}
          projectId={projectId}
          docsSource={pageDetail.docsSource}
          onNavigateWikiPath={onOpenPath}
          activeWord={activeWord}
          activeWordOccurrenceIndex={activeWordOccurrenceIndex}
        />
      </article>

      <div className="wiki-links-grid">
        <section className="status-card">
          <h4>Outgoing links</h4>
          {pageDetail.outgoingLinks.length === 0 ? (
            <p>No internal links in this page.</p>
          ) : (
            <ul className="list">
              {pageDetail.outgoingLinks.map((link) => (
                <li key={`${link.toPath}-${link.toPageId ?? "broken"}`} className="list-item">
                  {link.toPageId && link.path ? (
                    <button type="button" className="link-button" onClick={() => onOpenPath(link.path ?? link.toPath)}>
                      {link.title ?? link.path ?? link.toPath}
                    </button>
                  ) : (
                    <span className="wiki-broken-link">Broken link: [[{link.toPath}]]</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="status-card">
          <h4>Backlinks</h4>
          {pageDetail.backlinks.length === 0 ? (
            <p>No backlinks yet.</p>
          ) : (
            <ul className="list">
              {pageDetail.backlinks.map((backlink) => (
                <li key={backlink.fromPageId} className="list-item">
                  <button type="button" className="link-button" onClick={() => onOpenPath(backlink.fromPath)}>
                    {backlink.fromTitle}
                  </button>
                  <p className="wiki-page-path">/{backlink.fromPath}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
