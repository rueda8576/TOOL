import { authFetch } from "./client-api";

export type ProjectOverviewSeverity = "danger" | "warning" | "info";
export type ProjectOverviewModule = "wiki" | "documents" | "code" | "tasks" | "meetings" | "project";

export type ProjectOverviewAttentionItem = {
  id: string;
  severity: ProjectOverviewSeverity;
  module: ProjectOverviewModule;
  title: string;
  detail: string;
  href: string;
  date: string | null;
};

export type ProjectOverviewActivityItem = {
  id: string;
  module: ProjectOverviewModule;
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
};

export type ProjectOverview = {
  project: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  };
  access: {
    isAdmin: boolean;
    projectRole: "admin" | "editor" | "reader";
    canWrite: boolean;
  };
  attention: ProjectOverviewAttentionItem[];
  modules: {
    wiki: {
      publishedPages: number;
      draftPages: number;
      latestUpdatedAt: string | null;
      recentPages: Array<{ id: string; title: string; path: string; updatedAt: string; isDraft: boolean }>;
    };
    documents: {
      total: number;
      failedCompiles: number;
      runningCompiles: number;
      latestUpdatedAt: string | null;
      recent: Array<{ id: string; title: string; type: string; updatedAt: string; compileStatus: string | null }>;
    };
    code: {
      connected: boolean;
      pathWithNamespace: string | null;
      defaultBranch: string | null;
      lastActivityAt: string | null;
    };
    tasks: {
      open: number;
      inProgress: number;
      blocked: number;
      overdue: number;
      critical: number;
      next: Array<{ id: string; title: string; priority: string; status: string; dueDate: string | null; assigneeName: string | null }>;
    };
    meetings: {
      thisMonth: number;
      upcoming: number;
      openActions: number;
      next: Array<{ id: string; title: string; scheduledAt: string; scheduledDate: string; location: string | null; actionsCount: number }>;
    };
  };
  activity: ProjectOverviewActivityItem[];
};

export async function getProjectOverview(projectId: string, token: string): Promise<ProjectOverview> {
  return authFetch<ProjectOverview>(`/projects/${projectId}/overview`, { token });
}
