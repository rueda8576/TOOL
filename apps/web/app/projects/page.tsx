"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { StatusCard } from "../../components/status-card";
import { authFetch, LoginResponse } from "../../lib/client-api";
import { ProjectSummary } from "../../lib/api";

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

export default function ProjectsPage(): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<LoginResponse["user"]["globalRole"] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

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
      await authFetch<ProjectSummary>("/projects", {
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
      await loadProjects(token);
    } catch (submitError) {
      setCreateError((submitError as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell title="Projects" subtitle="Private-by-assignment workspace for doctoral collaboration.">
      <section className="grid cols-3">
        <StatusCard title="Visible Projects" value={loading ? "..." : `${projects.length}`} helper="Filtered by membership and role." />
        <StatusCard title="Delivery Mode" value="Weekly" helper="Sprint-based iteration cadence." />
        <StatusCard title="Infrastructure" value="Self-hosted" helper="VPS + PostgreSQL + Redis + SMTP." />
      </section>

      <section className="panel">
        <h2 className="section-heading">Create project</h2>
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
                disabled={isReader || creating}
              />
            </label>
            <label>
              Name
              <input
                className="input"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                maxLength={150}
                required
                disabled={isReader || creating}
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              className="input textarea-sm"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              maxLength={5000}
              disabled={isReader || creating}
            />
          </label>
          <button className="button" type="submit" disabled={isReader || creating}>
            {creating ? "Creating..." : "Create project"}
          </button>
        </form>
        {isReader ? <p className="alert alert-info">Reader role can view projects but cannot create them.</p> : null}
        {createSuccess ? <p className="alert alert-success">{createSuccess}</p> : null}
        {createError ? <p className="alert alert-error">{createError}</p> : null}
      </section>

      <section className="panel">
        <h2 className="section-heading">Project directory</h2>

        {loading ? <p className="alert alert-info">Loading projects...</p> : null}
        {listError ? (
          <p className="alert alert-error">
            {listError}. Please <Link href="/login">sign in again</Link>.
          </p>
        ) : null}

        {!loading && !listError ? (
          <ul className="list">
            {projects.map((project) => (
              <li className="list-item" key={project.id}>
                <strong>
                  {project.key} - {project.name}
                </strong>
                <p>{project.description ?? "No description"}</p>
                <Link className="badge" href={`/projects/${project.id}`}>
                  Open project
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </AppShell>
  );
}
