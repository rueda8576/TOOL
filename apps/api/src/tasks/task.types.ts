export type TaskStatusValue = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriorityValue = "low" | "medium" | "high" | "critical";

export type TaskAssignee = {
  id: string;
  name: string;
  email: string;
};

export type TaskListItem = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatusValue;
  priority: TaskPriorityValue;
  assigneeId: string | null;
  assignee: TaskAssignee | null;
  startDate: string | null;
  dueDate: string | null;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
};
