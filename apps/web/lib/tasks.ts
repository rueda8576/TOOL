import type {
  CreateTaskInput,
  TaskListItem,
  UpdateTaskInput
} from "@doctoral/shared";

import { authFetch } from "./client-api";

export type {
  CreateTaskInput,
  TaskAssignee,
  TaskListItem,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput
} from "@doctoral/shared";

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
