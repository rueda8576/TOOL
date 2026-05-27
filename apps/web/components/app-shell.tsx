"use client";

import {
  BookOpen,
  CalendarDays,
  Code2,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

import { AccountDrawer } from "./account-drawer";
import { AccountSettingsTab } from "./account-settings-surface";
import { AtlasiumMark } from "./atlasium-mark";
import { StoredAtlasiumUser, UserMenu } from "./user-menu";
import { ProjectSummary } from "../lib/api";
import { authFetch } from "../lib/client-api";

const OPEN_ACCOUNT_SETTINGS_EVENT = "atlasium:open-account-settings";

export type ShellNavigateReason = "module" | "exit-project" | "sign-out";

export type ShellNavigateTarget = {
  href: string;
  reason: ShellNavigateReason;
};

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
  projectId,
  fullWidth = false,
  onBeforeShellNavigate,
  children
}: {
  projectId?: string;
  fullWidth?: boolean;
  onBeforeShellNavigate?: (target: ShellNavigateTarget) => boolean | Promise<boolean>;
  children: React.ReactNode;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const [exitBusy, setExitBusy] = useState(false);
  const [brandTitle, setBrandTitle] = useState("Atlasium");
  const [storedUser, setStoredUser] = useState<StoredAtlasiumUser | null>(null);
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [accountDrawerTab, setAccountDrawerTab] = useState<AccountSettingsTab>("profile");

  useEffect(() => {
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

  useEffect(() => {
    const shell = shellRef.current;
    const topbar = topbarRef.current;
    if (!shell || !topbar) {
      return;
    }

    const updateTopbarHeight = (): void => {
      shell.style.setProperty("--shell-topbar-height", `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
    };

    updateTopbarHeight();
    const resizeObserver = new ResizeObserver(updateTopbarHeight);
    resizeObserver.observe(topbar);
    window.addEventListener("resize", updateTopbarHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateTopbarHeight);
    };
  }, []);

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

  const requestShellNavigation = useCallback(
    async (target: ShellNavigateTarget): Promise<boolean> => {
      if (!onBeforeShellNavigate) {
        return true;
      }
      try {
        return await onBeforeShellNavigate(target);
      } catch {
        return false;
      }
    },
    [onBeforeShellNavigate]
  );

  const signOut = useCallback(async (): Promise<void> => {
    const canNavigate = await requestShellNavigation({ href: "/login", reason: "sign-out" });
    if (!canNavigate) {
      return;
    }
    localStorage.removeItem("doctoral_token");
    localStorage.removeItem("doctoral_user");
    setStoredUser(null);
    setAccountDrawerOpen(false);
    router.replace("/login");
  }, [requestShellNavigation, router]);

  const onShellNavClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>, href: string, active: boolean): Promise<void> => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      if (active || href === pathname) {
        return;
      }

      const canNavigate = await requestShellNavigation({ href, reason: "module" });
      if (canNavigate) {
        router.push(href);
      }
    },
    [pathname, requestShellNavigation, router]
  );

  const onExitProject = useCallback(async (): Promise<void> => {
    if (!projectId || exitBusy) {
      return;
    }

    setExitBusy(true);
    try {
      const shouldExit = await requestShellNavigation({ href: "/projects", reason: "exit-project" });
      if (!shouldExit) {
        return;
      }
      router.push("/projects");
    } finally {
      setExitBusy(false);
    }
  }, [exitBusy, projectId, requestShellNavigation, router]);

  return (
    <div className="shell" ref={shellRef}>
      <header className="shell-topbar" ref={topbarRef}>
        <div className="shell-brand">
          <AtlasiumMark size="sm" className="brand-mark" />
          <div>
            {projectId ? <p className="brand-kicker">Project archive</p> : <p className="brand-kicker">Atlasium</p>}
            <p className="brand-title">{brandTitle}</p>
          </div>
        </div>
        <nav className="shell-nav" aria-label={projectId ? "Project navigation" : "Workspace navigation"}>
          {navLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                className={item.active ? "shell-nav-link shell-nav-link-active" : "shell-nav-link"}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                onClick={(event) => {
                  void onShellNavClick(event, item.href, item.active);
                }}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="shell-actions">
          {projectId ? (
            <button type="button" className="shell-exit-button" onClick={() => void onExitProject()} disabled={exitBusy}>
              {exitBusy ? "Exiting..." : "Exit project"}
            </button>
          ) : null}
          <UserMenu user={storedUser} onOpenAccount={openAccountDrawer} onSignOut={() => void signOut()} />
        </div>
      </header>
      <main className="shell-content content">
        <div className={fullWidth ? "content-inner content-inner-fluid" : "content-inner"}>
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
