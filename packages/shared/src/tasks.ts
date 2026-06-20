import { z } from "zod";

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const TaskStatusSchema = z.enum(TASK_STATUSES);
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskStatusValue = TaskStatus;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskPriorityValue = TaskPriority;

export type TaskAssignee = {
  id: string;
  name: string;
  email: string;
};

export type TaskSourceMeeting = {
  meetingId: string;
  meetingTitle: string;
  scheduledDate: string;
  actionId: string;
  actionTitle: string;
};

export type TaskListItem = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assignee: TaskAssignee | null;
  startDate: string | null;
  dueDate: string | null;
  parentTaskId: string | null;
  completedAt: string | null;
  sourceMeeting: TaskSourceMeeting | null;
  createdAt: string;
  updatedAt: string;
};

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

export type CreateTaskInput = z.input<typeof CreateTaskSchema>;

export type UpdateTaskInput = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  startDate?: string;
  dueDate?: string;
};
