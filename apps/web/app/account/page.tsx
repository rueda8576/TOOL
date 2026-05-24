"use client";

import { AppShell } from "../../components/app-shell";
import { AccountSettingsSurface } from "../../components/account-settings-surface";

export default function AccountPage(): JSX.Element {
  return (
    <AppShell title="Account" subtitle="Manage your Atlasium identity, security, notifications, and GitLab developer access.">
      <AccountSettingsSurface />
    </AppShell>
  );
}
