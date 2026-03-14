"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { authFetch, LoginResponse } from "../../lib/client-api";
import { ProjectSummary } from "../../lib/api";

type ProjectOrderBy = "newest" | "key" | "name";
type InviteAccessMode = "all" | "selected";

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

export default function ProjectsPage(): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [orderBy, setOrderBy] = useState<ProjectOrderBy>("newest");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [pinBusyProjectId, setPinBusyProjectId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<LoginResponse["user"]["globalRole"]>("reader");
  const [inviteAccessMode, setInviteAccessMode] = useState<InviteAccessMode>("all");
  const [inviteProjectIds, setInviteProjectIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

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

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    setUserRole(parseStoredUser(localStorage.getItem("doctoral_user"))?.globalRole ?? null);
    void loadProjects(storedToken);
  }, [loadProjects, router]);

  const isReader = userRole === "reader";
  const isAdmin = userRole === "admin";

  useEffect(() => {
    setInviteProjectIds((current) => {
      const availableProjectIds = new Set(projects.map((project) => project.id));
      return current.filter((projectId) => availableProjectIds.has(projectId));
    });
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

  const onCreateProject = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!token) {
      setCreateError("Missing session token. Please sign in again.");
      return;
    }

    if (isReader) {
      setCreateError("Reader role cannot create projects.");
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
    setInviteProjectIds((current) => {
      if (current.includes(projectId)) {
        return current.filter((id) => id !== projectId);
      }
      return [...current, projectId];
    });
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

    if (inviteAccessMode === "selected" && inviteProjectIds.length === 0) {
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
          body: JSON.stringify({
            email,
            globalRole: inviteRole,
            accessMode: inviteAccessMode,
            projectIds: inviteAccessMode === "selected" ? inviteProjectIds : undefined
          })
        }
      });

      setInviteEmail("");
      setInviteRole("reader");
      setInviteAccessMode("all");
      setInviteProjectIds([]);
      setInviteSuccess(`Invitation sent to ${email}.`);
    } catch (error) {
      setInviteError((error as Error).message);
    } finally {
      setInviting(false);
    }
  };

  return (
    <AppShell title="Projects" subtitle="Browse, pin, and open your research workspaces.">
      <section className="panel projects-directory-panel">
        <div className="projects-toolbar-row">
          <div>
            <h2 className="section-heading">Project directory</h2>
            <p className="projects-toolbar-helper">Pinned projects always stay at the top.</p>
          </div>
          <div className="projects-toolbar-actions">
            <label className="projects-order-control">
              Order by
              <select className="input" value={orderBy} onChange={(event) => setOrderBy(event.target.value as ProjectOrderBy)}>
                <option value="newest">Newest</option>
                <option value="key">Key</option>
                <option value="name">Name</option>
              </select>
            </label>
            {isAdmin ? (
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
            <button
              className="button"
              type="button"
              onClick={() => {
                setCreateSuccess(null);
                setCreateError(null);
                setIsCreateOpen((current) => !current);
              }}
              disabled={isReader}
            >
              {isCreateOpen ? "Close" : "New project"}
            </button>
          </div>
        </div>

        {isReader ? <p className="alert alert-info">Reader role can view and pin projects but cannot create new ones.</p> : null}
        {createSuccess ? <p className="alert alert-success">{createSuccess}</p> : null}
        {createError ? <p className="alert alert-error">{createError}</p> : null}
        {pinError ? <p className="alert alert-error">{pinError}</p> : null}
        {inviteSuccess ? <p className="alert alert-success">{inviteSuccess}</p> : null}
        {inviteError ? <p className="alert alert-error">{inviteError}</p> : null}
        {listError ? (
          <p className="alert alert-error">
            {listError}. Please <Link href="/login">sign in again</Link>.
          </p>
        ) : null}

        {isCreateOpen && !isReader ? (
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
                  Global role
                  <select
                    className="input"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as LoginResponse["user"]["globalRole"])}
                    disabled={inviting}
                  >
                    <option value="reader">Reader</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </div>

              <label>
                Access mode
                <select
                  className="input"
                  value={inviteAccessMode}
                  onChange={(event) => setInviteAccessMode(event.target.value as InviteAccessMode)}
                  disabled={inviting}
                >
                  <option value="all">All current projects</option>
                  <option value="selected">Selected projects</option>
                </select>
              </label>

              {inviteAccessMode === "selected" ? (
                <fieldset className="projects-invite-projects">
                  <legend>Select projects</legend>
                  {sortedProjects.length === 0 ? (
                    <p className="alert alert-info">No projects available.</p>
                  ) : (
                    <div className="projects-invite-checkboxes">
                      {sortedProjects.map((project) => (
                        <label className="projects-invite-checkbox" key={`invite-${project.id}`}>
                          <input
                            type="checkbox"
                            checked={inviteProjectIds.includes(project.id)}
                            onChange={() => onToggleInviteProject(project.id)}
                            disabled={inviting}
                          />
                          <span>
                            {project.key} - {project.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              ) : (
                <p className="projects-toolbar-helper">
                  The invited user will receive access to every current project when they accept the invite.
                </p>
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
      </section>
    </AppShell>
  );
}
