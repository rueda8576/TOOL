"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { AccountSettingsSurface, AccountSettingsTab } from "./account-settings-surface";
import { IconButton } from "./ui";

export function AccountDrawer({
  open,
  initialTab,
  onClose
}: {
  open: boolean;
  initialTab: AccountSettingsTab;
  onClose: () => void;
}): JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    bodyRef.current?.scrollTo({ top: 0 });
  }, [initialTab, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="account-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="account-drawer" role="dialog" aria-modal="true" aria-label="Account settings" onClick={(event) => event.stopPropagation()}>
        <div className="account-drawer-header">
          <div className="stack-xxs">
            <p className="eyebrow">Personal settings</p>
            <h2 className="section-heading">Account</h2>
          </div>
          <IconButton label="Close account settings" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="account-drawer-body" ref={bodyRef}>
          <AccountSettingsSurface initialTab={initialTab} compact onTabChange={() => bodyRef.current?.scrollTo({ top: 0 })} />
        </div>
      </aside>
    </div>
  );
}
