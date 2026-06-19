import { z } from "zod";

export const MEETING_AUTOMATION_STATUSES = ["queued", "running", "completed", "failed", "stale"] as const;

export const MeetingAutomationStatusSchema = z.enum(MEETING_AUTOMATION_STATUSES);
export type MeetingAutomationStatus = (typeof MEETING_AUTOMATION_STATUSES)[number];
export type MeetingAutomationStatusValue = MeetingAutomationStatus;

export type MeetingAutomationSummary = {
  id: string;
  status: MeetingAutomationStatus;
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

export type MeetingRecord = Omit<MeetingListItem, "actionsCount">;
export type MeetingRecordResponse = MeetingRecord;

export const CreateMeetingSchema = z.object({
  title: z.string().min(1).max(300),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T.+)?$/),
  location: z.string().max(300).optional(),
  doneMarkdown: z.string().optional(),
  toDiscussMarkdown: z.string().optional(),
  toDoMarkdown: z.string().optional()
});

export type CreateMeetingInput = z.input<typeof CreateMeetingSchema>;

export type UpdateMeetingInput = {
  title?: string;
  scheduledAt?: string;
  location?: string;
  doneMarkdown?: string | null;
  toDiscussMarkdown?: string | null;
  toDoMarkdown?: string | null;
};
