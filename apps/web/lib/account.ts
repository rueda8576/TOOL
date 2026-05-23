import { authFetch } from "./client-api";

export type AccountProfile = {
  id: string;
  name: string;
  email: string;
  username: string;
  globalRole: "admin" | "editor" | "reader";
  timezone: string;
};

export type NotificationPreferences = {
  emailEnabled: boolean;
  taskAssigned: boolean;
  taskDue: boolean;
  mentionInWiki: boolean;
  mentionInTaskComments: boolean;
  taskDueLeadHours: number;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type SyncGitlabHttpsPasswordPayload = {
  currentPassword: string;
};

export type GitlabHttpsPasswordStatus = {
  enabled: true;
  username: string;
};

export type UpdateUsernamePayload = {
  username: string;
};

export async function getCurrentAccountProfile(token: string): Promise<AccountProfile> {
  return authFetch<AccountProfile>("/auth/me", { token });
}

export async function changeAccountPassword(
  token: string,
  payload: ChangePasswordPayload
): Promise<{ changed: true }> {
  return authFetch<{ changed: true }>("/auth/password/change", {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function syncGitlabHttpsPassword(
  token: string,
  payload: SyncGitlabHttpsPasswordPayload
): Promise<GitlabHttpsPasswordStatus> {
  return authFetch<GitlabHttpsPasswordStatus>("/auth/gitlab/https-password", {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function updateAccountUsername(
  token: string,
  payload: UpdateUsernamePayload
): Promise<AccountProfile> {
  return authFetch<AccountProfile>("/auth/me/username", {
    token,
    init: {
      method: "PATCH",
      body: JSON.stringify(payload)
    }
  });
}

export async function getNotificationPreferences(token: string): Promise<NotificationPreferences> {
  return authFetch<NotificationPreferences>("/users/me/notification-preferences", { token });
}

export async function updateAccountNotificationPreferences(
  token: string,
  payload: NotificationPreferences
): Promise<NotificationPreferences> {
  return authFetch<NotificationPreferences>("/users/me/notification-preferences", {
    token,
    init: {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  });
}
