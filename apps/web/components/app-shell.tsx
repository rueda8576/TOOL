"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppShell({
  title,
  subtitle,
  projectId,
  hideHeader = false,
  fullWidth = false,
  children
}: {
  title: string;
  subtitle?: React.ReactNode;
  projectId?: string;
  hideHeader?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const pathname = usePathname();
  const isProjectsPath = pathname === "/projects" || /^\/projects\/[^/]+$/.test(pathname);
  const navLinks = [
    { href: "/projects", label: "Projects", active: isProjectsPath },
    ...(projectId
      ? [
          {
            href: `/projects/${projectId}/wiki`,
            label: "Wiki",
            active: pathname === `/projects/${projectId}/wiki` || pathname.startsWith(`/projects/${projectId}/wiki/`)
          },
          {
            href: `/projects/${projectId}/documents`,
            label: "Documents",
            active:
              pathname === `/projects/${projectId}/documents` || pathname.startsWith(`/projects/${projectId}/documents/`)
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
          }
        ]
      : [])
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" />
          <div>
            <p className="brand-title">Doctoral OS</p>
            <p className="brand-subtitle">Collaboration Workspace</p>
          </div>
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
      </aside>
      <main className="content">
        <div className={fullWidth ? "content-inner content-inner-fluid" : "content-inner"}>
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
