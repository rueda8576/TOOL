"use client";

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
        <AccountSettingsSurface initialTab={initialTab} compact />
      </aside>
    </div>
  );
}
