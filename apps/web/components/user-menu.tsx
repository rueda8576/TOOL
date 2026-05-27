"use client";

import { Bell, Code2, LogOut, Shield, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AccountSettingsTab } from "./account-settings-surface";

export type StoredAtlasiumUser = {
  id: string;
  email: string;
  username?: string;
  name?: string;
  globalRole?: string;
};

function initialsForUser(user: StoredAtlasiumUser | null): string {
  const source = user?.name || user?.username || user?.email || "A";
  return source
    .split(/[.\s@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "A";
}

export function UserMenu({
  user,
  onOpenAccount,
  onSignOut
}: {
  user: StoredAtlasiumUser | null;
  onOpenAccount: (tab: AccountSettingsTab) => void;
  onSignOut: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const label = user?.username ? `@${user.username}` : user?.name || user?.email || "Account";

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const openAccount = (tab: AccountSettingsTab): void => {
    setOpen(false);
    onOpenAccount(tab);
  };

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-menu-avatar" aria-hidden="true">
          {initialsForUser(user)}
        </span>
        <span className="user-menu-copy">
          <span className="user-menu-kicker">Personal</span>
          <span className="user-menu-label">{label}</span>
        </span>
      </button>
      {open ? (
        <div className="user-menu-popover" role="menu" aria-label="User menu">
          <button type="button" role="menuitem" onClick={() => openAccount("profile")}>
            <UserRound size={16} aria-hidden="true" />
            Account settings
          </button>
          <button type="button" role="menuitem" onClick={() => openAccount("git")}>
            <Code2 size={16} aria-hidden="true" />
            Git access
          </button>
          <button type="button" role="menuitem" onClick={() => openAccount("notifications")}>
            <Bell size={16} aria-hidden="true" />
            Notifications
          </button>
          <button type="button" role="menuitem" onClick={() => openAccount("security")}>
            <Shield size={16} aria-hidden="true" />
            Security
          </button>
          <button
            type="button"
            role="menuitem"
            className="user-menu-danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
