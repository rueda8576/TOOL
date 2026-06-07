"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AccountProfile,
  changeAccountPassword,
  getCurrentAccountProfile,
  getNotificationPreferences,
  NotificationPreferences,
  syncGitlabHttpsPassword,
  updateAccountUsername,
  updateAccountNotificationPreferences
} from "../lib/account";
import {
  beginGitlabConnection,
  createGitlabSshKey,
  deleteGitlabSshKey,
  disconnectGitlabConnection,
  getGitlabConnectionStatus,
  GitlabConnectionStatus,
  GitlabSshKey,
  listGitlabSshKeys
} from "../lib/gitlab";
import { ConfirmDialog, LoadingState, MetadataStrip, Modal, WorkspaceHeader } from "./ui";

export type AccountSettingsTab = "profile" | "security" | "notifications" | "git";

const ACCOUNT_TABS: Array<{ id: AccountSettingsTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "git", label: "Git access" }
];

function isSessionFailureMessage(message: string): boolean {
  return ["Session expired", "Invalid token", "Missing bearer token"].some((part) => message.includes(part));
}

function formatRoleLabel(role: "admin" | "editor" | "reader"): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDateTimeLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function persistStoredUser(profile: AccountProfile): void {
  localStorage.setItem(
    "doctoral_user",
    JSON.stringify({
      id: profile.id,
      email: profile.email,
      username: profile.username,
      name: profile.name,
      globalRole: profile.globalRole
    })
  );
  window.dispatchEvent(new Event("atlasium:user-updated"));
}

function areNotificationPreferencesEqual(
  left: NotificationPreferences | null,
  right: NotificationPreferences | null
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.emailEnabled === right.emailEnabled &&
    left.taskAssigned === right.taskAssigned &&
    left.taskDue === right.taskDue &&
    left.mentionInWiki === right.mentionInWiki &&
    left.mentionInTaskComments === right.mentionInTaskComments &&
    left.taskDueLeadHours === right.taskDueLeadHours
  );
}

export function AccountSettingsSurface({
  initialTab = "profile",
  compact = false,
  onTabChange
}: {
  initialTab?: AccountSettingsTab;
  compact?: boolean;
  onTabChange?: (tab: AccountSettingsTab) => void;
}): JSX.Element {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AccountSettingsTab>(initialTab);
  const [token, setToken] = useState<string | null>(null);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameSubmitting, setUsernameSubmitting] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [securitySubmitting, setSecuritySubmitting] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);

  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences | null>(null);
  const [initialNotificationPreferences, setInitialNotificationPreferences] = useState<NotificationPreferences | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationsSuccess, setNotificationsSuccess] = useState<string | null>(null);

  const [connection, setConnection] = useState<GitlabConnectionStatus | null>(null);
  const [gitlabLoading, setGitlabLoading] = useState(true);
  const [gitlabConnecting, setGitlabConnecting] = useState(false);
  const [gitlabDisconnecting, setGitlabDisconnecting] = useState(false);
  const [gitlabError, setGitlabError] = useState<string | null>(null);
  const [gitlabSuccess, setGitlabSuccess] = useState<string | null>(null);

  const [sshKeys, setSshKeys] = useState<GitlabSshKey[]>([]);
  const [sshKeysLoading, setSshKeysLoading] = useState(false);
  const [creatingSshKey, setCreatingSshKey] = useState(false);
  const [deletingKeyId, setDeletingKeyId] = useState<number | null>(null);
  const [sshKeyTitle, setSshKeyTitle] = useState("");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [sshKeyExpiresAt, setSshKeyExpiresAt] = useState("");
  const [sshError, setSshError] = useState<string | null>(null);
  const [sshSuccess, setSshSuccess] = useState<string | null>(null);
  const [expandedSshKeyIds, setExpandedSshKeyIds] = useState<number[]>([]);
  const [isSshFormOpen, setIsSshFormOpen] = useState(false);
  const [gitConnectionDetailsOpen, setGitConnectionDetailsOpen] = useState(false);
  const [sshSectionOpen, setSshSectionOpen] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [httpsClonePassword, setHttpsClonePassword] = useState("");
  const [httpsCloneSubmitting, setHttpsCloneSubmitting] = useState(false);
  const [httpsCloneUsername, setHttpsCloneUsername] = useState<string | null>(null);
  const [httpsCloneError, setHttpsCloneError] = useState<string | null>(null);
  const [httpsCloneSuccess, setHttpsCloneSuccess] = useState<string | null>(null);

  const handleAuthFailure = useCallback(
    (message: string): boolean => {
      if (!isSessionFailureMessage(message)) {
        return false;
      }

      localStorage.removeItem("doctoral_token");
      localStorage.removeItem("doctoral_user");
      router.replace("/login");
      return true;
    },
    [router]
  );

  const loadProfile = useCallback(
    async (authToken: string): Promise<void> => {
      setProfileLoading(true);
      try {
        const nextProfile = await getCurrentAccountProfile(authToken);
        setProfile(nextProfile);
        setUsernameDraft(nextProfile.username);
        persistStoredUser(nextProfile);
        setProfileError(null);
      } catch (loadError) {
        const message = (loadError as Error).message || "Unable to load your Atlasium profile.";
        if (!handleAuthFailure(message)) {
          setProfileError(message);
        }
      } finally {
        setProfileLoading(false);
      }
    },
    [handleAuthFailure]
  );

  const loadNotificationPreferences = useCallback(
    async (authToken: string): Promise<void> => {
      setNotificationsLoading(true);
      try {
        const preferences = await getNotificationPreferences(authToken);
        setNotificationPreferences(preferences);
        setInitialNotificationPreferences(preferences);
        setNotificationsError(null);
      } catch (loadError) {
        const message = (loadError as Error).message || "Unable to load notification preferences.";
        if (!handleAuthFailure(message)) {
          setNotificationsError(message);
        }
      } finally {
        setNotificationsLoading(false);
      }
    },
    [handleAuthFailure]
  );

  const loadConnection = useCallback(
    async (authToken: string): Promise<void> => {
      setGitlabLoading(true);
      try {
        const nextConnection = await getGitlabConnectionStatus(authToken);
        setConnection(nextConnection);
        setGitlabError(null);
      } catch (loadError) {
        const message = (loadError as Error).message || "Unable to load GitLab account settings.";
        if (!handleAuthFailure(message)) {
          setGitlabError(message);
        }
      } finally {
        setGitlabLoading(false);
      }
    },
    [handleAuthFailure]
  );

  const loadSshKeys = useCallback(
    async (authToken: string): Promise<void> => {
      setSshKeysLoading(true);
      try {
        const nextKeys = await listGitlabSshKeys(authToken);
        setSshKeys(nextKeys);
        setSshError(null);
      } catch (loadError) {
        const message = (loadError as Error).message || "Unable to load GitLab SSH keys.";
        if (!handleAuthFailure(message)) {
          setSshError(message);
        }
      } finally {
        setSshKeysLoading(false);
      }
    },
    [handleAuthFailure]
  );

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    void loadProfile(storedToken);
    void loadNotificationPreferences(storedToken);
    void loadConnection(storedToken);
  }, [loadConnection, loadNotificationPreferences, loadProfile, router]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const gitlabQueryState = searchParams.get("gitlab");
    const gitlabQueryMessage = searchParams.get("message");

    if (!gitlabQueryState) {
      return;
    }

    if (gitlabQueryState === "connected") {
      setGitlabSuccess("GitLab account connected.");
      setGitlabError(null);
    } else if (gitlabQueryState === "error") {
      setGitlabError(gitlabQueryMessage || "GitLab connection failed.");
      setGitlabSuccess(null);
    }

    window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  const canManageSshKeys = Boolean(connection?.connected && !connection.reconnectRequired);

  useEffect(() => {
    if (!token || !canManageSshKeys) {
      setSshKeys([]);
      setExpandedSshKeyIds([]);
      setIsSshFormOpen(false);
      setSshKeysLoading(false);
      return;
    }

    void loadSshKeys(token);
  }, [canManageSshKeys, loadSshKeys, token]);

  const reconnectMessage = useMemo(() => {
    if (!connection?.connected || !connection.reconnectRequired) {
      return null;
    }

    return "Your GitLab session expired or was revoked. Reconnect your account to use Code and SSH-key management again.";
  }, [connection]);

  const toggleSshKeyDetails = useCallback((keyId: number): void => {
    setExpandedSshKeyIds((current) => (current.includes(keyId) ? current.filter((id) => id !== keyId) : [...current, keyId]));
  }, []);

  const passwordValidationMessage = useMemo(() => {
    if (!currentPassword && !newPassword && !confirmPassword) {
      return null;
    }

    if (newPassword.length < 8) {
      return "New password must be at least 8 characters.";
    }

    if (confirmPassword !== newPassword) {
      return "Confirmation must match the new password.";
    }

    if (currentPassword.length >= 8 && newPassword === currentPassword) {
      return "New password must be different from the current password.";
    }

    return null;
  }, [confirmPassword, currentPassword, newPassword]);

  const canSubmitPasswordChange =
    currentPassword.length >= 8 &&
    newPassword.length >= 8 &&
    confirmPassword.length >= 8 &&
    passwordValidationMessage === null;

  const notificationsDirty = useMemo(
    () => !areNotificationPreferencesEqual(notificationPreferences, initialNotificationPreferences),
    [initialNotificationPreferences, notificationPreferences]
  );

  const notificationValidationMessage = useMemo(() => {
    if (!notificationPreferences) {
      return null;
    }

    if (
      !Number.isInteger(notificationPreferences.taskDueLeadHours) ||
      notificationPreferences.taskDueLeadHours < 1 ||
      notificationPreferences.taskDueLeadHours > 24 * 14
    ) {
      return "Task due reminder lead time must be between 1 and 336 hours.";
    }

    return null;
  }, [notificationPreferences]);

  const onChangePassword = async (): Promise<void> => {
    if (!token) {
      router.replace("/login");
      return;
    }

    setSecuritySubmitting(true);
    setSecurityError(null);
    setSecuritySuccess(null);

    try {
      await changeAccountPassword(token, {
        currentPassword,
        newPassword,
        confirmPassword
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSecuritySuccess("Password changed successfully. Your other active sessions were signed out.");
    } catch (changeError) {
      const message = (changeError as Error).message || "Unable to change password.";
      if (!handleAuthFailure(message)) {
        setSecurityError(message);
      }
    } finally {
      setSecuritySubmitting(false);
    }
  };

  const onSaveUsername = async (): Promise<void> => {
    if (!token) {
      router.replace("/login");
      return;
    }

    const nextUsername = usernameDraft.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/.test(nextUsername)) {
      setUsernameError("Username must be 2-32 lowercase letters, numbers, dots, underscores, or hyphens, and start and end with a letter or number.");
      setUsernameSuccess(null);
      return;
    }

    setUsernameSubmitting(true);
    setUsernameError(null);
    setUsernameSuccess(null);
    try {
      const updated = await updateAccountUsername(token, {
        username: nextUsername
      });
      setProfile(updated);
      setUsernameDraft(updated.username);
      setHttpsCloneUsername(updated.username);
      persistStoredUser(updated);
      setUsernameSuccess("Atlasium username updated.");
      if (connection?.connected) {
        await loadConnection(token);
      }
    } catch (saveError) {
      const message = (saveError as Error).message || "Unable to update username.";
      if (!handleAuthFailure(message)) {
        setUsernameError(message);
      }
    } finally {
      setUsernameSubmitting(false);
    }
  };

  const onSaveNotifications = async (): Promise<void> => {
    if (!token || !notificationPreferences) {
      return;
    }

    setNotificationsSaving(true);
    setNotificationsError(null);
    setNotificationsSuccess(null);

    try {
      const updated = await updateAccountNotificationPreferences(token, notificationPreferences);
      setNotificationPreferences(updated);
      setInitialNotificationPreferences(updated);
      setNotificationsSuccess("Notification preferences updated.");
    } catch (saveError) {
      const message = (saveError as Error).message || "Unable to update notification preferences.";
      if (!handleAuthFailure(message)) {
        setNotificationsError(message);
      }
    } finally {
      setNotificationsSaving(false);
    }
  };

  const onConnect = async (): Promise<void> => {
    if (!token) {
      router.replace("/login");
      return;
    }

    setGitlabConnecting(true);
    setGitlabError(null);
    setGitlabSuccess(null);
    try {
      const response = await beginGitlabConnection(token);
      window.location.assign(response.authorizationUrl);
    } catch (connectError) {
      const message = (connectError as Error).message || "Unable to start GitLab connection.";
      if (!handleAuthFailure(message)) {
        setGitlabError(message);
      }
      setGitlabConnecting(false);
    }
  };

  const onDisconnect = async (): Promise<void> => {
    if (!token) {
      router.replace("/login");
      return;
    }

    setGitlabDisconnecting(true);
    setGitlabError(null);
    setGitlabSuccess(null);
    try {
      await disconnectGitlabConnection(token);
      setSshKeys([]);
      await loadConnection(token);
      setGitlabSuccess("GitLab account disconnected.");
      setSshSuccess(null);
      setDisconnectConfirmOpen(false);
      setSshSectionOpen(false);
      setGitConnectionDetailsOpen(false);
    } catch (disconnectError) {
      const message = (disconnectError as Error).message || "Unable to disconnect GitLab.";
      if (!handleAuthFailure(message)) {
        setGitlabError(message);
      }
    } finally {
      setGitlabDisconnecting(false);
    }
  };

  const onCreateSshKey = async (): Promise<void> => {
    if (!token) {
      router.replace("/login");
      return;
    }

    setCreatingSshKey(true);
    setSshError(null);
    setSshSuccess(null);
    try {
      await createGitlabSshKey(token, {
        title: sshKeyTitle.trim(),
        key: sshPublicKey.trim(),
        ...(sshKeyExpiresAt.trim() ? { expiresAt: sshKeyExpiresAt.trim() } : {})
      });
      setSshKeyTitle("");
      setSshPublicKey("");
      setSshKeyExpiresAt("");
      await loadSshKeys(token);
      setIsSshFormOpen(false);
      setSshSuccess("GitLab SSH key added.");
    } catch (createError) {
      const message = (createError as Error).message || "Unable to add the GitLab SSH key.";
      if (!handleAuthFailure(message)) {
        setSshError(message);
      }
    } finally {
      setCreatingSshKey(false);
    }
  };

  const onSyncGitlabHttpsPassword = async (): Promise<void> => {
    if (!token) {
      router.replace("/login");
      return;
    }

    setHttpsCloneSubmitting(true);
    setHttpsCloneError(null);
    setHttpsCloneSuccess(null);
    try {
      const result = await syncGitlabHttpsPassword(token, {
        currentPassword: httpsClonePassword
      });
      setHttpsClonePassword("");
      setHttpsCloneUsername(result.username);
      await loadConnection(token);
      setHttpsCloneSuccess("HTTPS clone password synced.");
    } catch (syncError) {
      const message = (syncError as Error).message || "Unable to enable HTTPS clone password.";
      if (!handleAuthFailure(message)) {
        setHttpsCloneError(message);
      }
    } finally {
      setHttpsCloneSubmitting(false);
    }
  };

  const onDeleteSshKey = async (keyId: number): Promise<void> => {
    if (!token) {
      router.replace("/login");
      return;
    }

    setDeletingKeyId(keyId);
    setSshError(null);
    setSshSuccess(null);
    try {
      await deleteGitlabSshKey(token, keyId);
      setExpandedSshKeyIds((current) => current.filter((id) => id !== keyId));
      await loadSshKeys(token);
      setSshSuccess("GitLab SSH key removed.");
    } catch (deleteError) {
      const message = (deleteError as Error).message || "Unable to remove the GitLab SSH key.";
      if (!handleAuthFailure(message)) {
        setSshError(message);
      }
    } finally {
      setDeletingKeyId(null);
    }
  };

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const gitlabApiStatusLabel = gitlabLoading
    ? "Checking GitLab API"
    : connection?.connected
      ? connection.reconnectRequired
        ? "GitLab reconnect required"
        : "GitLab API connected"
      : "GitLab API disconnected";
  const resolvedHttpsCloneUsername =
    connection?.httpsClone?.username || httpsCloneUsername || connection?.username || profile?.username || "your GitLab username";
  const httpsCloneSyncedAt = connection?.httpsClone?.syncedAt ?? null;
  const httpsCloneStatusLabel = connection?.httpsClone?.enabled ? "HTTPS synced" : "HTTPS setup needed";
  const sshKeyCountLabel = `${sshKeys.length} SSH key${sshKeys.length === 1 ? "" : "s"}`;

  return (
      <section className={compact ? "account-settings-surface account-settings-surface-compact" : "account-settings-surface"}>
        <nav className="account-settings-tabs" aria-label="Account settings sections">
          {ACCOUNT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "account-settings-tab account-settings-tab-active" : "account-settings-tab"}
              onClick={() => {
                setActiveTab(tab.id);
                onTabChange?.(tab.id);
              }}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      <section className="account-settings-layout">
        <div className="account-column">
          {activeTab === "profile" ? (
          <section className="panel stack-md account-section-card">
            <WorkspaceHeader
              eyebrow="Profile"
              title="Atlasium identity"
              summary="Server-backed summary of your account record and managed GitLab identity."
              titleLevel="h2"
              metadata={profile ? <MetadataStrip items={[formatRoleLabel(profile.globalRole), profile.username]} /> : null}
            />

            {profileLoading ? <LoadingState title="Loading account profile" detail="Preparing your Atlasium identity record." /> : null}
            {profileError ? <p className="alert alert-error">{profileError}</p> : null}

            {!profileLoading && profile ? (
              <div className="account-profile-grid">
                <article className="account-profile-item">
                  <p className="account-profile-label">Name</p>
                  <p className="account-profile-value">{profile.name}</p>
                </article>
                <article className="account-profile-item">
                  <p className="account-profile-label">Email</p>
                  <p className="account-profile-value">{profile.email}</p>
                </article>
                <article className="account-profile-item">
                  <p className="account-profile-label">Username</p>
                  <p className="account-profile-value">@{profile.username}</p>
                </article>
                <article className="account-profile-item">
                  <p className="account-profile-label">Role</p>
                  <p className="account-profile-value">{formatRoleLabel(profile.globalRole)}</p>
                </article>
                <article className="account-profile-item">
                  <p className="account-profile-label">Timezone</p>
                  <p className="account-profile-value">{profile.timezone}</p>
                </article>
              </div>
            ) : null}

            {!profileLoading && profile ? (
              <form
                className="stack-sm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveUsername();
                }}
              >
                <label>
                  Atlasium username
                  <input
                    className="input"
                    value={usernameDraft}
                    onChange={(event) => setUsernameDraft(event.target.value.toLowerCase())}
                    minLength={2}
                    maxLength={32}
                    autoComplete="username"
                    spellCheck={false}
                  />
                </label>
                <p className="text-muted">Identifies your Atlasium account and automatically syncs to your managed GitLab identity.</p>
                {usernameError ? <p className="alert alert-error">{usernameError}</p> : null}
                {usernameSuccess ? <p className="alert alert-success">{usernameSuccess}</p> : null}
                <div className="button-row">
                  <button className="button" type="submit" disabled={usernameSubmitting || usernameDraft.trim() === profile.username}>
                    {usernameSubmitting ? "Saving..." : "Save Atlasium username"}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
          ) : null}

          {activeTab === "security" ? (
          <section className="panel stack-md account-section-card">
            <WorkspaceHeader
              eyebrow="Security"
              title="Change password"
              summary="Enter your current password before setting a new one. A successful change signs out your other active sessions."
              titleLevel="h2"
              metadata={<MetadataStrip items={["Password"]} />}
            />

            {securityError ? <p className="alert alert-error">{securityError}</p> : null}
            {securitySuccess ? <p className="alert alert-success">{securitySuccess}</p> : null}

            <form
              className="stack-md"
              onSubmit={(event) => {
                event.preventDefault();
                void onChangePassword();
              }}
            >
              <div className="form-grid">
                <label>
                  Current password
                  <div className="account-password-input">
                    <input
                      className="input"
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => setShowCurrentPassword((current) => !current)}
                    >
                      {showCurrentPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <label>
                  New password
                  <div className="account-password-input">
                    <input
                      className="input"
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => setShowNewPassword((current) => !current)}
                    >
                      {showNewPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                <label>
                  Confirm new password
                  <div className="account-password-input">
                    <input
                      className="input"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                    >
                      {showConfirmPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
              </div>

              {passwordValidationMessage ? (
                <p className="alert alert-error">{passwordValidationMessage}</p>
              ) : (
                <p className="text-muted">Use at least 8 characters.</p>
              )}

              <div className="button-row">
                <button className="button" type="submit" disabled={securitySubmitting || !canSubmitPasswordChange}>
                  {securitySubmitting ? "Changing..." : "Change password"}
                </button>
              </div>
            </form>
          </section>
          ) : null}

          {activeTab === "notifications" ? (
          <section className="panel stack-md account-section-card">
            <WorkspaceHeader
              eyebrow="Notifications"
              title="Delivery preferences"
              summary="Control which Atlasium events can notify you by email and how early task reminders are sent."
              titleLevel="h2"
              metadata={<MetadataStrip items={[notificationPreferences?.emailEnabled ? "Email on" : "Email off"]} />}
            />

            {notificationsLoading ? <LoadingState title="Loading notification preferences" detail="Preparing delivery settings." /> : null}
            {notificationsError ? <p className="alert alert-error">{notificationsError}</p> : null}
            {notificationsSuccess ? <p className="alert alert-success">{notificationsSuccess}</p> : null}

            {!notificationsLoading && notificationPreferences ? (
              <>
                <div className="account-preference-list">
                  <label className="account-preference-item">
                    <div className="account-toggle-row">
                      <input
                        type="checkbox"
                        checked={notificationPreferences.emailEnabled}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  emailEnabled: event.target.checked
                                }
                              : current
                          )
                        }
                      />
                      <div className="account-toggle-copy">
                        <p className="account-preference-title">Email notifications</p>
                        <p className="account-preference-description">Master switch for email delivery across Atlasium events.</p>
                      </div>
                    </div>
                  </label>

                  <label className="account-preference-item">
                    <div className="account-toggle-row">
                      <input
                        type="checkbox"
                        checked={notificationPreferences.taskAssigned}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  taskAssigned: event.target.checked
                                }
                              : current
                          )
                        }
                      />
                      <div className="account-toggle-copy">
                        <p className="account-preference-title">Task assigned</p>
                        <p className="account-preference-description">Notify me when a task is assigned to me.</p>
                      </div>
                    </div>
                  </label>

                  <label className="account-preference-item">
                    <div className="account-toggle-row">
                      <input
                        type="checkbox"
                        checked={notificationPreferences.taskDue}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  taskDue: event.target.checked
                                }
                              : current
                          )
                        }
                      />
                      <div className="account-toggle-copy">
                        <p className="account-preference-title">Task due reminders</p>
                        <p className="account-preference-description">Notify me before a task assigned to me becomes due.</p>
                      </div>
                    </div>
                  </label>

                  <label className="account-preference-item">
                    <div className="account-toggle-row">
                      <input
                        type="checkbox"
                        checked={notificationPreferences.mentionInWiki}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  mentionInWiki: event.target.checked
                                }
                              : current
                          )
                        }
                      />
                      <div className="account-toggle-copy">
                        <p className="account-preference-title">Wiki mentions</p>
                        <p className="account-preference-description">Notify me when I am mentioned in wiki content.</p>
                      </div>
                    </div>
                  </label>

                  <label className="account-preference-item">
                    <div className="account-toggle-row">
                      <input
                        type="checkbox"
                        checked={notificationPreferences.mentionInTaskComments}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  mentionInTaskComments: event.target.checked
                                }
                              : current
                          )
                        }
                      />
                      <div className="account-toggle-copy">
                        <p className="account-preference-title">Task comment mentions</p>
                        <p className="account-preference-description">Notify me when I am mentioned in task comments or discussion threads.</p>
                      </div>
                    </div>
                  </label>
                </div>

                <label>
                  Task due reminder lead time (hours)
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={24 * 14}
                    value={Number.isNaN(notificationPreferences.taskDueLeadHours) ? "" : notificationPreferences.taskDueLeadHours}
                    onChange={(event) =>
                      setNotificationPreferences((current) =>
                        current
                          ? {
                              ...current,
                              taskDueLeadHours: Number.parseInt(event.target.value, 10)
                            }
                          : current
                      )
                    }
                  />
                </label>

                {notificationValidationMessage ? <p className="alert alert-error">{notificationValidationMessage}</p> : null}

                <div className="button-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => void onSaveNotifications()}
                    disabled={notificationsSaving || !notificationsDirty || notificationValidationMessage !== null}
                  >
                    {notificationsSaving ? "Saving..." : "Save changes"}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      setNotificationPreferences(initialNotificationPreferences);
                      setNotificationsError(null);
                      setNotificationsSuccess(null);
                    }}
                    disabled={notificationsSaving || !notificationsDirty}
                  >
                    Reset
                  </button>
                </div>
              </>
            ) : null}
          </section>
          ) : null}
        </div>

        <div className="account-column">
          {activeTab === "git" ? (
          <section className="panel stack-md account-section-card account-git-access-panel">
            <WorkspaceHeader
              title="Git access"
              titleLevel="h2"
              metadata={
                <MetadataStrip
                  items={[
                    gitlabApiStatusLabel,
                    httpsCloneStatusLabel,
                    sshKeyCountLabel
                  ]}
                />
              }
            />

            {gitlabLoading ? <LoadingState title="Loading Git access" detail="Checking connection state." /> : null}
            {gitlabError ? <p className="alert alert-error">{gitlabError}</p> : null}
            {gitlabSuccess ? <p className="alert alert-success">{gitlabSuccess}</p> : null}
            {reconnectMessage ? <p className="alert alert-warning">{reconnectMessage}</p> : null}

            <div className="account-git-ledger">
              <section className="account-ledger-section account-ledger-section-primary">
                <div className="account-ledger-header">
                  <div className="stack-xxs">
                    <p className="account-ledger-kicker">Default clone</p>
                    <h3 className="account-ledger-title">HTTPS clone</h3>
                  </div>
                  <span className={connection?.httpsClone?.enabled ? "account-status-badge account-status-badge-success" : "account-status-badge"}>
                    {connection?.httpsClone?.enabled ? "Ready" : "Setup required"}
                  </span>
                </div>

                <dl className="account-credential-grid">
                  <div>
                    <dt>Username</dt>
                    <dd>{resolvedHttpsCloneUsername}</dd>
                  </div>
                  <div>
                    <dt>Last sync</dt>
                    <dd>{httpsCloneSyncedAt ? formatDateTimeLabel(httpsCloneSyncedAt) : "Not synced"}</dd>
                  </div>
                </dl>

                {httpsCloneError ? <p className="alert alert-error">{httpsCloneError}</p> : null}
                {httpsCloneSuccess ? <p className="alert alert-success">{httpsCloneSuccess}</p> : null}

                <form
                  className="account-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onSyncGitlabHttpsPassword();
                  }}
                >
                  <label>
                    Current Atlasium password
                    <input
                      className="input"
                      type="password"
                      value={httpsClonePassword}
                      onChange={(event) => setHttpsClonePassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                  <button className="button" type="submit" disabled={httpsCloneSubmitting || httpsClonePassword.length < 8}>
                    {httpsCloneSubmitting ? "Syncing..." : "Sync HTTPS password"}
                  </button>
                </form>

                <button
                  className="inline-link-button account-details-toggle"
                  type="button"
                  onClick={() => setGitConnectionDetailsOpen((current) => !current)}
                  aria-expanded={gitConnectionDetailsOpen}
                >
                  {gitConnectionDetailsOpen ? "Hide connection details" : "Connection details"}
                </button>

                {gitConnectionDetailsOpen ? (
                  <div className="account-command-panel stack-xs">
                    <p className="account-ssh-meta-label">Windows HTTPS credential reset</p>
                    <code className="account-ssh-hint">{`@"\nprotocol=https\nhost=git.atlasium.info\n\n"@ | git credential-manager erase`}</code>
                    <code className="account-ssh-hint">git clone https://{resolvedHttpsCloneUsername}@git.atlasium.info/atlasium/nav.git</code>
                  </div>
                ) : null}
              </section>

              <section className="account-ledger-section">
                <div className="account-ledger-header">
                  <div className="stack-xxs">
                    <p className="account-ledger-kicker">API identity</p>
                    <h3 className="account-ledger-title">GitLab API access</h3>
                  </div>
                  <span className={connection?.connected && !connection.reconnectRequired ? "account-status-badge account-status-badge-success" : "account-status-badge"}>
                    {connection?.connected ? (connection.reconnectRequired ? "Reconnect" : "Connected") : "Disconnected"}
                  </span>
                </div>

                {!gitlabLoading && connection?.connected ? (
                  <div className="account-linked-identity-row">
                    <div className="stack-xxs">
                      <strong>{connection.name || connection.username}</strong>
                      <span>{connection.email || "Email not exposed by GitLab OAuth"}</span>
                      <span className="text-muted">@{connection.username}</span>
                    </div>
                    <div className="button-row">
                      {connection.webUrl ? (
                        <a className="button button-secondary" href={connection.webUrl} target="_blank" rel="noreferrer">
                          Open GitLab
                        </a>
                      ) : null}
                      <button className="button button-secondary" type="button" onClick={() => void onConnect()} disabled={gitlabConnecting}>
                        {gitlabConnecting ? "Redirecting..." : connection.reconnectRequired ? "Reconnect" : "Refresh"}
                      </button>
                      <button className="button button-danger" type="button" onClick={() => setDisconnectConfirmOpen(true)} disabled={gitlabDisconnecting}>
                        Disconnect
                      </button>
                    </div>
                  </div>
                ) : null}

                {!gitlabLoading && !connection?.connected ? (
                  <div className="account-linked-identity-row">
                    <p className="text-muted">Connect GitLab API access for repository browsing, archive downloads, branches, merge requests, and SSH keys.</p>
                    <button className="button" type="button" onClick={() => void onConnect()} disabled={gitlabConnecting}>
                      {gitlabConnecting ? "Redirecting..." : "Connect GitLab"}
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="account-ledger-section">
                <div className="account-ledger-header">
                  <div className="stack-xxs">
                    <p className="account-ledger-kicker">Advanced</p>
                    <h3 className="account-ledger-title">SSH keys</h3>
                  </div>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setSshSectionOpen((current) => !current)}
                    aria-expanded={sshSectionOpen}
                  >
                    {sshSectionOpen ? "Hide" : "Manage"}
                  </button>
                </div>

                {sshSectionOpen ? (
                  <div className="account-ssh-management stack-md">
                    {sshError ? <p className="alert alert-error">{sshError}</p> : null}
                    {sshSuccess ? <p className="alert alert-success">{sshSuccess}</p> : null}
                    {!connection?.connected ? <p className="alert alert-info">Connect GitLab API access before managing SSH keys.</p> : null}
                    {connection?.connected && connection.reconnectRequired ? <p className="alert alert-warning">Reconnect GitLab before managing SSH keys.</p> : null}

                    {canManageSshKeys ? (
                      <>
                        <div className="account-section-toolbar">
                          <p className="text-muted">{sshKeyCountLabel}</p>
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => {
                              setSshError(null);
                              setSshSuccess(null);
                              setIsSshFormOpen(true);
                            }}
                          >
                            Add SSH key
                          </button>
                        </div>

                        {sshKeysLoading ? <LoadingState title="Loading SSH keys" detail="Retrieving linked keys." /> : null}

                        <div className="account-ssh-list-shell">
                          {!sshKeysLoading && sshKeys.length === 0 ? <p className="text-muted">No SSH keys added.</p> : null}

                          {sshKeys.map((sshKey) => {
                            const detailsExpanded = expandedSshKeyIds.includes(sshKey.id);

                            return (
                              <article key={sshKey.id} className={`account-ssh-row${detailsExpanded ? " is-expanded" : ""}`}>
                                <div className="account-ssh-row-main">
                                  <div className="account-ssh-row-heading">
                                    <strong className="account-ssh-row-title" title={sshKey.title}>
                                      {sshKey.title}
                                    </strong>
                                    {sshKey.usageType ? <span className="badge">{sshKey.usageType}</span> : null}
                                  </div>
                                </div>

                                <div className="account-ssh-row-actions">
                                  <button
                                    className="button button-secondary"
                                    type="button"
                                    onClick={() => toggleSshKeyDetails(sshKey.id)}
                                    disabled={deletingKeyId === sshKey.id}
                                    aria-expanded={detailsExpanded}
                                  >
                                    {detailsExpanded ? "Hide details" : "Details"}
                                  </button>
                                  <button
                                    className="button button-danger"
                                    type="button"
                                    onClick={() => void onDeleteSshKey(sshKey.id)}
                                    disabled={deletingKeyId === sshKey.id}
                                  >
                                    {deletingKeyId === sshKey.id ? "Removing..." : "Remove"}
                                  </button>
                                </div>

                                {detailsExpanded ? (
                                  <div className="account-ssh-row-details stack-sm">
                                    <div className="account-ssh-meta-grid">
                                      <div className="stack-xxs">
                                        <p className="account-ssh-meta-label">Added</p>
                                        <p className="account-ssh-meta-value">{formatDateTimeLabel(sshKey.createdAt)}</p>
                                      </div>
                                      <div className="stack-xxs">
                                        <p className="account-ssh-meta-label">Expires</p>
                                        <p className="account-ssh-meta-value">{sshKey.expiresAt || "No expiration"}</p>
                                      </div>
                                    </div>
                                    <div className="stack-xxs">
                                      <p className="account-ssh-meta-label">Public key</p>
                                      <code className="account-ssh-key-preview">{sshKey.key}</code>
                                    </div>
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </div>

            {isSshFormOpen ? (
              <Modal title="Add SSH key" onClose={() => setIsSshFormOpen(false)} className="account-ssh-key-modal">
                <div className="stack-md">
                  <h2 className="section-heading">Add SSH key</h2>
                  <label>
                    Title
                    <input className="input" value={sshKeyTitle} onChange={(event) => setSshKeyTitle(event.target.value)} placeholder="Laptop" />
                  </label>
                  <label>
                    Public key
                    <textarea
                      className="input account-ssh-key-textarea"
                      value={sshPublicKey}
                      onChange={(event) => setSshPublicKey(event.target.value)}
                      rows={6}
                      placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."
                    />
                  </label>
                  <label>
                    Expiration date
                    <input className="input" type="date" value={sshKeyExpiresAt} onChange={(event) => setSshKeyExpiresAt(event.target.value)} />
                  </label>
                  <div className="button-row">
                    <button
                      className="button"
                      type="button"
                      onClick={() => void onCreateSshKey()}
                      disabled={creatingSshKey || !sshKeyTitle.trim() || !sshPublicKey.trim()}
                    >
                      {creatingSshKey ? "Adding..." : "Add SSH key"}
                    </button>
                    <button className="button button-secondary" type="button" onClick={() => setIsSshFormOpen(false)} disabled={creatingSshKey}>
                      Cancel
                    </button>
                  </div>
                </div>
              </Modal>
            ) : null}

            {disconnectConfirmOpen ? (
              <ConfirmDialog
                title="Disconnect GitLab API access?"
                message="Atlasium Code will keep HTTPS clone settings, but repository browsing and SSH-key management need GitLab API access."
                confirmLabel={gitlabDisconnecting ? "Disconnecting..." : "Disconnect"}
                destructive
                busy={gitlabDisconnecting}
                onConfirm={() => void onDisconnect()}
                onCancel={() => setDisconnectConfirmOpen(false)}
              />
            ) : null}
          </section>
          ) : null}
        </div>
      </section>
    </section>
  );
}
