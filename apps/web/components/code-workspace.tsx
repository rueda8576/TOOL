import { EmptyState, StatusLine } from "./ui";
import { authorInitials, relativeDate } from "../lib/code-workspace-helpers";
import type { RepositoryBranch, RepositoryCommit, RepositoryMergeRequest } from "../lib/gitlab";

export function CodeCommitList({ commits }: { commits: RepositoryCommit[] }): JSX.Element {
  return (
    <div className="code-commit-list">
      {commits.map((commit) => (
        <article key={commit.id} className="code-commit-row">
          <div className="code-commit-avatar" aria-hidden="true">{authorInitials(commit.authorName)}</div>
          <div className="code-commit-body stack-xs">
            <strong className="code-commit-title">{commit.title}</strong>
            <p className="text-muted code-commit-meta">
              {commit.authorName}
              <span className="code-meta-separator" aria-hidden="true">/</span>
              {relativeDate(commit.authoredDate)}
            </p>
          </div>
          <div className="code-commit-actions">
            <code className="code-short-id">{commit.shortId}</code>
            {commit.webUrl ? <a className="button button-secondary" href={commit.webUrl} target="_blank" rel="noreferrer">Open</a> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function CodeBranchList({
  branches,
  canWrite,
  contentError,
  contentLoading
}: {
  branches: RepositoryBranch[];
  canWrite: boolean;
  contentError: string | null;
  contentLoading: boolean;
}): JSX.Element {
  return (
    <>
      <div className="code-branch-list">
        {branches.map((branch) => (
          <div key={branch.name} className="code-branch-row">
            <div className="stack-xs">
              <strong>{branch.name}</strong>
              <div className="button-row">
                {branch.default ? <span className="badge">Default</span> : null}
                {branch.protected ? <span className="badge">Protected</span> : null}
                {branch.canPush ? <span className="badge">Writable</span> : null}
              </div>
            </div>
            {branch.webUrl ? <a className="button button-secondary" href={branch.webUrl} target="_blank" rel="noreferrer">Open</a> : null}
          </div>
        ))}
        {branches.length === 0 && !contentLoading && !contentError ? <EmptyState title="No branches found" detail="GitLab did not return repository branches for this project." /> : null}
      </div>
      {!canWrite ? <StatusLine tone="info">Reader role can browse repository content but cannot create branches.</StatusLine> : null}
    </>
  );
}

export function CodeMergeRequestList({
  canWrite,
  mergeRequests,
  mergeRequestsLoading
}: {
  canWrite: boolean;
  mergeRequests: RepositoryMergeRequest[];
  mergeRequestsLoading: boolean;
}): JSX.Element {
  return (
    <>
      <div className="code-mr-list">
        {mergeRequests.map((mr) => (
          <article key={mr.id} className="code-mr-row">
            <div className="code-mr-number text-muted">!{mr.iid}</div>
            <div className="code-mr-body stack-xs">
              <strong>{mr.title}</strong>
              <div className="button-row">
                <span className={`badge code-mr-state-${mr.state}`}>{mr.state}</span>
                {mr.draft ? <span className="badge">Draft</span> : null}
              </div>
              <p className="text-muted code-mr-meta">
                <span className="code-mr-branches">{mr.sourceBranch} - {mr.targetBranch}</span>
                <span className="code-meta-separator" aria-hidden="true">/</span>
                {mr.author ? mr.author.name : "Unknown"}
                <span className="code-meta-separator" aria-hidden="true">/</span>
                {relativeDate(mr.updatedAt)}
              </p>
            </div>
            <a className="button button-secondary" href={mr.webUrl} target="_blank" rel="noreferrer">Open</a>
          </article>
        ))}
        {!mergeRequestsLoading && mergeRequests.length === 0 ? <EmptyState title="No merge requests" detail="No merge requests match the selected state." /> : null}
      </div>
      {!canWrite ? <StatusLine tone="info">Reader role can browse repository content but cannot create merge requests.</StatusLine> : null}
    </>
  );
}
