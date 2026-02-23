import Link from "next/link";

export default function HomePage(): JSX.Element {
  return (
    <main className="home-shell">
      <section className="panel home-hero">
        <p className="eyebrow">Doctoral Workspace</p>
        <h1 className="section-heading">Doctoral Platform v1</h1>
        <p className="lede">
          Self-hosted workspace for projects, Markdown wiki, PDF/LaTeX documents, Jira-style tasks, and structured
          meeting minutes.
        </p>
        <div className="home-actions">
          <Link className="button" href="/projects">
            Open workspace
          </Link>
          <Link className="button button-secondary" href="/login">
            Sign in
          </Link>
        </div>
      </section>
      <div className="grid cols-3">
        <article className="status-card">
          <p className="status-title">Documents</p>
          <p className="status-value">PDF + LaTeX</p>
          <p className="status-helper">Branching (linear), immutable versions, async compile.</p>
        </article>
        <article className="status-card">
          <p className="status-title">Tasks</p>
          <p className="status-value">Kanban Core</p>
          <p className="status-helper">Dependencies and multilevel subtasks ready for Gantt v1.1.</p>
        </article>
        <article className="status-card">
          <p className="status-title">Meetings</p>
          <p className="status-value">Structured</p>
          <p className="status-helper">Agenda, notes, action items, and task linking.</p>
        </article>
      </div>
    </main>
  );
}
