import { z } from "zod";

export const GlobalRoleSchema = z.enum(["admin", "editor", "reader"]);
export type GlobalRole = z.infer<typeof GlobalRoleSchema>;

export const TaskStatusSchema = z.enum(["todo", "in_progress", "blocked", "done"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const ReminderPreferenceSchema = z.object({
  emailEnabled: z.boolean(),
  taskAssigned: z.boolean(),
  taskDue: z.boolean(),
  taskDueLeadHours: z.number().int().positive().max(24 * 14)
});
export type ReminderPreference = z.infer<typeof ReminderPreferenceSchema>;

export const DocumentTypeSchema = z.enum([
  "paper",
  "manual",
  "model",
  "draft",
  "minutes",
  "other"
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: TaskPrioritySchema.default("medium"),
  status: TaskStatusSchema.default("todo"),
  assigneeId: z.string().cuid().optional(),
  startDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  parentTaskId: z.string().cuid().optional()
});

export const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  type: DocumentTypeSchema.default("other"),
  authors: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  publishedAt: z.string().datetime().optional()
});

export const CreateWikiPageSchema = z.object({
  title: z.string().min(1).max(300),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  templateType: z.string().max(120).optional(),
  contentMarkdown: z.string().default("")
});

export const UpdateWikiPageSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  contentMarkdown: z.string().min(0),
  changeNote: z.string().max(500).optional()
});

export const CreateMeetingSchema = z.object({
  title: z.string().min(1).max(300),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T.+)?$/),
  location: z.string().max(300).optional(),
  doneMarkdown: z.string().optional(),
  toDiscussMarkdown: z.string().optional(),
  toDoMarkdown: z.string().optional()
});
