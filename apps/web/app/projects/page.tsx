"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import {
  AdminManagedUser,
  AdminUserHardDeleteCheck,
  deleteAdminUser,
  getAdminUserHardDeleteCheck,
  listAdminUsers,
  updateAdminUser
} from "../../lib/admin-users";
import { authFetch, LoginResponse } from "../../lib/client-api";
import { ProjectSummary } from "../../lib/api";
import { useConfirmDialog } from "../../lib/use-confirm-dialog";

type ProjectOrderBy = "newest" | "key" | "name";
type InviteAccessMode = "all" | "selected";
type WorkspaceMode = "projects" | "users";
type ProjectScopedRole = "editor" | "reader";
type ProjectRoleMap = Record<string, ProjectScopedRole>;

type CreateProjectResponse = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

type InviteResponse = {
  inviteId: string;
  token: string;
  expiresAt: string;
};

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

function parseProjectCreatedAt(project: ProjectSummary): number {
  const timestamp = Date.parse(project.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareProjectsWithinGroup(left: ProjectSummary, right: ProjectSummary, orderBy: ProjectOrderBy): number {
  if (orderBy === "newest") {
    const newestFirst = parseProjectCreatedAt(right) - parseProjectCreatedAt(left);
    if (newestFirst !== 0) {
      return newestFirst;
    }
  }

  if (orderBy === "key") {
    const byKey = left.key.localeCompare(right.key, undefined, { sensitivity: "base" });
    if (byKey !== 0) {
      return byKey;
    }
  }

  if (orderBy === "name") {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    if (byName !== 0) {
      return byName;
    }
  }

  const fallbackNewest = parseProjectCreatedAt(right) - parseProjectCreatedAt(left);
  if (fallbackNewest !== 0) {
    return fallbackNewest;
  }

  return left.key.localeCompare(right.key, undefined, { sensitivity: "base" });
}

function buildProjectRoleMap(projects: Array<{ id: string; role: ProjectScopedRole }>): ProjectRoleMap {
  return Object.fromEntries(projects.map((project) => [project.id, project.role]));
}

function countProjectRoleMap(projectRoleMap: ProjectRoleMap): number {
  return Object.keys(projectRoleMap).length;
}

export default function ProjectsPage(): JSX.Element {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [token, setToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [orderBy, setOrderBy] = useState<ProjectOrderBy>("newest");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("projects");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [pinBusyProjectId, setPinBusyProjectId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<LoginResponse["user"]["globalRole"]>("reader");
  const [inviteAccessMode, setInviteAccessMode] = useState<InviteAccessMode>("all");
  const [inviteDefaultProjectRole, setInviteDefaultProjectRole] = useState<ProjectScopedRole>("reader");
  const [inviteProjectQuery, setInviteProjectQuery] = useState("");
  const [inviteProjectAccess, setInviteProjectAccess] = useState<ProjectRoleMap>({});
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminManagedUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null);
  const [adminUsersSuccess, setAdminUsersSuccess] = useState<string | null>(null);
  const [adminUsersQuery, setAdminUsersQuery] = useState("");
  const [selectedManagedUserId, setSelectedManagedUserId] = useState<string | null>(null);
  const [editingUserRole, setEditingUserRole] = useState<LoginResponse["user"]["globalRole"]>("reader");
  const [editingUserProjectAccess, setEditingUserProjectAccess] = useState<ProjectRoleMap>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [hardDeleteCheckByUserId, setHardDeleteCheckByUserId] = useState<Record<string, AdminUserHardDeleteCheck>>({});
  const [hardDeleteCheckLoadingId, setHardDeleteCheckLoadingId] = useState<string | null>(null);
  const [hardDeleteCheckError, setHardDeleteCheckError] = useState<string | null>(null);

  const loadProjects = useCallback(
    async (authToken: string): Promise<void> => {
      setLoading(true);
      try {
        const data = await authFetch<ProjectSummary[]>("/projects", { token: authToken });
        setProjects(data);
        setListError(null);
      } catch (fetchError) {
        localStorage.removeItem("doctoral_token");
        localStorage.removeItem("doctoral_user");
        setListError((fetchError as Error).message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadAdminUsers = useCallback(async (authToken: string): Promise<void> => {
    setAdminUsersLoading(true);

    try {
      const users = await listAdminUsers(authToken);
      setAdminUsers(users);
      setHardDeleteCheckByUserId((current) =>
        Object.fromEntries(users.flatMap((user) => (current[user.id] ? [[user.id, current[user.id]]] : [])))
      );
      setAdminUsersError(null);
    } catch (error) {
      setAdminUsersError((error as Error).message);
    } finally {
      setAdminUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    const storedUser = parseStoredUser(localStorage.getItem("doctoral_user"));
    setCurrentUserId(storedUser?.id ?? null);
    setUserRole(storedUser?.globalRole ?? null);
    void loadProjects(storedToken);
  }, [loadProjects, router]);

  const isAdmin = userRole === "admin";

  useEffect(() => {
    if (workspaceMode !== "users" || !token || !isAdmin) {
      return;
    }

    void loadAdminUsers(token);
  }, [isAdmin, loadAdminUsers, token, workspaceMode]);

  useEffect(() => {
    const availableProjectIds = new Set(projects.map((project) => project.id));
    setInviteProjectAccess((current) =>
      Object.fromEntries(Object.entries(current).filter(([projectId]) => availableProjectIds.has(projectId)))
    );
    setEditingUserProjectAccess((current) =>
      Object.fromEntries(Object.entries(current).filter(([projectId]) => availableProjectIds.has(projectId)))
    );
  }, [projects]);

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((left, right) => {
        if (left.isPinned !== right.isPinned) {
          return left.isPinned ? -1 : 1;
        }

        return compareProjectsWithinGroup(left, right, orderBy);
      }),
    [orderBy, projects]
  );

  const filteredInviteProjects = useMemo(() => {
    const query = inviteProjectQuery.trim().toLowerCase();
    if (!query) {
      return sortedProjects;
    }

    return sortedProjects.filter((project) =>
      project.key.toLowerCase().includes(query) || project.name.toLowerCase().includes(query)
    );
  }, [inviteProjectQuery, sortedProjects]);

  const filteredAdminUsers = useMemo(() => {
    const query = adminUsersQuery.trim().toLowerCase();
    if (!query) {
      return adminUsers;
    }

    return adminUsers.filter((managedUser) =>
      managedUser.name.toLowerCase().includes(query) || managedUser.email.toLowerCase().includes(query)
    );
  }, [adminUsers, adminUsersQuery]);

  const selectedManagedUser = useMemo(
    () => adminUsers.find((managedUser) => managedUser.id === selectedManagedUserId) ?? null,
    [adminUsers, selectedManagedUserId]
  );
  const selectedManagedUserHardDeleteCheck = useMemo(
    () => (selectedManagedUser ? hardDeleteCheckByUserId[selectedManagedUser.id] ?? null : null),
    [hardDeleteCheckByUserId, selectedManagedUser]
  );

  useEffect(() => {
    if (workspaceMode !== "users") {
      return;
    }

    if (filteredAdminUsers.length === 0) {
      setSelectedManagedUserId(null);
      return;
    }

    const hasSelectedUser = filteredAdminUsers.some((managedUser) => managedUser.id === selectedManagedUserId);
    if (!hasSelectedUser) {
      setSelectedManagedUserId(filteredAdminUsers[0]?.id ?? null);
    }
  }, [filteredAdminUsers, selectedManagedUserId, workspaceMode]);

  useEffect(() => {
    if (!selectedManagedUser) {
      return;
    }

    setEditingUserRole(selectedManagedUser.globalRole);
    setEditingUserProjectAccess(buildProjectRoleMap(selectedManagedUser.projects));
  }, [selectedManagedUser]);

  useEffect(() => {
    if (!token || workspaceMode !== "users" || !selectedManagedUser) {
      setHardDeleteCheckError(null);
      return;
    }

    let active = true;
    setHardDeleteCheckError(null);
    setHardDeleteCheckLoadingId(selectedManagedUser.id);

    void getAdminUserHardDeleteCheck(selectedManagedUser.id, token)
      .then((check) => {
        if (!active) {
          return;
        }

        setHardDeleteCheckByUserId((current) => ({
          ...current,
          [check.userId]: check
        }));
      })
      .catch((error) => {
        if (active) {
          setHardDeleteCheckError((error as Error).message);
        }
      })
      .finally(() => {
        if (active) {
          setHardDeleteCheckLoadingId(null);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedManagedUser, token, workspaceMode]);

  const onCreateProject = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!token) {
      setCreateError("Missing session token. Please sign in again.");
      return;
    }

    if (!isAdmin) {
      setCreateError("Only admins can create projects.");
      return;
    }

    const key = projectKey.trim().toUpperCase();
    const name = projectName.trim();
    const description = projectDescription.trim();

    if (!/^[A-Z0-9_-]+$/.test(key)) {
      setCreateError("Project key must use uppercase letters, numbers, _ or -.");
      return;
    }

    if (name.length < 2) {
      setCreateError("Project name must contain at least 2 characters.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);
    setDeleteSuccess(null);

    try {
      await authFetch<CreateProjectResponse>("/projects", {
        token,
        init: {
          method: "POST",
          body: JSON.stringify({
            key,
            name,
            description: description || undefined
          })
        }
      });

      setProjectKey("");
      setProjectName("");
      setProjectDescription("");
      setCreateSuccess("Project created successfully.");
      setIsCreateOpen(false);
      await loadProjects(token);
    } catch (submitError) {
      setCreateError((submitError as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onDeleteProject = async (project: ProjectSummary): Promise<void> => {
    if (!token || deletingProjectId) {
      return;
    }

    if (!isAdmin) {
      setDeleteError("Only admins can delete projects.");
      return;
    }

    const confirmed = await confirm({
      title: "Delete project",
      message: `Delete project ${project.key} - ${project.name}?`,
      confirmLabel: "Delete project",
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    setDeletingProjectId(project.id);
    setDeleteError(null);
    setDeleteSuccess(null);
    setCreateSuccess(null);

    try {
      await authFetch<{ id: string; deletedAt: string }>(`/projects/${project.id}`, {
        token,
        init: {
          method: "DELETE"
        }
      });
      setDeleteSuccess(`Project ${project.key} deleted successfully.`);
      await loadProjects(token);
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeletingProjectId(null);
    }
  };

  const onTogglePin = async (project: ProjectSummary): Promise<void> => {
    if (!token || pinBusyProjectId) {
      return;
    }

    setPinBusyProjectId(project.id);
    setPinError(null);

    try {
      await authFetch<{ projectId: string; pinned: boolean }>(`/projects/${project.id}/pin`, {
        token,
        init: {
          method: project.isPinned ? "DELETE" : "POST"
        }
      });
      await loadProjects(token);
    } catch (error) {
      setPinError((error as Error).message);
    } finally {
      setPinBusyProjectId(null);
    }
  };

  const onToggleInviteProject = (projectId: string): void => {
    setInviteProjectAccess((current) => {
      if (current[projectId]) {
        const { [projectId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [projectId]: inviteDefaultProjectRole
      };
    });
  };

  const onSetInviteProjectRole = (projectId: string, role: ProjectScopedRole): void => {
    setInviteProjectAccess((current) => ({
      ...current,
      [projectId]: role
    }));
  };

  const onSelectAllVisibleInviteProjects = (): void => {
    if (filteredInviteProjects.length === 0) {
      return;
    }

    setInviteProjectAccess((current) => {
      const next = { ...current };
      filteredInviteProjects.forEach((project) => {
        if (!next[project.id]) {
          next[project.id] = inviteDefaultProjectRole;
        }
      });
      return next;
    });
  };

  const onClearInviteProjects = (): void => {
    setInviteProjectAccess({});
  };

  const onSendInvite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!token) {
      setInviteError("Missing session token. Please sign in again.");
      return;
    }

    if (!isAdmin) {
      setInviteError("Only admins can send invitations.");
      return;
    }

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setInviteError("Email is required.");
      return;
    }

    const inviteSelectedProjects = Object.entries(inviteProjectAccess).map(([projectId, role]) => ({
      projectId,
      role
    }));

    if (inviteRole !== "admin" && inviteAccessMode === "selected" && inviteSelectedProjects.length === 0) {
      setInviteError("Select at least one project or choose all current projects.");
      return;
    }

    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      await authFetch<InviteResponse>("/auth/invite", {
        token,
        init: {
          method: "POST",
          body: JSON.stringify(
            inviteRole === "admin"
              ? {
                  email,
                  globalRole: inviteRole,
                  accessMode: "all"
                }
              : {
                  email,
                  globalRole: inviteRole,
                  accessMode: inviteAccessMode,
                  defaultProjectRole: inviteAccessMode === "all" ? inviteDefaultProjectRole : undefined,
                  projectAccess: inviteAccessMode === "selected" ? inviteSelectedProjects : undefined
                }
          )
        }
      });

      setInviteEmail("");
      setInviteRole("reader");
      setInviteAccessMode("all");
      setInviteDefaultProjectRole("reader");
      setInviteProjectQuery("");
      setInviteProjectAccess({});
      setInviteSuccess(`Invitation sent to ${email}.`);
    } catch (error) {
      setInviteError((error as Error).message);
    } finally {
      setInviting(false);
    }
  };

  const onToggleManageUsers = (): void => {
    if (!token || !isAdmin) {
      return;
    }

    setAdminUsersError(null);
    setAdminUsersSuccess(null);
    setHardDeleteCheckError(null);
    setWorkspaceMode((current) => {
      const next = current === "users" ? "projects" : "users";
      if (next === "users") {
        setIsCreateOpen(false);
        setIsInviteOpen(false);
        void loadAdminUsers(token);
      }
      return next;
    });
  };

  const onSelectManagedUser = (managedUser: AdminManagedUser): void => {
    setAdminUsersError(null);
    setAdminUsersSuccess(null);
    setHardDeleteCheckError(null);
    setSelectedManagedUserId(managedUser.id);
  };

  const onToggleEditingUserProject = (projectId: string): void => {
    setEditingUserProjectAccess((current) => {
      if (current[projectId]) {
        const { [projectId]: _removed, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [projectId]: "reader"
      };
    });
  };

  const onSetEditingUserProjectRole = (projectId: string, role: ProjectScopedRole): void => {
    setEditingUserProjectAccess((current) => ({
      ...current,
      [projectId]: role
    }));
  };

  const onResetManagedUserForm = (): void => {
    if (!selectedManagedUser) {
      return;
    }

    setEditingUserRole(selectedManagedUser.globalRole);
    setEditingUserProjectAccess(buildProjectRoleMap(selectedManagedUser.projects));
  };

  const onSaveManagedUser = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!token || !selectedManagedUser) {
      return;
    }

    setSavingUserId(selectedManagedUser.id);
    setAdminUsersError(null);
    setAdminUsersSuccess(null);

    try {
      const updatedUser = await updateAdminUser(selectedManagedUser.id, token, {
        globalRole: editingUserRole,
        projectAccess:
          editingUserRole === "admin"
            ? undefined
            : Object.entries(editingUserProjectAccess).map(([projectId, role]) => ({
                projectId,
                role
              }))
      });

      setAdminUsers((current) => current.map((managedUser) => (managedUser.id === updatedUser.id ? updatedUser : managedUser)));
      setSelectedManagedUserId(updatedUser.id);
      setEditingUserProjectAccess(buildProjectRoleMap(updatedUser.projects));
      setAdminUsersSuccess(`${updatedUser.name} updated successfully.`);

      if (updatedUser.id === currentUserId && updatedUser.globalRole !== userRole) {
        localStorage.removeItem("doctoral_token");
        localStorage.removeItem("doctoral_user");
        router.replace("/login");
      }
    } catch (error) {
      setAdminUsersError((error as Error).message);
    } finally {
      setSavingUserId(null);
    }
  };

  const onDeleteManagedUser = async (managedUser: AdminManagedUser, mode: "soft" | "hard"): Promise<void> => {
    if (!token || deletingUserId) {
      return;
    }

    const confirmed = await confirm({
      title: mode === "hard" ? "Hard delete user" : "Delete user",
      message:
        mode === "hard"
          ? `Hard delete user ${managedUser.name} (${managedUser.email})? This permanently removes the account and only works when no historical records depend on it.`
          : `Delete user ${managedUser.name} (${managedUser.email})? They will lose access immediately.`,
      confirmLabel: mode === "hard" ? "Hard delete user" : "Delete user",
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    setDeletingUserId(managedUser.id);
    setAdminUsersError(null);
    setAdminUsersSuccess(null);
    setHardDeleteCheckError(null);

    try {
      await deleteAdminUser(managedUser.id, token, mode);
      setAdminUsers((current) => current.filter((user) => user.id !== managedUser.id));
      setHardDeleteCheckByUserId((current) => {
        const next = { ...current };
        delete next[managedUser.id];
        return next;
      });
      setAdminUsersSuccess(
        mode === "hard"
          ? `${managedUser.name} was permanently deleted.`
          : `${managedUser.name} was soft-deleted successfully.`
      );
      setSelectedManagedUserId((current) => (current === managedUser.id ? null : current));
    } catch (error) {
      setAdminUsersError((error as Error).message);
    } finally {
      setDeletingUserId(null);
    }
  };

  const workspaceTitle = workspaceMode === "users" ? "Manage users" : "Project directory";
  const workspaceHelper = workspaceMode === "users"
    ? "Admins can edit account roles, adjust per-project permissions, and revoke access."
    : "Pinned projects always stay at the top.";

  return (
    <AppShell title="Projects" subtitle="Browse workspaces and manage access.">
      <section className="panel projects-directory-panel">
        <div className="projects-toolbar-row">
          <div>
            <h2 className="section-heading">{workspaceTitle}</h2>
            <p className="projects-toolbar-helper">{workspaceHelper}</p>
          </div>
          <div className="projects-toolbar-actions">
            {workspaceMode === "projects" ? (
              <label className="projects-order-control">
                Order by
                <select className="input" value={orderBy} onChange={(event) => setOrderBy(event.target.value as ProjectOrderBy)}>
                  <option value="newest">Newest</option>
                  <option value="key">Key</option>
                  <option value="name">Name</option>
                </select>
              </label>
            ) : null}
            {isAdmin && workspaceMode === "projects" ? (
              <button
                className="button button-secondary projects-invite-toggle-button"
                type="button"
                onClick={() => {
                  setInviteSuccess(null);
                  setInviteError(null);
                  setIsInviteOpen((current) => !current);
                }}
              >
                {isInviteOpen ? "Close invite" : "Invite user"}
              </button>
            ) : null}
            {isAdmin ? (
              <button className="button button-secondary projects-invite-toggle-button" type="button" onClick={onToggleManageUsers}>
                {workspaceMode === "users" ? "Back to projects" : "Manage users"}
              </button>
            ) : null}
            {isAdmin && workspaceMode === "projects" ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setCreateSuccess(null);
                  setCreateError(null);
                  setDeleteSuccess(null);
                  setDeleteError(null);
                  setIsCreateOpen((current) => !current);
                }}
              >
                {isCreateOpen ? "Close" : "New project"}
              </button>
            ) : null}
          </div>
        </div>

        {createSuccess ? <p className="alert alert-success">{createSuccess}</p> : null}
        {createError ? <p className="alert alert-error">{createError}</p> : null}
        {deleteSuccess ? <p className="alert alert-success">{deleteSuccess}</p> : null}
        {deleteError ? <p className="alert alert-error">{deleteError}</p> : null}
        {pinError ? <p className="alert alert-error">{pinError}</p> : null}
        {inviteSuccess ? <p className="alert alert-success">{inviteSuccess}</p> : null}
        {inviteError ? <p className="alert alert-error">{inviteError}</p> : null}
        {adminUsersSuccess ? <p className="alert alert-success">{adminUsersSuccess}</p> : null}
        {adminUsersError ? <p className="alert alert-error">{adminUsersError}</p> : null}
        {hardDeleteCheckError ? <p className="alert alert-error">{hardDeleteCheckError}</p> : null}
        {listError ? (
          <p className="alert alert-error">
            {listError}. Please <Link href="/login">sign in again</Link>.
          </p>
        ) : null}

        {workspaceMode === "projects" ? (
          <>
            {isCreateOpen && isAdmin ? (
              <div className="projects-create-collapsible">
                <h3 className="section-heading">Create project</h3>
                <form className="form-grid" onSubmit={onCreateProject}>
                  <div className="grid cols-2 grid-tight">
                    <label>
                      Key
                      <input
                        className="input"
                        value={projectKey}
                        onChange={(event) => setProjectKey(event.target.value.toUpperCase())}
                        placeholder="PHD1"
                        maxLength={20}
                        required
                        disabled={creating}
                      />
                    </label>
                    <label>
                      Name
                      <input className="input" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={150} required disabled={creating} />
                    </label>
                  </div>
                  <label>
                    Description
                    <textarea
                      className="input textarea-sm"
                      value={projectDescription}
                      onChange={(event) => setProjectDescription(event.target.value)}
                      maxLength={5000}
                      disabled={creating}
                    />
                  </label>
                  <button className="button" type="submit" disabled={creating}>
                    {creating ? "Creating..." : "Create project"}
                  </button>
                </form>
              </div>
            ) : null}

            {isAdmin && isInviteOpen ? (
              <div className="projects-create-collapsible projects-invite-panel">
                <h3 className="section-heading">Invite user</h3>
                <form className="form-grid" onSubmit={onSendInvite}>
                  <div className="grid cols-2 grid-tight">
                    <label>
                      Email
                      <input
                        className="input"
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="user@example.com"
                        required
                        disabled={inviting}
                      />
                    </label>
                    <label>
                      Account role
                      <select
                        className="input"
                        value={inviteRole}
                        onChange={(event) => {
                          const nextRole = event.target.value as LoginResponse["user"]["globalRole"];
                          setInviteRole(nextRole);
                          if (nextRole === "admin") {
                            setInviteAccessMode("all");
                            setInviteProjectAccess({});
                            setInviteProjectQuery("");
                          }
                        }}
                        disabled={inviting}
                      >
                        <option value="reader">Reader</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                  </div>

                  {inviteRole === "admin" ? (
                    <p className="alert alert-info">Admins have global access to every project.</p>
                  ) : (
                    <>
                      <div className="grid cols-2 grid-tight">
                        <label>
                          Access mode
                          <select
                            className="input"
                            value={inviteAccessMode}
                            onChange={(event) => {
                              setInviteAccessMode(event.target.value as InviteAccessMode);
                              setInviteProjectQuery("");
                            }}
                            disabled={inviting}
                          >
                            <option value="all">All current projects</option>
                            <option value="selected">Selected projects</option>
                          </select>
                        </label>
                        <label>
                          Default project role
                          <select
                            className="input"
                            value={inviteDefaultProjectRole}
                            onChange={(event) => setInviteDefaultProjectRole(event.target.value as ProjectScopedRole)}
                            disabled={inviting}
                          >
                            <option value="reader">Reader</option>
                            <option value="editor">Editor</option>
                          </select>
                        </label>
                      </div>

                      {inviteAccessMode === "selected" ? (
                        <fieldset className="projects-invite-projects">
                          <legend>Select projects</legend>
                          {sortedProjects.length === 0 ? (
                            <p className="alert alert-info">No projects available.</p>
                          ) : (
                            <>
                              <div className="projects-invite-selector-toolbar">
                                <p className="projects-invite-selection-summary">{countProjectRoleMap(inviteProjectAccess)} selected</p>
                                <div className="projects-invite-selection-actions">
                                  <button
                                    className="button button-ghost"
                                    type="button"
                                    onClick={onSelectAllVisibleInviteProjects}
                                    disabled={inviting || filteredInviteProjects.length === 0}
                                  >
                                    Select all visible
                                  </button>
                                  <button
                                    className="button button-ghost"
                                    type="button"
                                    onClick={onClearInviteProjects}
                                    disabled={inviting || countProjectRoleMap(inviteProjectAccess) === 0}
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>

                              <label className="projects-invite-search">
                                Search projects
                                <input
                                  className="input"
                                  type="search"
                                  value={inviteProjectQuery}
                                  onChange={(event) => setInviteProjectQuery(event.target.value)}
                                  placeholder="Filter by key or name"
                                  disabled={inviting}
                                />
                              </label>

                              {filteredInviteProjects.length === 0 ? (
                                <p className="alert alert-info">No projects match the current search.</p>
                              ) : (
                                <div className="projects-invite-checkboxes">
                                  {filteredInviteProjects.map((project) => {
                                    const selectedRole = inviteProjectAccess[project.id];
                                    const isSelected = Boolean(selectedRole);

                                    return (
                                      <label
                                        className={`projects-invite-checkbox${isSelected ? " projects-invite-checkbox-selected" : ""}`}
                                        key={`invite-${project.id}`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => onToggleInviteProject(project.id)}
                                          disabled={inviting}
                                        />
                                        <div className="projects-invite-checkbox-content">
                                          <div className="projects-invite-checkbox-main">
                                            <strong>{project.key}</strong>
                                            <span>{project.name}</span>
                                          </div>
                                          <div className="projects-role-pillars">
                                            {isSelected ? (
                                              <select
                                                className="input projects-role-select"
                                                value={selectedRole}
                                                onChange={(event) => onSetInviteProjectRole(project.id, event.target.value as ProjectScopedRole)}
                                                onClick={(event) => event.stopPropagation()}
                                                disabled={inviting}
                                              >
                                                <option value="reader">Reader</option>
                                                <option value="editor">Editor</option>
                                              </select>
                                            ) : null}
                                            {project.isPinned ? <span className="badge projects-pinned-badge">Pinned</span> : null}
                                          </div>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}
                        </fieldset>
                      ) : (
                        <p className="projects-toolbar-helper">
                          The invited user will receive the selected project role on every current project when they accept the invite.
                        </p>
                      )}
                    </>
                  )}

                  <button className="button" type="submit" disabled={inviting}>
                    {inviting ? "Sending..." : "Send invitation"}
                  </button>
                </form>
              </div>
            ) : null}

            {loading ? <p className="alert alert-info">Loading projects...</p> : null}

            {!loading && !listError ? (
              sortedProjects.length > 0 ? (
                <ul className="list projects-directory-list">
                  {sortedProjects.map((project) => (
                    <li className="list-item" key={project.id}>
                      <div className="projects-list-header">
                        <strong>
                          {project.key} - {project.name}
                        </strong>
                        {project.isPinned ? <span className="badge projects-pinned-badge">Pinned</span> : null}
                      </div>
                      <p>{project.description ?? "No description"}</p>
                      <div className="projects-list-actions">
                        <Link className="button button-secondary" href={`/projects/${project.id}`}>
                          Open project
                        </Link>
                        {isAdmin ? (
                          <button
                            className="button button-danger"
                            type="button"
                            disabled={deletingProjectId === project.id}
                            onClick={() => {
                              void onDeleteProject(project);
                            }}
                          >
                            {deletingProjectId === project.id ? "Deleting..." : "Delete"}
                          </button>
                        ) : null}
                        <button
                          className="button button-ghost"
                          type="button"
                          disabled={pinBusyProjectId === project.id}
                          onClick={() => {
                            void onTogglePin(project);
                          }}
                        >
                          {pinBusyProjectId === project.id ? "Saving..." : project.isPinned ? "Unpin" : "Pin"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="alert alert-info">No projects found.</p>
              )
            ) : null}
          </>
        ) : (
          <div className="projects-users-workspace">
            <aside className="projects-users-sidebar">
              <div className="projects-users-panel-header">
                <div>
                  <h3 className="section-heading">User list</h3>
                  <p className="projects-toolbar-helper">Select a user to edit account role and per-project access.</p>
                </div>
                <label className="projects-users-search">
                  Search users
                  <input
                    className="input"
                    type="search"
                    value={adminUsersQuery}
                    onChange={(event) => setAdminUsersQuery(event.target.value)}
                    placeholder="Filter by name or email"
                    disabled={adminUsersLoading || savingUserId !== null || deletingUserId !== null}
                  />
                </label>
              </div>

              {adminUsersLoading ? <p className="alert alert-info">Loading users...</p> : null}
              {!adminUsersLoading && filteredAdminUsers.length === 0 ? (
                <p className="alert alert-info">
                  {adminUsers.length === 0 ? "No active users found." : "No users match the current search."}
                </p>
              ) : null}

              {!adminUsersLoading && filteredAdminUsers.length > 0 ? (
                <div className="projects-users-list projects-users-list-pane">
                  {filteredAdminUsers.map((managedUser) => {
                    const isSelected = managedUser.id === selectedManagedUserId;

                    return (
                      <button
                        key={managedUser.id}
                        type="button"
                        className={`projects-users-list-button${isSelected ? " projects-users-list-button-selected" : ""}`}
                        onClick={() => onSelectManagedUser(managedUser)}
                      >
                        <div className="projects-users-list-button-header">
                          <div>
                            <strong>{managedUser.name}</strong>
                            <p className="projects-users-email">{managedUser.email}</p>
                          </div>
                          <span className="badge">{managedUser.globalRole}</span>
                        </div>
                        <p className="projects-users-access-summary">
                          {managedUser.projectAccessMode === "all_projects"
                            ? "All projects"
                            : managedUser.projects.length > 0
                              ? `${managedUser.projects.length} assigned project${managedUser.projects.length === 1 ? "" : "s"}`
                              : "No project access"}
                        </p>
                        <div className="projects-users-projects">
                          {managedUser.projectAccessMode === "all_projects" ? (
                            <span className="projects-users-project-hint">Admins have global access.</span>
                          ) : managedUser.projects.length > 0 ? (
                            managedUser.projects.map((project) => (
                              <span className="badge" key={`${managedUser.id}-${project.id}`}>
                                {project.key} {project.role === "editor" ? "Editor" : "Reader"}
                              </span>
                            ))
                          ) : (
                            <span className="projects-users-project-hint">No project membership assigned.</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </aside>

            <section className="projects-users-detail panel">
              {selectedManagedUser ? (
                <>
                  <div className="projects-users-editor-header">
                    <div>
                      <h3 className="section-heading">{selectedManagedUser.name}</h3>
                      <p className="projects-toolbar-helper">{selectedManagedUser.email}</p>
                    </div>
                    <div className="projects-users-delete-stack">
                      <button
                        className="button button-danger"
                        type="button"
                        onClick={() => {
                          void onDeleteManagedUser(selectedManagedUser, "soft");
                        }}
                        disabled={selectedManagedUser.id === currentUserId || deletingUserId === selectedManagedUser.id || savingUserId !== null}
                        title={selectedManagedUser.id === currentUserId ? "Admins cannot delete their own account." : undefined}
                      >
                        {deletingUserId === selectedManagedUser.id ? "Deleting..." : "Delete user"}
                      </button>
                    </div>
                  </div>

                  <section className="projects-users-delete-panel">
                    <div className="projects-users-delete-panel-header">
                      <strong>Hard delete</strong>
                      <p className="projects-toolbar-helper">
                        Permanently remove the account only when it does not own restrictive historical records.
                      </p>
                    </div>
                    {hardDeleteCheckLoadingId === selectedManagedUser.id ? (
                      <p className="alert alert-info">Checking whether hard delete is safe...</p>
                    ) : null}
                    {selectedManagedUserHardDeleteCheck?.allowed ? (
                      <p className="alert alert-success">Hard delete is available for this user.</p>
                    ) : null}
                    {selectedManagedUserHardDeleteCheck && !selectedManagedUserHardDeleteCheck.allowed ? (
                      <>
                        <p className="alert alert-info">Hard delete is blocked until these dependencies are cleared:</p>
                        <ul className="projects-users-hard-delete-list">
                          {selectedManagedUserHardDeleteCheck.blockers.map((blocker) => (
                            <li key={blocker.code} className="projects-users-hard-delete-item">
                              {blocker.label} ({blocker.count})
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    <div className="projects-users-delete-actions">
                      <button
                        className="button button-danger"
                        type="button"
                        onClick={() => {
                          void onDeleteManagedUser(selectedManagedUser, "hard");
                        }}
                        disabled={
                          selectedManagedUser.id === currentUserId ||
                          deletingUserId === selectedManagedUser.id ||
                          savingUserId !== null ||
                          hardDeleteCheckLoadingId === selectedManagedUser.id ||
                          !selectedManagedUserHardDeleteCheck?.allowed
                        }
                        title={selectedManagedUser.id === currentUserId ? "Admins cannot delete their own account." : undefined}
                      >
                        {deletingUserId === selectedManagedUser.id ? "Deleting..." : "Hard delete"}
                      </button>
                    </div>
                  </section>

                  <form className="form-grid" onSubmit={onSaveManagedUser}>
                    <label>
                      Account role
                      <select
                        className="input"
                        value={editingUserRole}
                        onChange={(event) => setEditingUserRole(event.target.value as LoginResponse["user"]["globalRole"])}
                        disabled={savingUserId === selectedManagedUser.id}
                      >
                        <option value="reader">Reader</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>

                    {editingUserRole === "admin" ? (
                      <p className="alert alert-info">Admins have access to all projects.</p>
                    ) : (
                      <fieldset className="projects-invite-projects">
                        <legend>Project permissions</legend>
                        <div className="projects-invite-selector-toolbar">
                          <p className="projects-invite-selection-summary">{countProjectRoleMap(editingUserProjectAccess)} assigned</p>
                          <div className="projects-invite-selection-actions">
                            <button
                              className="button button-ghost"
                              type="button"
                              onClick={() => setEditingUserProjectAccess({})}
                              disabled={savingUserId === selectedManagedUser.id || countProjectRoleMap(editingUserProjectAccess) === 0}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        {sortedProjects.length === 0 ? (
                          <p className="alert alert-info">No projects available.</p>
                        ) : (
                          <div className="projects-invite-checkboxes projects-users-project-access-list">
                            {sortedProjects.map((project) => {
                              const assignedRole = editingUserProjectAccess[project.id];
                              const isAssigned = Boolean(assignedRole);

                              return (
                                <label
                                  className={`projects-invite-checkbox${isAssigned ? " projects-invite-checkbox-selected" : ""}`}
                                  key={`managed-user-${selectedManagedUser.id}-${project.id}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isAssigned}
                                    onChange={() => onToggleEditingUserProject(project.id)}
                                    disabled={savingUserId === selectedManagedUser.id}
                                  />
                                  <div className="projects-invite-checkbox-content">
                                    <div className="projects-invite-checkbox-main">
                                      <strong>{project.key}</strong>
                                      <span>{project.name}</span>
                                    </div>
                                    <div className="projects-role-pillars">
                                      {isAssigned ? (
                                        <select
                                          className="input projects-role-select"
                                          value={assignedRole}
                                          onChange={(event) => onSetEditingUserProjectRole(project.id, event.target.value as ProjectScopedRole)}
                                          onClick={(event) => event.stopPropagation()}
                                          disabled={savingUserId === selectedManagedUser.id}
                                        >
                                          <option value="reader">Reader</option>
                                          <option value="editor">Editor</option>
                                        </select>
                                      ) : null}
                                      {project.isPinned ? <span className="badge projects-pinned-badge">Pinned</span> : null}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </fieldset>
                    )}

                    <div className="projects-list-actions">
                      <button className="button" type="submit" disabled={savingUserId === selectedManagedUser.id}>
                        {savingUserId === selectedManagedUser.id ? "Saving..." : "Save changes"}
                      </button>
                      <button className="button button-ghost" type="button" onClick={onResetManagedUserForm} disabled={savingUserId === selectedManagedUser.id}>
                        Reset
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <p className="alert alert-info">Select a user from the left list to edit permissions.</p>
              )}
            </section>
          </div>
        )}
      </section>
      {confirmDialog}
    </AppShell>
  );
}
