"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "../../../components/app-shell";
import { ProjectSubtitle } from "../../../components/project-subtitle";
import { DocumentListItem, listProjectDocuments } from "../../../lib/documents";
import { listProjectMeetings, MeetingListItem } from "../../../lib/meetings";
import { listProjectTasks, TaskListItem } from "../../../lib/tasks";

type CalendarDayCell = {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayKeyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDayKey(dayKey: string): Date {
  return new Date(`${dayKey}T12:00:00.000Z`);
}

function firstDayOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function lastDayOfMonth(monthStart: Date): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
}

function buildMonthCells(monthCursor: Date): CalendarDayCell[] {
  const monthStart = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth(), 1));
  const startOffset = (monthStart.getUTCDay() + 6) % 7;
  const gridStart = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth(), 1 - startOffset));
  const todayKey = dayKeyFromDate(new Date());

  const cells: CalendarDayCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const current = new Date(Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), gridStart.getUTCDate() + index));
    const dateKey = dayKeyFromDate(current);
    cells.push({
      dateKey,
      dayNumber: current.getUTCDate(),
      inCurrentMonth: current.getUTCMonth() === monthCursor.getUTCMonth(),
      isToday: dateKey === todayKey
    });
  }

  return cells;
}

function monthLabel(monthCursor: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(monthCursor);
}

function monthKey(monthStart: Date): string {
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `${monthStart.getUTCFullYear()}-${month}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString();
}

function normalizeDocumentType(type: DocumentListItem["type"]): string {
  switch (type) {
    case "paper":
      return "Paper";
    case "manual":
      return "Manual";
    case "model":
      return "Model";
    case "draft":
      return "Draft";
    case "minutes":
      return "Minutes";
    default:
      return "Other";
  }
}

function compileStatusLabel(status: string): string {
  switch (status) {
    case "succeeded":
      return "Compiled";
    case "running":
      return "Compiling";
    case "failed":
      return "Compile failed";
    case "timeout":
      return "Compile timeout";
    default:
      return "Pending compile";
  }
}

export default function ProjectDetailPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [inProgressTasks, setInProgressTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentMonthStart = useMemo(firstDayOfCurrentMonth, []);
  const currentMonthEnd = useMemo(() => lastDayOfMonth(currentMonthStart), [currentMonthStart]);
  const currentMonthKey = useMemo(() => monthKey(currentMonthStart), [currentMonthStart]);
  const calendarCells = useMemo(() => buildMonthCells(currentMonthStart), [currentMonthStart]);

  const meetingsByDate = useMemo(() => {
    const grouped = new Map<string, MeetingListItem[]>();
    for (const meeting of meetings) {
      if (!grouped.has(meeting.scheduledDate)) {
        grouped.set(meeting.scheduledDate, []);
      }
      grouped.get(meeting.scheduledDate)?.push(meeting);
    }
    return grouped;
  }, [meetings]);

  const loadDashboard = useCallback(
    async (authToken: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const [documentsResult, meetingsResult, tasksResult] = await Promise.all([
          listProjectDocuments(params.projectId, authToken),
          listProjectMeetings(params.projectId, authToken, {
            from: dayKeyFromDate(currentMonthStart),
            to: dayKeyFromDate(currentMonthEnd)
          }),
          listProjectTasks(params.projectId, authToken)
        ]);

        const sortedDocuments = [...documentsResult]
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
          .slice(0, 5);

        const topInProgressTasks = tasksResult
          .filter((task) => task.status === "in_progress")
          .sort((left, right) => {
            const byUpdatedAt = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
            if (byUpdatedAt !== 0) {
              return byUpdatedAt;
            }
            return Date.parse(right.createdAt) - Date.parse(left.createdAt);
          })
          .slice(0, 6);

        setDocuments(sortedDocuments);
        setMeetings(meetingsResult);
        setInProgressTasks(topInProgressTasks);
      } catch (dashboardError) {
        setError((dashboardError as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [currentMonthEnd, currentMonthStart, params.projectId]
  );

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    void loadDashboard(storedToken);
  }, [loadDashboard, router]);

  const onCalendarDayClick = (dateKey: string): void => {
    router.push(`/projects/${params.projectId}/meetings?view=calendar&date=${dateKey}&month=${currentMonthKey}`);
  };

  return (
    <AppShell
      title="Project overview"
      subtitle={<ProjectSubtitle projectId={params.projectId} />}
      projectId={params.projectId}
    >
      <section className="project-overview-dashboard">
        {error ? <p className="alert alert-error">{error}</p> : null}
        {loading ? <p className="alert alert-info">Loading project dashboard...</p> : null}

        {!loading ? (
          <div className="project-overview-grid">
            <article className="panel project-overview-card">
              <div className="project-overview-card-header">
                <h3 className="section-heading">Recent documents</h3>
                <Link className="button button-secondary" href={`/projects/${params.projectId}/documents`}>
                  Open documents
                </Link>
              </div>
              {documents.length === 0 ? <p className="alert alert-info">No documents yet in this project.</p> : null}
              {documents.length > 0 ? (
                <ul className="list project-overview-list">
                  {documents.map((document) => (
                    <li className="list-item project-overview-item" key={document.id}>
                      <Link className="project-overview-item-link" href={`/projects/${params.projectId}/documents/${document.id}`}>
                        <strong>{document.title}</strong>
                        <p className="project-overview-meta">
                          {normalizeDocumentType(document.type)} | Updated {formatDate(document.updatedAt)}
                          {document.latestMainVersion ? ` | ${compileStatusLabel(document.latestMainVersion.compileStatus)}` : ""}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>

            <article className="panel project-overview-card project-overview-tasks">
              <div className="project-overview-card-header">
                <h3 className="section-heading">Tasks in progress</h3>
                <Link className="button button-secondary" href={`/projects/${params.projectId}/tasks`}>
                  Open tasks board
                </Link>
              </div>
              {inProgressTasks.length === 0 ? <p className="alert alert-info">No tasks currently in progress.</p> : null}
              {inProgressTasks.length > 0 ? (
                <ul className="list project-overview-list">
                  {inProgressTasks.map((task) => (
                    <li className="list-item project-overview-item" key={task.id}>
                      <strong>{task.title}</strong>
                      <p className="project-overview-meta">
                        Priority: {task.priority} | {task.assignee ? `Assigned to ${task.assignee.name}` : "Unassigned"}
                        {task.dueDate ? ` | Due ${formatDate(task.dueDate)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>

            <article className="panel project-overview-card project-overview-card-full project-overview-calendar">
              <div className="project-overview-card-header">
                <div>
                  <h3 className="section-heading">Meetings calendar</h3>
                  <p className="project-overview-meta">{monthLabel(currentMonthStart)}</p>
                </div>
                <Link className="button button-secondary" href={`/projects/${params.projectId}/meetings?view=calendar&month=${currentMonthKey}`}>
                  Open meetings
                </Link>
              </div>
              {meetings.length === 0 ? <p className="project-overview-calendar-note">No minutes in this month yet.</p> : null}
              <div className="minutes-calendar-grid">
                {DAY_NAMES.map((dayName) => (
                  <div className="minutes-day-name" key={dayName}>
                    {dayName}
                  </div>
                ))}
                {calendarCells.map((cell) => {
                  const count = meetingsByDate.get(cell.dateKey)?.length ?? 0;
                  const hasMinutes = count > 0;
                  const ariaDayLabel = parseDayKey(cell.dateKey).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                  });

                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      className={[
                        "minutes-day-cell",
                        hasMinutes ? "minutes-day-cell-has-minutes" : "",
                        cell.inCurrentMonth ? "" : "minutes-day-cell-muted",
                        cell.isToday ? "minutes-day-cell-today" : ""
                      ]
                        .join(" ")
                        .trim()}
                      onClick={() => onCalendarDayClick(cell.dateKey)}
                      aria-label={`${ariaDayLabel}. ${hasMinutes ? `Has ${count} minute${count === 1 ? "" : "s"}.` : "No minutes."}`}
                    >
                      <span>{cell.dayNumber}</span>
                      {hasMinutes ? <span className="minutes-day-dot" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            </article>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
