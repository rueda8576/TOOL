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
  createdAt: string;
  updatedAt: string;
};

export type MeetingRecordResponse = {
  id: string;
  projectId: string;
  title: string;
  scheduledAt: string;
  scheduledDate: string;
  location: string | null;
  doneMarkdown: string | null;
  toDiscussMarkdown: string | null;
  toDoMarkdown: string | null;
  createdAt: string;
  updatedAt: string;
};
