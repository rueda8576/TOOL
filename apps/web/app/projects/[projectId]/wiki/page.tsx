import { AppShell } from "../../../../components/app-shell";
import { ProjectSubtitle } from "../../../../components/project-subtitle";

export default function ProjectWikiPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  return (
    <AppShell
      title="Wiki"
      subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Markdown pages with revision timeline." />}
      projectId={params.projectId}
    >
      <section className="panel">
        <h2 className="section-heading">Page templates</h2>
        <ul className="list">
          <li className="list-item">
            <strong>Meeting minutes template</strong>
            <p>Agenda, attendees, decisions, action items, and references.</p>
          </li>
          <li className="list-item">
            <strong>Paper review template</strong>
            <p>Problem, method, strengths, weaknesses, and future work.</p>
          </li>
        </ul>
      </section>
    </AppShell>
  );
}
