"use client";

import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Code2,
  FileText,
  GitBranch,
  ListChecks,
  ShieldCheck
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "../../../components/app-shell";
import { Alert, Badge, EmptyState, LoadingState } from "../../../components/ui";
import {
  getProjectOverview,
  ProjectOverview,
  ProjectOverviewAttentionItem,
  ProjectOverviewModule,
  ProjectOverviewSeverity
} from "../../../lib/project-overview";

type ModuleCard = {
  id: ProjectOverviewModule;
  label: string;
  href: string;
  icon: LucideIcon;
  metric: string;
  detail: string;
  status: string;
};

const MODULE_ICONS: Record<ProjectOverviewModule, LucideIcon> = {
  wiki: BookOpen,
  documents: FileText,
  code: Code2,
  tasks: ListChecks,
  meetings: CalendarDays,
  project: ShieldCheck
};

const MODULE_LABELS: Record<ProjectOverviewModule, string> = {
  wiki: "Wiki",
  documents: "Documents",
  code: "Code",
  tasks: "Tasks",
  meetings: "Meetings",
  project: "Project"
};

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return "Not recorded";
  }
  return new Date(dateString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) {
    return "Not recorded";
  }
  return new Date(dateString).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTitleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function severityIcon(severity: ProjectOverviewSeverity): LucideIcon {
  if (severity === "danger") {
    return CircleAlert;
  }
  if (severity === "warning") {
    return AlertTriangle;
  }
  return Clock3;
}

function moduleHref(projectId: string, module: ProjectOverviewModule): string {
  switch (module) {
    case "wiki":
      return `/projects/${projectId}/wiki`;
    case "documents":
      return `/projects/${projectId}/documents`;
    case "code":
      return `/projects/${projectId}/code`;
    case "tasks":
      return `/projects/${projectId}/tasks`;
    case "meetings":
      return `/projects/${projectId}/meetings`;
    default:
      return `/projects/${projectId}`;
  }
}

function buildModuleCards(projectId: string, overview: ProjectOverview): ModuleCard[] {
  const { modules } = overview;
  return [
    {
      id: "wiki",
      label: "Wiki",
      href: moduleHref(projectId, "wiki"),
      icon: BookOpen,
      metric: `${modules.wiki.publishedPages} published`,
      detail: modules.wiki.draftPages > 0 ? `${modules.wiki.draftPages} draft page${modules.wiki.draftPages === 1 ? "" : "s"} need review` : "Knowledge base is published",
      status: modules.wiki.latestUpdatedAt ? `Updated ${formatDate(modules.wiki.latestUpdatedAt)}` : "No pages yet"
    },
    {
      id: "documents",
      label: "Documents",
      href: moduleHref(projectId, "documents"),
      icon: FileText,
      metric: `${modules.documents.total} document${modules.documents.total === 1 ? "" : "s"}`,
      detail:
        modules.documents.failedCompiles > 0
          ? `${modules.documents.failedCompiles} compile issue${modules.documents.failedCompiles === 1 ? "" : "s"}`
          : `${modules.documents.runningCompiles} compile${modules.documents.runningCompiles === 1 ? "" : "s"} running`,
      status: modules.documents.latestUpdatedAt ? `Updated ${formatDate(modules.documents.latestUpdatedAt)}` : "No documents yet"
    },
    {
      id: "code",
      label: "Code",
      href: moduleHref(projectId, "code"),
      icon: Code2,
      metric: modules.code.connected ? `${modules.code.repositoryCount} repositor${modules.code.repositoryCount === 1 ? "y" : "ies"}` : "No repositories",
      detail: modules.code.latestRepository?.pathWithNamespace ?? "Managed GitLab repositories are not provisioned",
      status: modules.code.latestRepository ? `Latest ${modules.code.latestRepository.defaultBranch}` : "Open Code to provision"
    },
    {
      id: "tasks",
      label: "Tasks",
      href: moduleHref(projectId, "tasks"),
      icon: ListChecks,
      metric: `${modules.tasks.open} open`,
      detail: `${modules.tasks.inProgress} in progress - ${modules.tasks.blocked} blocked`,
      status: modules.tasks.overdue > 0 ? `${modules.tasks.overdue} overdue` : `${modules.tasks.critical} critical`
    },
    {
      id: "meetings",
      label: "Meetings",
      href: moduleHref(projectId, "meetings"),
      icon: CalendarDays,
      metric: `${modules.meetings.thisMonth} this month`,
      detail: `${modules.meetings.upcoming} upcoming - ${modules.meetings.openActions} open actions`,
      status: modules.meetings.next[0] ? `Next ${formatDateTime(modules.meetings.next[0].scheduledAt)}` : "No upcoming meetings"
    }
  ];
}

function AttentionItem({ item }: { item: ProjectOverviewAttentionItem }): JSX.Element {
  const Icon = severityIcon(item.severity);
  const ModuleIcon = MODULE_ICONS[item.module];
  return (
    <li className={`overview-attention-item overview-attention-${item.severity}`}>
      <Link className="overview-attention-link" href={item.href}>
        <span className="overview-attention-icon" aria-hidden="true">
          <Icon size={17} />
        </span>
        <span className="overview-attention-copy">
          <span className="overview-attention-title">{item.title}</span>
          <span className="overview-attention-detail">{item.detail}</span>
        </span>
        <span className="overview-attention-meta">
          <ModuleIcon size={14} aria-hidden="true" />
          {MODULE_LABELS[item.module]}
        </span>
      </Link>
    </li>
  );
}

export default function ProjectDetailPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  const router = useRouter();
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(
    async (authToken: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        setOverview(await getProjectOverview(params.projectId, authToken));
      } catch (overviewError) {
        setError((overviewError as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [params.projectId]
  );

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    void loadOverview(storedToken);
  }, [loadOverview, router]);

  const moduleCards = useMemo(() => (overview ? buildModuleCards(params.projectId, overview) : []), [overview, params.projectId]);
  const nextTasks = overview?.modules.tasks.next ?? [];
  const nextMeetings = overview?.modules.meetings.next ?? [];

  return (
    <AppShell projectId={params.projectId}>
      <section className="overview-command-center">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {loading ? <LoadingState title="Loading project overview" detail="Collecting project state, attention items, module summaries, and provenance." /> : null}

        {!loading && overview ? (
          <>
            <section className="overview-command-band panel module-entry-panel">
              <div className="overview-command-main module-entry-main">
                <p className="eyebrow">Atlasium project archive</p>
                <h2>{overview.project.key} - {overview.project.name}</h2>
                <p className="module-entry-summary">{overview.project.description ?? "Live workspace for documents, wiki knowledge, code, meetings, tasks, and traceability."}</p>
              </div>
              <div className="overview-command-state module-entry-state" aria-label="Project status summary">
                <Badge>{formatTitleCase(overview.access.projectRole)}</Badge>
                <Badge>{overview.access.canWrite ? "Writable" : "Read only"}</Badge>
                <Badge>{overview.attention.length} attention</Badge>
                <Badge>{overview.modules.tasks.open} open tasks</Badge>
              </div>
            </section>

            <div className="overview-command-layout">
              <section className="panel overview-attention-panel" aria-labelledby="overview-attention-title">
                <div className="overview-panel-heading">
                  <div>
                    <p className="eyebrow">Attention</p>
                    <h3 id="overview-attention-title" className="section-heading">What needs review</h3>
                  </div>
                  <Badge>{overview.attention.length} signal{overview.attention.length === 1 ? "" : "s"}</Badge>
                </div>
                {overview.attention.length === 0 ? (
                  <EmptyState
                    title="No urgent project signals"
                    detail="The archive has no failed compiles, overdue tasks, blocked work, or upcoming review warnings right now."
                  />
                ) : (
                  <ul className="overview-attention-list">
                    {overview.attention.map((item) => (
                      <AttentionItem key={item.id} item={item} />
                    ))}
                  </ul>
                )}
              </section>

              <aside className="overview-next-panel panel" aria-labelledby="overview-next-title">
                <div className="overview-panel-heading">
                  <div>
                    <p className="eyebrow">Next in project</p>
                    <h3 id="overview-next-title" className="section-heading">Near-term work</h3>
                  </div>
                </div>
                <div className="overview-next-section">
                  <h4>Tasks</h4>
                  {nextTasks.length === 0 ? <p className="text-muted">No open tasks.</p> : null}
                  {nextTasks.map((task) => (
                    <Link key={task.id} className="overview-next-item" href={moduleHref(params.projectId, "tasks")}>
                      <span>
                        <strong>{task.title}</strong>
                        <span>{task.assigneeName ?? "Unassigned"} - {formatTitleCase(task.status)}</span>
                      </span>
                      <Badge>{task.dueDate ? formatDate(task.dueDate) : formatTitleCase(task.priority)}</Badge>
                    </Link>
                  ))}
                </div>
                <div className="overview-next-section">
                  <h4>Meetings</h4>
                  {nextMeetings.length === 0 ? <p className="text-muted">No meetings in the next seven days.</p> : null}
                  {nextMeetings.map((meeting) => (
                    <Link
                      key={meeting.id}
                      className="overview-next-item"
                      href={`/projects/${params.projectId}/meetings?view=calendar&date=${meeting.scheduledDate}`}
                    >
                      <span>
                        <strong>{meeting.title}</strong>
                        <span>{meeting.location ?? "No location"} - {meeting.actionsCount} action{meeting.actionsCount === 1 ? "" : "s"}</span>
                      </span>
                      <Badge>{formatDateTime(meeting.scheduledAt)}</Badge>
                    </Link>
                  ))}
                </div>
              </aside>
            </div>

            <section className="overview-module-strip" aria-label="Project modules">
              {moduleCards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link key={card.id} className="overview-module-card panel" href={card.href}>
                    <span className="overview-module-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="overview-module-copy">
                      <span className="overview-module-label">{card.label}</span>
                      <strong>{card.metric}</strong>
                      <span>{card.detail}</span>
                      <small>{card.status}</small>
                    </span>
                  </Link>
                );
              })}
            </section>

            <section className="panel overview-provenance-panel" aria-labelledby="overview-provenance-title">
              <div className="overview-panel-heading">
                <div>
                  <p className="eyebrow">Recent provenance</p>
                  <h3 id="overview-provenance-title" className="section-heading">Archive activity</h3>
                </div>
                <GitBranch size={18} aria-hidden="true" />
              </div>
              {overview.activity.length === 0 ? (
                <EmptyState title="No recorded activity yet" detail="Project activity will appear here as documents, wiki pages, code, tasks, and meetings evolve." />
              ) : (
                <ol className="overview-activity-list">
                  {overview.activity.map((entry) => {
                    const Icon = MODULE_ICONS[entry.module];
                    return (
                      <li key={entry.id} className="overview-activity-item">
                        <Link href={entry.href}>
                          <span className="overview-activity-icon" aria-hidden="true">
                            <Icon size={15} />
                          </span>
                          <span>
                            <strong>{entry.title}</strong>
                            <span>{MODULE_LABELS[entry.module]} - {formatDateTime(entry.occurredAt)}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <section className="overview-archive-footer" aria-label="Project archive coverage">
              <span><CheckCircle2 size={15} aria-hidden="true" /> Wiki {overview.modules.wiki.publishedPages}</span>
              <span><CheckCircle2 size={15} aria-hidden="true" /> Documents {overview.modules.documents.total}</span>
              <span><CheckCircle2 size={15} aria-hidden="true" /> Code {overview.modules.code.connected ? "ready" : "pending"}</span>
              <span><CheckCircle2 size={15} aria-hidden="true" /> Meetings {overview.modules.meetings.thisMonth}</span>
            </section>
          </>
        ) : null}
      </section>
    </AppShell>
  );
}
