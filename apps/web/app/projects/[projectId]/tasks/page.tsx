"use client";

import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { ProjectSubtitle } from "../../../../components/project-subtitle";
import { LoginResponse } from "../../../../lib/client-api";
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

type TaskFormMode = "create" | "edit";
type ContextMenuState = { taskId: string; x: number; y: number } | null;

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

export default function ProjectTasksPage({
  params
}: {
  params: { projectId: string };
}): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
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

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    setUserRole(parseStoredUser(localStorage.getItem("doctoral_user"))?.globalRole ?? null);
    void loadTasks(storedToken);
    void loadMembers(storedToken);
  }, [loadMembers, loadTasks, router]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = (): void => {
      setContextMenu(null);
    };

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const tasksByStatus = useMemo(() => {
    return tasks.reduce<Record<TaskStatus, TaskListItem[]>>(
      (accumulator, task) => {
        accumulator[task.status].push(task);
        return accumulator;
      },
      {
        todo: [],
        in_progress: [],
        blocked: [],
        done: []
      }
    );
  }, [tasks]);

  const isReader = userRole === "reader";

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
    if (!task) {
      return;
    }

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
    if (isReader) {
      setError("Reader role cannot create tasks.");
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

    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (isReader) {
      setError("Reader role cannot create tasks.");
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

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
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    if (isReader) {
      setError("Reader role cannot delete tasks.");
      return;
    }

    const confirmed = window.confirm("Delete this task?");
    if (!confirmed) {
      setContextMenu(null);
      return;
    }

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
    if (isReader) {
      return;
    }

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

  return (
    <AppShell
      title="Tasks"
      subtitle={<ProjectSubtitle projectId={params.projectId} suffix="Create and track work items." />}
      projectId={params.projectId}
    >
      <section className="panel task-toolbar">
        <div className="task-toolbar-row">
          <h3 className="section-heading">Board</h3>
          <button className="button button-secondary" type="button" onClick={onNewTaskClick} disabled={isReader}>
            {showForm && formMode === "create" ? "Close" : "New task"}
          </button>
        </div>
        {isReader ? <p className="alert alert-info">Reader role can view tasks but cannot create, edit, or delete.</p> : null}
        {success ? <p className="alert alert-success">{success}</p> : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
      </section>

      {showForm ? (
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
                disabled={isReader || submitting}
              />
            </label>
            <label>
              Description
              <textarea
                className="input textarea-sm"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={20_000}
                disabled={isReader || submitting}
              />
            </label>
            <div className="grid cols-2 grid-tight">
              <label>
                Status
                <select
                  className="input"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as TaskStatus)}
                  disabled={isReader || submitting}
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
                  disabled={isReader || submitting}
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
                disabled={isReader || submitting}
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
              <button className="button" type="submit" disabled={isReader || submitting}>
                {submitting ? "Saving..." : formMode === "edit" ? "Save changes" : "Create task"}
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

      {loading ? <p className="alert alert-info">Loading tasks...</p> : null}

      <section className="kanban">
        {taskColumns.map((column) => (
          <article className="kanban-column" key={column.status}>
            <h3>{column.title}</h3>
            {tasksByStatus[column.status].length === 0 ? <p>No tasks in this column.</p> : null}
            {tasksByStatus[column.status].map((task) => (
              <div className="list-item task-card" key={task.id} onContextMenu={(event) => onCardContextMenu(task.id, event)}>
                <div className="task-card-header">
                  <strong>{task.title}</strong>
                  {!isReader ? (
                    <button
                      className="task-actions-button"
                      type="button"
                      aria-label="Task actions"
                      onClick={(event) => onCardActionsClick(task.id, event)}
                      disabled={activeTaskActionId === task.id}
                    >
                      ...
                    </button>
                  ) : null}
                </div>
                {task.description ? <p>{task.description}</p> : null}
                <p className="task-assignee">
                  Assigned to: {task.assignee ? `${task.assignee.name} (${task.assignee.email})` : "Unassigned"}
                </p>
                <div className="task-meta">
                  <span className="badge">Priority: {task.priority}</span>
                  {task.dueDate ? <span className="badge">Due: {new Date(task.dueDate).toLocaleDateString()}</span> : null}
                </div>
              </div>
            ))}
          </article>
        ))}
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
            onClick={() => {
              openEditForm(contextMenu.taskId);
            }}
          >
            Edit
          </button>
          <button
            className="task-context-item task-context-item-danger"
            type="button"
            onClick={() => {
              void deleteTaskFromBoard(contextMenu.taskId);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}
