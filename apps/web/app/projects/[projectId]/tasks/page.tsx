"use client";

import { DragEvent, FormEvent, MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ProjectSubtitle } from "../../../../components/project-subtitle";
import { getProjectAccess, ProjectAccess } from "../../../../lib/project-access";
import {
  createProjectTask,
  deleteTask as deleteTaskApi,
  listProjectMembers,
  listProjectTasks,
  ProjectMember,
  TaskListItem,
  TaskPriority,
  TaskStatus,
  updateTask as updateTaskApi
} from "../../../../lib/tasks";

const taskColumns: Array<{ status: TaskStatus; title: string }> = [
  { status: "todo", title: "To Do" },
  { status: "in_progress", title: "In Progress" },
  { status: "blocked", title: "Blocked" },
  { status: "done", title: "Done" }
];

const priorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" }
];

const statusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" }
];

const priorityOrder: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

type TaskFormMode = "create" | "edit";
type ContextMenuState = { taskId: string; x: number; y: number } | null;

export default function ProjectTasksPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [projectAccess, setProjectAccess] = useState<ProjectAccess | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTaskActionId, setActiveTaskActionId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<TaskFormMode>("create");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  const loadTasks = useCallback(
    async (authToken: string): Promise<void> => {
      setLoading(true);
      try {
        const result = await listProjectTasks(params.projectId, authToken);
        setTasks(result);
        setError(null);
      } catch (fetchError) {
        setError((fetchError as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [params.projectId]
  );

  const loadMembers = useCallback(
    async (authToken: string): Promise<void> => {
      try {
        const data = await listProjectMembers(params.projectId, authToken);
        setMembers(data);
      } catch {
        setMembers([]);
      }
    },
    [params.projectId]
  );

  const loadAccess = useCallback(
    async (authToken: string): Promise<void> => {
      try {
        const access = await getProjectAccess(params.projectId, authToken);
        setProjectAccess(access);
      } catch (fetchError) {
        setProjectAccess(null);
        setError((fetchError as Error).message);
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
    void loadAccess(storedToken);
    void loadTasks(storedToken);
    void loadMembers(storedToken);
  }, [loadAccess, loadMembers, loadTasks, router]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = (): void => { setContextMenu(null); };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const tasksByStatus = useMemo(() => {
    const groups = tasks.reduce<Record<TaskStatus, TaskListItem[]>>(
      (acc, task) => {
        acc[task.status].push(task);
        return acc;
      },
      { todo: [], in_progress: [], blocked: [], done: [] }
    );
    // Sort each column: critical first, then high, medium, low
    for (const col of Object.values(groups)) {
      col.sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));
    }
    return groups;
  }, [tasks]);

  const canWrite = projectAccess?.canWrite ?? false;

  const resetForm = (): void => {
    setTitle("");
    setDescription("");
    setStatus("todo");
    setPriority("medium");
    setAssigneeId("");
    setEditingTaskId(null);
    setFormMode("create");
  };

  const openCreateForm = (): void => {
    resetForm();
    setShowForm(true);
    setError(null);
    setSuccess(null);
    setContextMenu(null);
  };

  const openEditForm = (taskId: string): void => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;

    setFormMode("edit");
    setEditingTaskId(task.id);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setAssigneeId(task.assigneeId ?? "");
    setShowForm(true);
    setError(null);
    setSuccess(null);
    setContextMenu(null);
  };

  const onNewTaskClick = (): void => {
    if (!canWrite) {
      setError("You do not have write access to this project.");
      return;
    }
    if (showForm && formMode === "create") {
      setShowForm(false);
      setContextMenu(null);
      return;
    }
    openCreateForm();
  };

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    if (!canWrite) { setError("You do not have write access to this project."); return; }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError("Title is required."); return; }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      if (formMode === "edit" && editingTaskId) {
        await updateTaskApi(editingTaskId, token, {
          title: trimmedTitle,
          description: description.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || null
        });
        setSuccess("Task updated successfully.");
      } else {
        await createProjectTask(params.projectId, token, {
          title: trimmedTitle,
          description: description.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || undefined
        });
        setSuccess("Task created successfully.");
      }
      await loadTasks(token);
      resetForm();
      setShowForm(false);
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTaskFromBoard = async (taskId: string): Promise<void> => {
    if (!token) { setError("Missing session token. Please sign in again."); return; }
    if (!canWrite) { setError("You do not have write access to this project."); return; }

    const confirmed = window.confirm("Delete this task?");
    if (!confirmed) { setContextMenu(null); return; }

    setActiveTaskActionId(taskId);
    setError(null);
    setSuccess(null);
    try {
      await deleteTaskApi(taskId, token);
      setSuccess("Task deleted successfully.");
      await loadTasks(token);
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setActiveTaskActionId(null);
      setContextMenu(null);
    }
  };

  const openContextMenu = (taskId: string, x: number, y: number): void => {
    if (!canWrite) return;
    const menuWidth = 190;
    const menuHeight = 110;
    const safeX = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
    const safeY = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));
    setContextMenu({ taskId, x: safeX, y: safeY });
  };

  const onCardContextMenu = (taskId: string, event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    openContextMenu(taskId, event.clientX, event.clientY);
  };

  const onCardActionsClick = (taskId: string, event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    openContextMenu(taskId, buttonRect.right, buttonRect.bottom);
  };

  // ── Drag & drop handlers ──────────────────────────────────────────

  const onCardDragStart = (taskId: string, event: DragEvent<HTMLDivElement>): void => {
    setDraggingTaskId(taskId);
    event.dataTransfer.effectAllowed = "move";
  };

  const onCardDragEnd = (): void => {
    setDraggingTaskId(null);
    setDragOverColumn(null);
  };

  const onColumnDragOver = (columnStatus: TaskStatus, event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnStatus);
  };

  const onColumnDragLeave = (event: DragEvent<HTMLElement>): void => {
    // Only clear if leaving the column itself, not entering a child
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOverColumn(null);
    }
  };

  const onColumnDrop = async (columnStatus: TaskStatus, event: DragEvent<HTMLElement>): Promise<void> => {
    event.preventDefault();
    setDragOverColumn(null);

    if (!draggingTaskId || !token) return;

    const task = tasks.find((t) => t.id === draggingTaskId);
    if (!task || task.status === columnStatus) {
      setDraggingTaskId(null);
      return;
    }

    const taskId = draggingTaskId;
    setDraggingTaskId(null);

    // Optimistic update
    setTasks((current) =>
      current.map((t) => (t.id === taskId ? { ...t, status: columnStatus } : t))
    );

    try {
      await updateTaskApi(taskId, token, { status: columnStatus });
    } catch (dragError) {
      setError((dragError as Error).message || "Failed to move task.");
      await loadTasks(token);
    }
  };

  return (
    <AppShell
      title="Tasks"
      subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Create and track work items." />}
      projectId={params.projectId}
    >
      <section className="panel task-toolbar">
        <div className="task-toolbar-row">
          <h3 className="section-heading">Board</h3>
          {canWrite ? (
            <button className="button button-secondary" type="button" onClick={onNewTaskClick}>
              {showForm && formMode === "create" ? "Close" : "New task"}
            </button>
          ) : null}
        </div>
        {success ? <p className="alert alert-success">{success}</p> : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
      </section>

      {showForm && canWrite ? (
        <section className="panel">
          <h3 className="section-heading">{formMode === "edit" ? "Edit task" : "Create task"}</h3>
          <form className="form-grid" onSubmit={onSubmit}>
            <label>
              Title
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
                disabled={!canWrite || submitting}
              />
            </label>
            <label>
              Description
              <textarea
                className="input textarea-sm"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={20_000}
                disabled={!canWrite || submitting}
              />
            </label>
            <div className="grid cols-2 grid-tight">
              <label>
                Status
                <select
                  className="input"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as TaskStatus)}
                  disabled={!canWrite || submitting}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  className="input"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as TaskPriority)}
                  disabled={!canWrite || submitting}
                >
                  {priorityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Assignee
              <select
                className="input"
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                disabled={!canWrite || submitting}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name} ({member.email})
                  </option>
                ))}
              </select>
            </label>
            <div className="task-form-actions">
              <button className="button" type="submit" disabled={!canWrite || submitting}>
                {submitting ? "Saving..." : formMode === "edit" ? "Save changes" : "Create task"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={submitting}
                onClick={() => { setShowForm(false); resetForm(); }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {loading ? <p className="alert alert-info">Loading tasks...</p> : null}

      <section className="kanban">
        {taskColumns.map((column) => {
          const columnTasks = tasksByStatus[column.status];
          return (
            <article
              key={column.status}
              className={`kanban-column${dragOverColumn === column.status && draggingTaskId ? " kanban-column-drag-over" : ""}`}
              onDragOver={(event) => onColumnDragOver(column.status, event)}
              onDragLeave={onColumnDragLeave}
              onDrop={(event) => void onColumnDrop(column.status, event)}
            >
              <div className="kanban-column-header">
                <h3>{column.title}</h3>
                {columnTasks.length > 0 ? (
                  <span className="kanban-column-count">{columnTasks.length}</span>
                ) : null}
              </div>
              {columnTasks.length === 0 ? (
                <p className="kanban-empty">No tasks here.</p>
              ) : null}
              {columnTasks.map((task) => (
                <div
                  className={`list-item task-card${draggingTaskId === task.id ? " task-card-dragging" : ""}`}
                  key={task.id}
                  data-priority={task.priority}
                  draggable={canWrite}
                  onDragStart={(event) => onCardDragStart(task.id, event)}
                  onDragEnd={onCardDragEnd}
                  onContextMenu={(event) => onCardContextMenu(task.id, event)}
                >
                  <div className="task-card-header">
                    <strong>{task.title}</strong>
                    {canWrite ? (
                      <button
                        className="task-actions-button"
                        type="button"
                        aria-label="Task actions"
                        onClick={(event) => onCardActionsClick(task.id, event)}
                        disabled={activeTaskActionId === task.id}
                      >
                        ···
                      </button>
                    ) : null}
                  </div>
                  {task.description ? <p>{task.description}</p> : null}
                  <p className="task-assignee">
                    {task.assignee ? task.assignee.name : "Unassigned"}
                  </p>
                  <div className="task-meta">
                    <span className={`badge task-priority-badge task-priority-${task.priority}`}>
                      {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                    </span>
                    {task.dueDate ? (
                      <span className="badge">Due: {new Date(task.dueDate).toLocaleDateString()}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </article>
          );
        })}
      </section>

      {contextMenu ? (
        <div
          className="task-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="task-context-item"
            type="button"
            onClick={() => { openEditForm(contextMenu.taskId); }}
          >
            Edit
          </button>
          <button
            className="task-context-item task-context-item-danger"
            type="button"
            onClick={() => { void deleteTaskFromBoard(contextMenu.taskId); }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}
