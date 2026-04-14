"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ProjectSummary } from "../lib/api";
import { authFetch } from "../lib/client-api";

const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = "atlasium_shell_sidebar_collapsed";

export function AppShell({
  title,
  subtitle,
  projectId,
  hideHeader = false,
  fullWidth = false,
  onExitProjectRequest,
  children
}: {
  title: string;
  subtitle?: React.ReactNode;
  projectId?: string;
  hideHeader?: boolean;
  fullWidth?: boolean;
  onExitProjectRequest?: () => boolean | Promise<boolean>;
  children: React.ReactNode;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [exitBusy, setExitBusy] = useState(false);
  const [brandTitle, setBrandTitle] = useState("Atlasium");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);

  useEffect(() => {
    const storedPreference = localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY);
    setSidebarCollapsed(storedPreference === "true");
    setSidebarPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!sidebarPreferenceLoaded) {
      return;
    }

    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? "true" : "false");
  }, [sidebarCollapsed, sidebarPreferenceLoaded]);

  useEffect(() => {
    let active = true;

    if (!projectId) {
      setBrandTitle("Atlasium");
      return () => {
        active = false;
      };
    }

    setBrandTitle("Atlasium");
    const token = localStorage.getItem("doctoral_token");
    if (!token) {
      return () => {
        active = false;
      };
    }

    void authFetch<ProjectSummary[]>("/projects", { token })
      .then((projects) => {
        if (!active) {
          return;
        }
        const current = projects.find((project) => project.id === projectId);
        setBrandTitle(current?.key ?? "Atlasium");
      })
      .catch(() => {
        if (active) {
          setBrandTitle("Atlasium");
        }
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  const navLinks = projectId
    ? [
        {
          href: `/projects/${projectId}`,
          label: "Overview",
          active: pathname === `/projects/${projectId}`
        },
        {
          href: `/projects/${projectId}/wiki`,
          label: "Wiki",
          active: pathname === `/projects/${projectId}/wiki` || pathname.startsWith(`/projects/${projectId}/wiki/`)
        },
        {
          href: `/projects/${projectId}/documents`,
          label: "Documents",
          active: pathname === `/projects/${projectId}/documents` || pathname.startsWith(`/projects/${projectId}/documents/`)
        },
        {
          href: `/projects/${projectId}/code`,
          label: "Code",
          active: pathname === `/projects/${projectId}/code` || pathname.startsWith(`/projects/${projectId}/code/`)
        },
        {
          href: `/projects/${projectId}/tasks`,
          label: "Tasks",
          active: pathname === `/projects/${projectId}/tasks` || pathname.startsWith(`/projects/${projectId}/tasks/`)
        },
        {
          href: `/projects/${projectId}/meetings`,
          label: "Meetings",
          active: pathname === `/projects/${projectId}/meetings` || pathname.startsWith(`/projects/${projectId}/meetings/`)
        },
        {
          href: "/account",
          label: "Account",
          active: pathname === "/account"
        }
      ]
    : [
        { href: "/projects", label: "Projects", active: pathname === "/projects" },
        { href: "/account", label: "Account", active: pathname === "/account" }
      ];

  const onExitProject = useCallback(async (): Promise<void> => {
    if (!projectId || exitBusy) {
      return;
    }

    setExitBusy(true);
    try {
      let shouldExit = true;
      if (onExitProjectRequest) {
        try {
          shouldExit = await onExitProjectRequest();
        } catch {
          shouldExit = false;
        }
      }
      if (!shouldExit) {
        return;
      }
      router.push("/projects");
    } finally {
      setExitBusy(false);
    }
  }, [exitBusy, onExitProjectRequest, projectId, router]);

  return (
    <div className={sidebarCollapsed ? "shell shell-sidebar-collapsed" : "shell"}>
      <aside className="sidebar">
        <div className="sidebar-topbar">
          <div className="brand">
            <span className="brand-dot" />
            <div>
              <p className="brand-title">{brandTitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-toggle-button"
            onClick={() => setSidebarCollapsed(true)}
            aria-label="Hide navigation menu"
          >
            Hide menu
          </button>
        </div>
        <nav className="nav-links">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              className={item.active ? "nav-link nav-link-active" : "nav-link"}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {projectId ? (
          <div className="sidebar-footer">
            <button type="button" className="nav-exit-button" onClick={() => void onExitProject()} disabled={exitBusy}>
              {exitBusy ? "Exiting..." : "Exit project"}
            </button>
          </div>
        ) : null}
      </aside>
      <main className="content">
        <div className={fullWidth ? "content-inner content-inner-fluid" : "content-inner"}>
          {sidebarCollapsed ? (
            <div className="shell-sidebar-reopen-row">
              <button
                type="button"
                className="button button-secondary shell-sidebar-reopen-button"
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Show navigation menu"
              >
                Show menu
              </button>
            </div>
          ) : null}
          {!hideHeader ? (
            <header className="content-header">
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </header>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
