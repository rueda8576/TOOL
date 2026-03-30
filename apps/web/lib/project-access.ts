import { authFetch } from "./client-api";

export type ProjectAccess = {
  isAdmin: boolean;
  projectRole: "admin" | "editor" | "reader";
  canWrite: boolean;
};

export async function getProjectAccess(projectId: string, token: string): Promise<ProjectAccess> {
  return authFetch<ProjectAccess>(`/projects/${projectId}/access`, { token });
}
