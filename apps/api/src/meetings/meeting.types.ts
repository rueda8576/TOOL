export type MeetingAutomationStatusValue = "queued" | "running" | "completed" | "failed" | "stale";

export type MeetingAutomationSummary = {
  id: string;
  status: MeetingAutomationStatusValue;
  createdTaskCount: number;
  createdActionCount: number;
  errorMessage: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type MeetingListItem = {
  id: string;
  projectId: string;
  title: string;
  scheduledAt: string;
  scheduledDate: string;
  location: string | null;
  doneMarkdown: string | null;
  toDiscussMarkdown: string | null;
  toDoMarkdown: string | null;
  actionsCount: number;
  automation: MeetingAutomationSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type MeetingRecordResponse = Omit<MeetingListItem, "actionsCount">;
