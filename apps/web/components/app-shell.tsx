"use client";

import {
  BookOpen,
  CalendarDays,
  Code2,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  PanelLeftClose
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AccountDrawer } from "./account-drawer";
import { AccountSettingsTab } from "./account-settings-surface";
import { AtlasiumMark } from "./atlasium-mark";
import { StoredAtlasiumUser, UserMenu } from "./user-menu";
import { ProjectSummary } from "../lib/api";
import { authFetch } from "../lib/client-api";

const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = "atlasium_shell_sidebar_collapsed";
const OPEN_ACCOUNT_SETTINGS_EVENT = "atlasium:open-account-settings";

function parseStoredUser(rawValue: string | null): StoredAtlasiumUser | null {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredAtlasiumUser;
  } catch {
    return null;
  }
}

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
  const [storedUser, setStoredUser] = useState<StoredAtlasiumUser | null>(null);
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [accountDrawerTab, setAccountDrawerTab] = useState<AccountSettingsTab>("profile");

  useEffect(() => {
    const storedPreference = localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY);
    setSidebarCollapsed(storedPreference === "true");
    setSidebarPreferenceLoaded(true);
    setStoredUser(parseStoredUser(localStorage.getItem("doctoral_user")));
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === "doctoral_user") {
        setStoredUser(parseStoredUser(event.newValue));
      }
    };
    const onOpenAccountSettings = (event: Event): void => {
      const requestedTab = (event as CustomEvent<{ tab?: AccountSettingsTab }>).detail?.tab ?? "profile";
      setAccountDrawerTab(requestedTab);
      setAccountDrawerOpen(true);
    };
    const onUserUpdated = (): void => {
      setStoredUser(parseStoredUser(localStorage.getItem("doctoral_user")));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(OPEN_ACCOUNT_SETTINGS_EVENT, onOpenAccountSettings);
    window.addEventListener("atlasium:user-updated", onUserUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(OPEN_ACCOUNT_SETTINGS_EVENT, onOpenAccountSettings);
      window.removeEventListener("atlasium:user-updated", onUserUpdated);
    };
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
          icon: LayoutDashboard,
          active: pathname === `/projects/${projectId}`
        },
        {
          href: `/projects/${projectId}/wiki`,
          label: "Wiki",
          icon: BookOpen,
          active: pathname === `/projects/${projectId}/wiki` || pathname.startsWith(`/projects/${projectId}/wiki/`)
        },
        {
          href: `/projects/${projectId}/documents`,
          label: "Documents",
          icon: FileText,
          active: pathname === `/projects/${projectId}/documents` || pathname.startsWith(`/projects/${projectId}/documents/`)
        },
        {
          href: `/projects/${projectId}/code`,
          label: "Code",
          icon: Code2,
          active: pathname === `/projects/${projectId}/code` || pathname.startsWith(`/projects/${projectId}/code/`)
        },
        {
          href: `/projects/${projectId}/tasks`,
          label: "Tasks",
          icon: ListChecks,
          active: pathname === `/projects/${projectId}/tasks` || pathname.startsWith(`/projects/${projectId}/tasks/`)
        },
        {
          href: `/projects/${projectId}/meetings`,
          label: "Meetings",
          icon: CalendarDays,
          active: pathname === `/projects/${projectId}/meetings` || pathname.startsWith(`/projects/${projectId}/meetings/`)
        }
      ]
    : [
        { href: "/projects", label: "Projects", icon: FolderKanban, active: pathname === "/projects" }
      ];

  const openAccountDrawer = useCallback((tab: AccountSettingsTab): void => {
    setAccountDrawerTab(tab);
    setAccountDrawerOpen(true);
  }, []);

  const signOut = useCallback((): void => {
    localStorage.removeItem("doctoral_token");
    localStorage.removeItem("doctoral_user");
    setStoredUser(null);
    setAccountDrawerOpen(false);
    router.replace("/login");
  }, [router]);

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
            <AtlasiumMark size="sm" className="brand-mark" />
            <div>
              {projectId ? <p className="brand-kicker">Project archive</p> : <p className="brand-kicker">Atlasium</p>}
              <p className="brand-title">{brandTitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-toggle-button icon-button"
            onClick={() => setSidebarCollapsed(true)}
            aria-label="Hide navigation menu"
            title="Hide navigation menu"
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>
        <nav className="nav-links">
          {navLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                className={item.active ? "nav-link nav-link-active" : "nav-link"}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <UserMenu user={storedUser} onOpenAccount={openAccountDrawer} onSignOut={signOut} />
          {projectId ? (
            <button type="button" className="nav-exit-button" onClick={() => void onExitProject()} disabled={exitBusy}>
              {exitBusy ? "Exiting..." : "Exit project"}
            </button>
          ) : null}
        </div>
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
      <AccountDrawer open={accountDrawerOpen} initialTab={accountDrawerTab} onClose={() => setAccountDrawerOpen(false)} />
    </div>
  );
}

export function openAccountSettings(tab: AccountSettingsTab = "profile"): void {
  window.dispatchEvent(new CustomEvent(OPEN_ACCOUNT_SETTINGS_EVENT, { detail: { tab } }));
}
