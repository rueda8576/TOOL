import { authFetch } from "./client-api";

export type AdminManagedUser = {
  id: string;
  name: string;
  email: string;
  globalRole: "admin" | "editor" | "reader";
  isActive: boolean;
  createdAt: string;
  projectAccessMode: "all_projects" | "selected_projects";
  projects: Array<{ id: string; key: string; name: string; role: "editor" | "reader" }>;
};

export async function listAdminUsers(token: string): Promise<AdminManagedUser[]> {
  return authFetch<AdminManagedUser[]>("/admin/users", { token });
}

export async function updateAdminUser(
  userId: string,
  token: string,
  payload: {
    globalRole: "admin" | "editor" | "reader";
    projectAccess?: Array<{
      projectId: string;
      role: "editor" | "reader";
    }>;
  }
): Promise<AdminManagedUser> {
  return authFetch<AdminManagedUser>(`/admin/users/${userId}`, {
    token,
    init: {
      method: "PATCH",
      body: JSON.stringify(payload)
    }
  });
}

export async function deleteAdminUser(userId: string, token: string): Promise<{ id: string; deletedAt: string }> {
  return authFetch<{ id: string; deletedAt: string }>(`/admin/users/${userId}`, {
    token,
    init: {
      method: "DELETE"
    }
  });
}
