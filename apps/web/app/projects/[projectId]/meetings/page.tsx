"use client";

import { FormEvent, KeyboardEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ProjectSubtitle } from "../../../../components/project-subtitle";
import { LoginResponse } from "../../../../lib/client-api";
import {
  createProjectMeeting,
  deleteMeeting,
  listProjectMeetings,
  MeetingListItem,
  MeetingsViewMode,
  updateMeeting
} from "../../../../lib/meetings";

type MeetingFormMode = "create" | "edit";
type MarkdownSectionKey = "done" | "toDiscuss" | "toDo";
type MarkdownAction = "bullets" | "numbered" | "checklist" | "indent" | "outdent";
type CalendarDayCell = {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
};

type TextTransformResult = {
  nextValue: string;
  nextSelectionStart: number;
  nextSelectionEnd: number;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseStoredUser(rawUser: string | null): LoginResponse["user"] | null {
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as LoginResponse["user"];
  } catch {
    return null;
  }
}

function dayKeyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDayKey(dayKey: string): Date {
  return new Date(`${dayKey}T12:00:00.000Z`);
}

function toIsoFromDay(dayKey: string): string {
  return `${dayKey}T12:00:00.000Z`;
}

function firstDayOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function shiftMonth(monthCursor: Date, offset: number): Date {
  return new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + offset, 1));
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

function autoTitleForDay(dayKey: string): string {
  return `Minutes ${dayKey}`;
}

function displayDay(dayKey: string): string {
  return parseDayKey(dayKey).toLocaleDateString();
}

function sectionSnippet(content: string | null, maxLength = 140): string | null {
  if (!content) {
    return null;
  }
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function transformSelectedLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transformLine: (line: string, index: number) => string
): TextTransformResult {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));

  const lineStart = value.lastIndexOf("\n", Math.max(0, safeStart - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", safeEnd);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  const selectedBlock = value.slice(lineStart, lineEnd);
  const selectedLines = selectedBlock.split("\n");
  const transformedBlock = selectedLines.map((line, index) => transformLine(line, index)).join("\n");

  return {
    nextValue: `${value.slice(0, lineStart)}${transformedBlock}${value.slice(lineEnd)}`,
    nextSelectionStart: lineStart,
    nextSelectionEnd: lineStart + transformedBlock.length
  };
}

function indentLine(line: string): string {
  return `  ${line}`;
}

function outdentLine(line: string): string {
  if (line.startsWith("\t")) {
    return line.slice(1);
  }
  if (line.startsWith("  ")) {
    return line.slice(2);
  }
  if (line.startsWith(" ")) {
    return line.slice(1);
  }
  return line;
}

export default function ProjectMeetingsPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  const router = useRouter();
  const doneRef = useRef<HTMLTextAreaElement>(null);
  const toDiscussRef = useRef<HTMLTextAreaElement>(null);
  const toDoRef = useRef<HTMLTextAreaElement>(null);

  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeMeetingActionId, setActiveMeetingActionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<MeetingsViewMode>("list");
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<MeetingFormMode>("create");
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState(dayKeyFromDate(new Date()));
  const [title, setTitle] = useState(autoTitleForDay(dayKeyFromDate(new Date())));
  const [location, setLocation] = useState("");
  const [doneMarkdown, setDoneMarkdown] = useState("");
  const [toDiscussMarkdown, setToDiscussMarkdown] = useState("");
  const [toDoMarkdown, setToDoMarkdown] = useState("");
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState<Date>(firstDayOfCurrentMonth);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isReader = userRole === "reader";

  const markdownSectionRefs: Record<MarkdownSectionKey, RefObject<HTMLTextAreaElement>> = {
    done: doneRef,
    toDiscuss: toDiscussRef,
    toDo: toDoRef
  };

  const markdownSectionValues: Record<MarkdownSectionKey, string> = {
    done: doneMarkdown,
    toDiscuss: toDiscussMarkdown,
    toDo: toDoMarkdown
  };

  const setMarkdownSectionValue = useCallback((section: MarkdownSectionKey, nextValue: string): void => {
    switch (section) {
      case "done":
        setDoneMarkdown(nextValue);
        return;
      case "toDiscuss":
        setToDiscussMarkdown(nextValue);
        return;
      case "toDo":
        setToDoMarkdown(nextValue);
    }
  }, []);

  const loadMeetings = useCallback(
    async (authToken: string): Promise<void> => {
      setLoading(true);
      try {
        const list = await listProjectMeetings(params.projectId, authToken);
        setMeetings(list);
        setError(null);
      } catch (meetingsError) {
        setError((meetingsError as Error).message);
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

    setToken(storedToken);
    setUserRole(parseStoredUser(localStorage.getItem("doctoral_user"))?.globalRole ?? null);
    void loadMeetings(storedToken);
  }, [loadMeetings, router]);

  const sortedMeetings = useMemo(
    () =>
      [...meetings].sort((left, right) => {
        const diff = new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime();
        if (diff !== 0) {
          return diff;
        }
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }),
    [meetings]
  );

  const meetingsByDate = useMemo(() => {
    const grouped = new Map<string, MeetingListItem[]>();
    for (const meeting of sortedMeetings) {
      if (!grouped.has(meeting.scheduledDate)) {
        grouped.set(meeting.scheduledDate, []);
      }
      grouped.get(meeting.scheduledDate)?.push(meeting);
    }
    return grouped;
  }, [sortedMeetings]);

  const monthCells = useMemo(() => buildMonthCells(monthCursor), [monthCursor]);
  const meetingsForSelectedDate = useMemo(
    () => (selectedCalendarDate ? meetingsByDate.get(selectedCalendarDate) ?? [] : []),
    [meetingsByDate, selectedCalendarDate]
  );

  const resetForm = useCallback((): void => {
    const today = dayKeyFromDate(new Date());
    setDateInput(today);
    setTitle(autoTitleForDay(today));
    setLocation("");
    setDoneMarkdown("");
    setToDiscussMarkdown("");
    setToDoMarkdown("");
    setTitleManuallyEdited(false);
    setEditingMeetingId(null);
    setFormMode("create");
  }, []);

  const openCreateForm = (): void => {
    resetForm();
    setShowForm(true);
    setError(null);
    setSuccess(null);
  };

  const openEditForm = (meeting: MeetingListItem): void => {
    setFormMode("edit");
    setEditingMeetingId(meeting.id);
    setDateInput(meeting.scheduledDate);
    setTitle(meeting.title);
    setLocation(meeting.location ?? "");
    setDoneMarkdown(meeting.doneMarkdown ?? "");
    setToDiscussMarkdown(meeting.toDiscussMarkdown ?? "");
    setToDoMarkdown(meeting.toDoMarkdown ?? "");
    setTitleManuallyEdited(true);
    setShowForm(true);
    setError(null);
    setSuccess(null);
  };

  const applyMarkdownAction = useCallback(
    (section: MarkdownSectionKey, action: MarkdownAction): void => {
      const textareaRef = markdownSectionRefs[section].current;
      if (!textareaRef) {
        return;
      }

      const sectionValue = markdownSectionValues[section];
      const { selectionStart, selectionEnd } = textareaRef;
      let transformed: TextTransformResult;

      if (action === "bullets") {
        transformed = transformSelectedLines(sectionValue, selectionStart, selectionEnd, (line) => `- ${line}`);
      } else if (action === "numbered") {
        transformed = transformSelectedLines(sectionValue, selectionStart, selectionEnd, (line, index) => `${index + 1}. ${line}`);
      } else if (action === "checklist") {
        transformed = transformSelectedLines(sectionValue, selectionStart, selectionEnd, (line) => `- [ ] ${line}`);
      } else if (action === "indent") {
        transformed = transformSelectedLines(sectionValue, selectionStart, selectionEnd, (line) => indentLine(line));
      } else {
        transformed = transformSelectedLines(sectionValue, selectionStart, selectionEnd, (line) => outdentLine(line));
      }

      setMarkdownSectionValue(section, transformed.nextValue);

      requestAnimationFrame(() => {
        const refreshedRef = markdownSectionRefs[section].current;
        if (!refreshedRef) {
          return;
        }
        refreshedRef.focus();
        refreshedRef.setSelectionRange(transformed.nextSelectionStart, transformed.nextSelectionEnd);
      });
    },
    [markdownSectionRefs, markdownSectionValues, setMarkdownSectionValue]
  );

  const onMarkdownKeyDown = useCallback(
    (section: MarkdownSectionKey, event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== "Tab") {
        return;
      }
      event.preventDefault();
      applyMarkdownAction(section, event.shiftKey ? "outdent" : "indent");
    },
    [applyMarkdownAction]
  );

  const renderMarkdownToolbar = (section: MarkdownSectionKey): JSX.Element => (
    <div className="markdown-toolbar">
      <button
        className="button button-secondary markdown-tool"
        type="button"
        onClick={() => applyMarkdownAction(section, "bullets")}
        disabled={isReader || submitting}
      >
        Bullets
      </button>
      <button
        className="button button-secondary markdown-tool"
        type="button"
        onClick={() => applyMarkdownAction(section, "numbered")}
        disabled={isReader || submitting}
      >
        Numbered
      </button>
      <button
        className="button button-secondary markdown-tool"
        type="button"
        onClick={() => applyMarkdownAction(section, "checklist")}
        disabled={isReader || submitting}
      >
        Checklist
      </button>
      <button
        className="button button-secondary markdown-tool"
        type="button"
        onClick={() => applyMarkdownAction(section, "indent")}
        disabled={isReader || submitting}
      >
        Indent
      </button>
      <button
        className="button button-secondary markdown-tool"
        type="button"
        onClick={() => applyMarkdownAction(section, "outdent")}
        disabled={isReader || submitting}
      >
        Outdent
      </button>
    </div>
  );

  const onDateInputChange = (nextDate: string): void => {
    setDateInput(nextDate);
    if (!titleManuallyEdited) {
      setTitle(autoTitleForDay(nextDate));
    }
  };

  const onNewMinuteClick = (): void => {
    if (isReader) {
      setError("Reader role cannot create minutes.");
      return;
    }

    if (showForm && formMode === "create") {
      setShowForm(false);
      return;
    }

    openCreateForm();
  };

  const submitMeeting = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (isReader) {
      setError("Reader role cannot modify minutes.");
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle || !dateInput) {
      setError("Date and title are required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const trimmedLocation = location.trim();

      if (formMode === "edit" && editingMeetingId) {
        await updateMeeting(editingMeetingId, token, {
          title: trimmedTitle,
          scheduledAt: toIsoFromDay(dateInput),
          location: trimmedLocation,
          doneMarkdown,
          toDiscussMarkdown,
          toDoMarkdown
        });
        setSuccess("Minute updated successfully.");
      } else {
        await createProjectMeeting(params.projectId, token, {
          title: trimmedTitle,
          scheduledAt: toIsoFromDay(dateInput),
          location: trimmedLocation.length > 0 ? trimmedLocation : undefined,
          doneMarkdown: doneMarkdown.trim().length > 0 ? doneMarkdown : undefined,
          toDiscussMarkdown: toDiscussMarkdown.trim().length > 0 ? toDiscussMarkdown : undefined,
          toDoMarkdown: toDoMarkdown.trim().length > 0 ? toDoMarkdown : undefined
        });
        setSuccess("Minute created successfully.");
      }

      await loadMeetings(token);
      setShowForm(false);
      resetForm();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteMinute = async (meetingId: string): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (isReader) {
      setError("Reader role cannot delete minutes.");
      return;
    }

    if (!window.confirm("Delete this minute?")) {
      return;
    }

    setActiveMeetingActionId(meetingId);
    setError(null);
    setSuccess(null);

    try {
      await deleteMeeting(meetingId, token);
      setSuccess("Minute deleted successfully.");
      await loadMeetings(token);
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setActiveMeetingActionId(null);
    }
  };

  return (
    <AppShell
      title="Meetings"
      subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Minutes organized by date with list and calendar views." />}
      projectId={params.projectId}
    >
      <section className="panel meetings-toolbar">
        <div className="meetings-toolbar-row">
          <div className="meetings-view-toggle">
            <button
              className={viewMode === "list" ? "button" : "button button-secondary"}
              type="button"
              onClick={() => setViewMode("list")}
            >
              List
            </button>
            <button
              className={viewMode === "calendar" ? "button" : "button button-secondary"}
              type="button"
              onClick={() => setViewMode("calendar")}
            >
              Calendar
            </button>
          </div>
          <button className="button button-secondary" type="button" onClick={onNewMinuteClick} disabled={isReader}>
            {showForm && formMode === "create" ? "Close" : "New minute"}
          </button>
        </div>
        {isReader ? <p className="alert alert-info">Reader role can view minutes but cannot create, edit, or delete.</p> : null}
        {success ? <p className="alert alert-success">{success}</p> : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
      </section>

      {showForm ? (
        <section className="panel meetings-form-drawer">
          <h3 className="section-heading">{formMode === "edit" ? "Edit minute" : "Create minute"}</h3>
          <form className="form-grid" onSubmit={submitMeeting}>
            <div className="grid cols-2 grid-tight">
              <label>
                Meeting date
                <input
                  className="input"
                  type="date"
                  value={dateInput}
                  onChange={(event) => onDateInputChange(event.target.value)}
                  required
                  disabled={isReader || submitting}
                />
              </label>
              <label>
                Location
                <input
                  className="input"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  maxLength={300}
                  disabled={isReader || submitting}
                />
              </label>
            </div>
            <label>
              Title
              <input
                className="input"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleManuallyEdited(true);
                }}
                maxLength={300}
                required
                disabled={isReader || submitting}
              />
            </label>
            <label>
              Done (Markdown)
              {renderMarkdownToolbar("done")}
              <textarea
                ref={doneRef}
                className="input textarea-sm"
                value={doneMarkdown}
                onChange={(event) => setDoneMarkdown(event.target.value)}
                onKeyDown={(event) => onMarkdownKeyDown("done", event)}
                maxLength={20_000}
                disabled={isReader || submitting}
              />
            </label>
            <label>
              To discuss (Markdown)
              {renderMarkdownToolbar("toDiscuss")}
              <textarea
                ref={toDiscussRef}
                className="input textarea-sm"
                value={toDiscussMarkdown}
                onChange={(event) => setToDiscussMarkdown(event.target.value)}
                onKeyDown={(event) => onMarkdownKeyDown("toDiscuss", event)}
                maxLength={20_000}
                disabled={isReader || submitting}
              />
            </label>
            <label>
              To do (Markdown)
              {renderMarkdownToolbar("toDo")}
              <textarea
                ref={toDoRef}
                className="input textarea-md"
                value={toDoMarkdown}
                onChange={(event) => setToDoMarkdown(event.target.value)}
                onKeyDown={(event) => onMarkdownKeyDown("toDo", event)}
                maxLength={50_000}
                disabled={isReader || submitting}
              />
            </label>
            <div className="task-form-actions">
              <button className="button" type="submit" disabled={isReader || submitting}>
                {submitting ? "Saving..." : formMode === "edit" ? "Save changes" : "Create minute"}
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

      {loading ? <p className="alert alert-info">Loading minutes...</p> : null}

      {!loading && viewMode === "list" ? (
        <section className="meetings-list">
          {meetingsByDate.size === 0 ? <p className="alert alert-info">No minutes yet. Create the first one.</p> : null}
          {Array.from(meetingsByDate.entries()).map(([dateKey, items]) => (
            <article key={dateKey} className="panel minutes-list-group">
              <h3 className="section-heading">{displayDay(dateKey)}</h3>
              <div className="list">
                {items.map((meeting) => (
                  <div className="list-item minutes-list-item" key={meeting.id}>
                    <div className="minutes-list-item-main">
                      <strong>{meeting.title}</strong>
                      <p>
                        {meeting.location ? `Location: ${meeting.location}` : "Location: not set"} | Actions:{" "}
                        {meeting.actionsCount}
                      </p>
                      {sectionSnippet(meeting.doneMarkdown) ? <p>Done: {sectionSnippet(meeting.doneMarkdown)}</p> : null}
                      {sectionSnippet(meeting.toDiscussMarkdown) ? <p>To discuss: {sectionSnippet(meeting.toDiscussMarkdown)}</p> : null}
                      {sectionSnippet(meeting.toDoMarkdown) ? <p>To do: {sectionSnippet(meeting.toDoMarkdown)}</p> : null}
                    </div>
                    {!isReader ? (
                      <div className="minutes-list-item-actions">
                        <button className="button button-secondary" type="button" onClick={() => openEditForm(meeting)}>
                          Edit
                        </button>
                        <button
                          className="button button-danger"
                          type="button"
                          onClick={() => {
                            void deleteMinute(meeting.id);
                          }}
                          disabled={activeMeetingActionId === meeting.id}
                        >
                          {activeMeetingActionId === meeting.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {!loading && viewMode === "calendar" ? (
        <section className="meetings-calendar-layout">
          <article className="panel">
            <div className="meetings-calendar-header">
              <button className="button button-secondary" type="button" onClick={() => setMonthCursor((current) => shiftMonth(current, -1))}>
                Previous
              </button>
              <h3 className="section-heading">{monthLabel(monthCursor)}</h3>
              <button className="button button-secondary" type="button" onClick={() => setMonthCursor((current) => shiftMonth(current, 1))}>
                Next
              </button>
            </div>
            <div className="minutes-calendar-grid">
              {DAY_NAMES.map((dayName) => (
                <div className="minutes-day-name" key={dayName}>
                  {dayName}
                </div>
              ))}
              {monthCells.map((cell) => {
                const count = meetingsByDate.get(cell.dateKey)?.length ?? 0;
                const hasMinutes = count > 0;
                const selected = selectedCalendarDate === cell.dateKey;
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
                      selected ? "minutes-day-cell-selected" : "",
                      cell.isToday ? "minutes-day-cell-today" : ""
                    ]
                      .join(" ")
                      .trim()}
                    onClick={() => setSelectedCalendarDate(cell.dateKey)}
                    aria-label={`${ariaDayLabel}. ${hasMinutes ? `Has ${count} minute${count === 1 ? "" : "s"}.` : "No minutes."}`}
                  >
                    <span>{cell.dayNumber}</span>
                    {hasMinutes ? <span className="minutes-day-dot" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </article>

          <aside className="panel minutes-side-panel">
            <h3 className="section-heading">{selectedCalendarDate ? `Minutes on ${displayDay(selectedCalendarDate)}` : "Select a day"}</h3>
            {!selectedCalendarDate ? <p>Select a day in the calendar to filter minutes.</p> : null}
            {selectedCalendarDate && meetingsForSelectedDate.length === 0 ? <p>No minutes for this day.</p> : null}
            {selectedCalendarDate && meetingsForSelectedDate.length > 0 ? (
              <div className="list">
                {meetingsForSelectedDate.map((meeting) => (
                  <div key={meeting.id} className="list-item">
                    <strong>{meeting.title}</strong>
                    <p>{meeting.location ? `Location: ${meeting.location}` : "Location: not set"}</p>
                    {sectionSnippet(meeting.doneMarkdown, 90) ? <p>Done: {sectionSnippet(meeting.doneMarkdown, 90)}</p> : null}
                    {sectionSnippet(meeting.toDiscussMarkdown, 90) ? <p>To discuss: {sectionSnippet(meeting.toDiscussMarkdown, 90)}</p> : null}
                    {sectionSnippet(meeting.toDoMarkdown, 90) ? <p>To do: {sectionSnippet(meeting.toDoMarkdown, 90)}</p> : null}
                    {!isReader ? (
                      <div className="minutes-list-item-actions">
                        <button className="button button-secondary" type="button" onClick={() => openEditForm(meeting)}>
                          Edit
                        </button>
                        <button
                          className="button button-danger"
                          type="button"
                          onClick={() => {
                            void deleteMinute(meeting.id);
                          }}
                          disabled={activeMeetingActionId === meeting.id}
                        >
                          {activeMeetingActionId === meeting.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}
    </AppShell>
  );
}
