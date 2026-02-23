import { authFetch } from "./client-api";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export type TaskAssignee = {
  id: string;
  name: string;
  email: string;
};

export type TaskListItem = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee: TaskAssignee | null;
  startDate: string | null;
  dueDate: string | null;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskInput = {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  startDate?: string;
  dueDate?: string;
  parentTaskId?: string;
};

export type UpdateTaskInput = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  startDate?: string;
  dueDate?: string;
};

export type ProjectMember = {
  userId: string;
  name: string;
  email: string;
};

export async function listProjectTasks(projectId: string, token: string, includeSubtasks = false): Promise<TaskListItem[]> {
  const query = includeSubtasks ? "?includeSubtasks=true" : "";
  return authFetch<TaskListItem[]>(`/projects/${projectId}/tasks${query}`, { token });
}

export async function listProjectMembers(projectId: string, token: string): Promise<ProjectMember[]> {
  return authFetch<ProjectMember[]>(`/projects/${projectId}/members`, { token });
}

export async function createProjectTask(
  projectId: string,
  token: string,
  payload: CreateTaskInput
): Promise<{ id: string; projectId: string; title: string; status: string; priority: string; parentTaskId: string | null }> {
  return authFetch<{ id: string; projectId: string; title: string; status: string; priority: string; parentTaskId: string | null }>(
    `/projects/${projectId}/tasks`,
    {
      token,
      init: {
        method: "POST",
        body: JSON.stringify(payload)
      }
    }
  );
}

export async function updateTask(
  taskId: string,
  token: string,
  payload: UpdateTaskInput
): Promise<{ id: string; projectId: string; title: string; status: string; priority: string; assigneeId: string | null }> {
  return authFetch<{ id: string; projectId: string; title: string; status: string; priority: string; assigneeId: string | null }>(
    `/tasks/${taskId}`,
    {
      token,
      init: {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    }
  );
}

export async function deleteTask(taskId: string, token: string): Promise<{ id: string; deletedAt: string }> {
  return authFetch<{ id: string; deletedAt: string }>(`/tasks/${taskId}`, {
    token,
    init: {
      method: "DELETE"
    }
  });
}
