"use client";

import { FormEvent, KeyboardEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
const DEFAULT_MARKDOWN_LIST_ITEM = "- ";
const INDENT_SIZE = 2;

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

function normalizeDayKey(rawDayKey: string | null): string | null {
  if (!rawDayKey || !/^\d{4}-\d{2}-\d{2}$/.test(rawDayKey)) {
    return null;
  }

  const parsed = parseDayKey(rawDayKey);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10) === rawDayKey ? rawDayKey : null;
}

function parseMonthKey(rawMonthKey: string | null): Date | null {
  if (!rawMonthKey || !/^\d{4}-\d{2}$/.test(rawMonthKey)) {
    return null;
  }

  const [yearRaw, monthRaw] = rawMonthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, 1));
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

function withDefaultListSeed(content: string | null): string {
  if (!content || content.trim().length === 0) {
    return DEFAULT_MARKDOWN_LIST_ITEM;
  }
  return content;
}

type ListMarkerInfo = {
  indent: string;
  marker: string;
  content: string;
};

function extractListMarker(line: string): ListMarkerInfo | null {
  const checklistMatch = line.match(/^(\s*)-\s\[(?: |x|X)\]\s?(.*)$/);
  if (checklistMatch) {
    return {
      indent: checklistMatch[1] ?? "",
      marker: "- [ ] ",
      content: checklistMatch[2] ?? ""
    };
  }

  const unorderedMatch = line.match(/^(\s*)([-+*])\s(.*)$/);
  if (unorderedMatch) {
    return {
      indent: unorderedMatch[1] ?? "",
      marker: `${unorderedMatch[2]} `,
      content: unorderedMatch[3] ?? ""
    };
  }

  const orderedMatch = line.match(/^(\s*)\d+\.\s(.*)$/);
  if (orderedMatch) {
    return {
      indent: orderedMatch[1] ?? "",
      marker: "1. ",
      content: orderedMatch[2] ?? ""
    };
  }

  return null;
}

function buildListContinuationOnEnter(
  value: string,
  selectionStart: number,
  selectionEnd: number
): TextTransformResult | null {
  if (selectionStart !== selectionEnd) {
    return null;
  }

  const safeCursor = Math.max(0, Math.min(selectionStart, value.length));
  const lineStart = value.lastIndexOf("\n", Math.max(0, safeCursor - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", safeCursor);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const markerInfo = extractListMarker(line);
  if (!markerInfo) {
    return null;
  }

  const hasContent = markerInfo.content.trim().length > 0;
  const nextIndent = hasContent
    ? markerInfo.indent
    : markerInfo.indent.length >= INDENT_SIZE
      ? markerInfo.indent.slice(0, markerInfo.indent.length - INDENT_SIZE)
      : "";
  const insertText = hasContent || markerInfo.indent.length >= INDENT_SIZE ? `\n${nextIndent}${markerInfo.marker}` : "\n";

  return {
    nextValue: `${value.slice(0, safeCursor)}${insertText}${value.slice(safeCursor)}`,
    nextSelectionStart: safeCursor + insertText.length,
    nextSelectionEnd: safeCursor + insertText.length
  };
}

function renderMarkdownSection(label: string, content: string | null): JSX.Element | null {
  if (!content || content.trim().length === 0) {
    return null;
  }

  return (
    <section className="minutes-markdown-section">
      <p className="minutes-markdown-label">{label}</p>
      <div className="minutes-markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </section>
  );
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
  const searchParams = useSearchParams();
  const searchParamsValue = searchParams.toString();
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

  useEffect(() => {
    const currentSearchParams = new URLSearchParams(searchParamsValue);
    const requestedView = currentSearchParams.get("view");
    if (requestedView === "calendar" || requestedView === "list") {
      setViewMode(requestedView);
    }

    const requestedDate = normalizeDayKey(currentSearchParams.get("date"));
    let requestedMonthCursor = parseMonthKey(currentSearchParams.get("month"));

    if (requestedDate) {
      setSelectedCalendarDate(requestedDate);
      if (!requestedMonthCursor) {
        const requestedDateParsed = parseDayKey(requestedDate);
        requestedMonthCursor = new Date(
          Date.UTC(requestedDateParsed.getUTCFullYear(), requestedDateParsed.getUTCMonth(), 1)
        );
      }
    }

    if (requestedMonthCursor) {
      setMonthCursor(requestedMonthCursor);
    }
  }, [searchParamsValue]);

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
    setDoneMarkdown(DEFAULT_MARKDOWN_LIST_ITEM);
    setToDiscussMarkdown(DEFAULT_MARKDOWN_LIST_ITEM);
    setToDoMarkdown(DEFAULT_MARKDOWN_LIST_ITEM);
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
    setDoneMarkdown(withDefaultListSeed(meeting.doneMarkdown));
    setToDiscussMarkdown(withDefaultListSeed(meeting.toDiscussMarkdown));
    setToDoMarkdown(withDefaultListSeed(meeting.toDoMarkdown));
    setTitleManuallyEdited(true);
    setShowForm(true);
    setError(null);
    setSuccess(null);
  };

  const applyMarkdownTransform = useCallback(
    (section: MarkdownSectionKey, transformed: TextTransformResult): void => {
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
    [markdownSectionRefs, setMarkdownSectionValue]
  );

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

      applyMarkdownTransform(section, transformed);
    },
    [applyMarkdownTransform, markdownSectionRefs, markdownSectionValues]
  );

  const onMarkdownKeyDown = useCallback(
    (section: MarkdownSectionKey, event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === "Tab") {
        event.preventDefault();
        applyMarkdownAction(section, event.shiftKey ? "outdent" : "indent");
        return;
      }

      if (event.key !== "Enter") {
        return;
      }

      const textareaRef = markdownSectionRefs[section].current;
      if (!textareaRef) {
        return;
      }
      const transformed = buildListContinuationOnEnter(
        markdownSectionValues[section],
        textareaRef.selectionStart,
        textareaRef.selectionEnd
      );
      if (!transformed) {
        return;
      }

      event.preventDefault();
      applyMarkdownTransform(section, transformed);
    },
    [applyMarkdownAction, applyMarkdownTransform, markdownSectionRefs, markdownSectionValues]
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

  const closeForm = useCallback((): void => {
    if (submitting) {
      return;
    }
    setShowForm(false);
    resetForm();
  }, [resetForm, submitting]);

  const submitMeeting = useCallback(
    async (event: FormEvent): Promise<void> => {
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
        closeForm();
      } catch (saveError) {
        setError((saveError as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [
      closeForm,
      dateInput,
      doneMarkdown,
      editingMeetingId,
      formMode,
      isReader,
      loadMeetings,
      location,
      params.projectId,
      title,
      toDiscussMarkdown,
      toDoMarkdown,
      token
    ]
  );

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
        <div className="meetings-editor-modal-backdrop" onClick={closeForm}>
          <section
            className="panel meetings-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meetings-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="meetings-editor-modal-header">
              <h3 id="meetings-editor-title" className="section-heading">
                {formMode === "edit" ? "Edit minute" : "Create minute"}
              </h3>
              <button className="button button-secondary" type="button" onClick={closeForm} disabled={submitting}>
                Close
              </button>
            </div>
            <form className="form-grid meetings-editor-modal-body" onSubmit={submitMeeting}>
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
              <div className="meetings-editor-modal-footer">
                <button className="button" type="submit" disabled={isReader || submitting}>
                  {submitting ? "Saving..." : formMode === "edit" ? "Save changes" : "Create minute"}
                </button>
                <button className="button button-secondary" type="button" disabled={submitting} onClick={closeForm}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
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
                      {renderMarkdownSection("Done", meeting.doneMarkdown)}
                      {renderMarkdownSection("To discuss", meeting.toDiscussMarkdown)}
                      {renderMarkdownSection("To do", meeting.toDoMarkdown)}
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
                    {renderMarkdownSection("Done", meeting.doneMarkdown)}
                    {renderMarkdownSection("To discuss", meeting.toDiscussMarkdown)}
                    {renderMarkdownSection("To do", meeting.toDoMarkdown)}
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
