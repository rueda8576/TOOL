import type {
  CreateMeetingInput,
  MeetingListItem,
  MeetingRecord,
  UpdateMeetingInput
} from "@doctoral/shared";

import { authFetch } from "./client-api";

export type {
  CreateMeetingInput,
  MeetingAutomationStatus,
  MeetingAutomationSummary,
  MeetingListItem,
  MeetingRecord,
  UpdateMeetingInput
} from "@doctoral/shared";

export type MeetingsViewMode = "list" | "calendar";

export async function listProjectMeetings(
  projectId: string,
  token: string,
  query?: { from?: string; to?: string }
): Promise<MeetingListItem[]> {
  const queryParams = new URLSearchParams();
  if (query?.from) {
    queryParams.set("from", query.from);
  }
  if (query?.to) {
    queryParams.set("to", query.to);
  }

  const suffix = queryParams.toString().length > 0 ? `?${queryParams.toString()}` : "";
  return authFetch<MeetingListItem[]>(`/projects/${projectId}/meetings${suffix}`, { token });
}

export async function createProjectMeeting(
  projectId: string,
  token: string,
  payload: CreateMeetingInput
): Promise<MeetingRecord> {
  return authFetch<MeetingRecord>(`/projects/${projectId}/meetings`, {
    token,
    init: {
      method: "POST",
      body: JSON.stringify(payload)
    }
  });
}

export async function updateMeeting(
  meetingId: string,
  token: string,
  payload: UpdateMeetingInput
): Promise<MeetingRecord> {
  return authFetch<MeetingRecord>(`/meetings/${meetingId}`, {
    token,
    init: {
      method: "PATCH",
      body: JSON.stringify(payload)
    }
  });
}

export async function deleteMeeting(meetingId: string, token: string): Promise<{ id: string; deletedAt: string }> {
  return authFetch<{ id: string; deletedAt: string }>(`/meetings/${meetingId}`, {
    token,
    init: {
      method: "DELETE"
    }
  });
}

export async function retryMeetingAutomation(meetingId: string, token: string): Promise<MeetingRecord> {
  return authFetch<MeetingRecord>(`/meetings/${meetingId}/automation/retry`, {
    token,
    init: {
      method: "POST"
    }
  });
}
