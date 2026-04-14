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

export type AdminHardDeleteBlocker = {
  code:
    | "self_delete_forbidden"
    | "last_active_admin"
    | "projects_created"
    | "connected_project_repositories"
    | "documents_created"
    | "document_branches_created"
    | "document_versions_created"
    | "wiki_pages_created"
    | "wiki_revisions_created"
    | "wiki_drafts_updated"
    | "wiki_assets_uploaded"
    | "tasks_created"
    | "task_dependencies_created"
    | "meetings_created"
    | "invites_sent";
  label: string;
  count: number;
};

export type AdminUserHardDeleteCheck = {
  userId: string;
  allowed: boolean;
  blockers: AdminHardDeleteBlocker[];
};

export type AdminUserDeleteResult = {
  id: string;
  mode: "soft" | "hard";
  deletedAt: string | null;
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

export async function getAdminUserHardDeleteCheck(userId: string, token: string): Promise<AdminUserHardDeleteCheck> {
  return authFetch<AdminUserHardDeleteCheck>(`/admin/users/${userId}/hard-delete-check`, {
    token
  });
}

export async function deleteAdminUser(
  userId: string,
  token: string,
  mode: "soft" | "hard" = "soft"
): Promise<AdminUserDeleteResult> {
  return authFetch<AdminUserDeleteResult>(`/admin/users/${userId}?mode=${mode}`, {
    token,
    init: {
      method: "DELETE"
    }
  });
}
