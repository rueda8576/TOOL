import Link from "next/link";

import { AppShell } from "../../../components/app-shell";
import { ProjectSubtitle } from "../../../components/project-subtitle";

export default function ProjectDetailPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  return (
    <AppShell
      title="Project"
      subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Core modules for docs, tasks, wiki, and meeting operations." />}
      projectId={params.projectId}
    >
      <section className="grid cols-2">
        <article className="panel module-card">
          <h3>Knowledge</h3>
          <p>Markdown wiki with linear revision history and templates.</p>
          <Link className="badge" href={`/projects/${params.projectId}/wiki`}>
            Open wiki
          </Link>
        </article>
        <article className="panel module-card">
          <h3>Research Documents</h3>
          <p>PDF viewer plus LaTeX bundle uploads and server-side compilation.</p>
          <Link className="badge" href={`/projects/${params.projectId}/documents`}>
            Open documents
          </Link>
        </article>
        <article className="panel module-card">
          <h3>Tasks</h3>
          <p>Kanban states, dependencies and hierarchical subtasks.</p>
          <Link className="badge" href={`/projects/${params.projectId}/tasks`}>
            Open tasks
          </Link>
        </article>
        <article className="panel module-card">
          <h3>Meetings</h3>
          <p>Structured minutes with follow-up actions linked to tasks.</p>
          <Link className="badge" href={`/projects/${params.projectId}/meetings`}>
            Open meetings
          </Link>
        </article>
      </section>
    </AppShell>
  );
}
