export const qaUser = {
  id: "user-admin",
  email: "admin@atlasium.test",
  username: "atlasium-admin",
  name: "Atlasium Admin",
  globalRole: "admin"
};

export const qaProject = {
  id: "project-1",
  key: "ATLS",
  name: "Atlasium Research Archive",
  description: "Operational workspace for documents, code, tasks, meetings, and the project wiki.",
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-18T09:00:00.000Z"
};

export const projectAccess = {
  isAdmin: true,
  projectRole: "admin",
  canWrite: true
};

export const projectSummary = {
  ...qaProject,
  role: "admin",
  memberCount: 4,
  documentCount: 2,
  taskCount: 4,
  meetingCount: 2,
  pinned: true,
  isPinned: true,
  updatedAt: qaProject.updatedAt
};

export const documentVersion = {
  id: "version-1",
  versionNumber: 3,
  compileStatus: "succeeded",
  hasPdf: true,
  hasLatex: false,
  latexEntryFile: null,
  createdAt: "2026-06-18T08:00:00.000Z"
};

export const documentItem = {
  id: "document-1",
  projectId: qaProject.id,
  title: "Field Study Protocol",
  type: "paper",
  authors: ["Atlasium Research Office"],
  tags: ["protocol", "archive"],
  publishedAt: "2026-06-12T09:00:00.000Z",
  updatedAt: "2026-06-18T08:30:00.000Z",
  latestMainVersion: documentVersion
};

export const wikiTree = [
  {
    type: "page",
    name: "home",
    id: "wiki-home",
    pageId: "wiki-home",
    title: "Archive Home",
    path: "home",
    depth: 0,
    parentPath: null,
    isDraft: false,
    isUnpublished: false,
    hasDraftChanges: false,
    docsSource: null,
    updatedAt: "2026-06-18T08:00:00.000Z",
    children: []
  }
];

export const wikiPage = {
  page: {
    id: "wiki-home",
    projectId: qaProject.id,
    slug: "home",
    title: "Archive Home",
    path: "home",
    parentPath: null,
    deletedAt: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-18T08:00:00.000Z"
  },
  draft: {
    title: "Archive Home",
    contentMarkdown: "# Archive Home\n\nAtlasium keeps project knowledge traceable across modules.",
    draftVersion: 2,
    updatedAt: "2026-06-18T08:00:00.000Z",
    updatedBy: qaUser
  },
  published: {
    revisionNumber: 1,
    title: "Archive Home",
    contentMarkdown: "# Archive Home\n\nAtlasium keeps project knowledge traceable across modules.",
    publishedAt: "2026-06-17T10:00:00.000Z",
    changeNote: "Initial archive page",
    publishedBy: qaUser
  },
  outgoingLinks: [],
  backlinks: [],
  docsSource: null
};

export const repository = {
  id: "repo-1",
  projectId: qaProject.id,
  name: "atlasium-research-archive",
  description: "Repository linked to the Atlasium workspace.",
  pathWithNamespace: "atlasium/research-archive",
  webUrl: "https://gitlab.example.test/atlasium/research-archive",
  defaultBranch: "main",
  lastActivityAt: "2026-06-18T08:00:00.000Z",
  status: "ready"
};

export const taskItems = [
  {
    id: "task-1",
    projectId: qaProject.id,
    title: "Review literature extraction",
    description: "Validate extracted meeting actions before publication.",
    status: "in_progress",
    priority: "high",
    assigneeId: qaUser.id,
    assignee: { id: qaUser.id, name: qaUser.name, email: qaUser.email },
    startDate: "2026-06-15",
    dueDate: "2026-06-22",
    parentTaskId: null,
    completedAt: null,
    sourceMeeting: null,
    createdAt: "2026-06-15T09:00:00.000Z",
    updatedAt: "2026-06-18T09:00:00.000Z"
  }
];

export const meetingItems = [
  {
    id: "meeting-1",
    projectId: qaProject.id,
    title: "Archive Review",
    scheduledAt: "2026-06-20T10:00:00.000Z",
    scheduledDate: "2026-06-20",
    location: "Research room",
    doneMarkdown: "Reviewed document lineage.",
    toDiscussMarkdown: "Repository removal checks.",
    toDoMarkdown: "- Validate visual QA",
    actionsCount: 1,
    automation: {
      id: "automation-1",
      status: "completed",
      createdTaskCount: 1,
      createdActionCount: 1,
      errorMessage: null,
      completedAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T09:00:00.000Z"
    },
    createdAt: "2026-06-15T09:00:00.000Z",
    updatedAt: "2026-06-18T09:00:00.000Z"
  }
];

export const projectOverview = {
  project: qaProject,
  access: projectAccess,
  attention: [
    {
      id: "attention-1",
      severity: "info",
      module: "documents",
      title: "Protocol ready",
      detail: "Latest document version compiled successfully.",
      href: `/projects/${qaProject.id}/documents/${documentItem.id}`,
      date: "2026-06-18"
    }
  ],
  modules: {
    wiki: {
      publishedPages: 1,
      draftPages: 1,
      latestUpdatedAt: "2026-06-18T08:00:00.000Z",
      recentPages: [{ id: "wiki-home", title: "Archive Home", path: "home", updatedAt: "2026-06-18T08:00:00.000Z", isDraft: false }]
    },
    documents: {
      total: 1,
      failedCompiles: 0,
      runningCompiles: 0,
      latestUpdatedAt: documentItem.updatedAt,
      recent: [{ id: documentItem.id, title: documentItem.title, type: documentItem.type, updatedAt: documentItem.updatedAt, compileStatus: "succeeded" }]
    },
    code: {
      connected: true,
      repositoryCount: 1,
      latestRepository: repository,
      lastActivityAt: repository.lastActivityAt
    },
    tasks: {
      open: 1,
      inProgress: 1,
      blocked: 0,
      overdue: 0,
      critical: 0,
      next: [{ id: "task-1", title: taskItems[0].title, priority: "high", status: "in_progress", dueDate: "2026-06-22", assigneeName: qaUser.name }]
    },
    meetings: {
      thisMonth: 1,
      upcoming: 1,
      openActions: 1,
      next: [{ id: "meeting-1", title: "Archive Review", scheduledAt: "2026-06-20T10:00:00.000Z", scheduledDate: "2026-06-20", location: "Research room", actionsCount: 1 }]
    }
  },
  activity: [
    {
      id: "activity-1",
      module: "wiki",
      title: "Archive Home published",
      detail: "Initial page published",
      href: `/projects/${qaProject.id}/wiki`,
      occurredAt: "2026-06-17T10:00:00.000Z"
    }
  ]
};

export const operationsLedger = {
  generatedAt: "2026-06-19T10:00:00.000Z",
  backups: {
    summary: {
      total: 2,
      running: 0,
      succeeded: 1,
      failed: 1
    },
    runs: [
      {
        id: "backup-1",
        status: "succeeded",
        startedAt: "2026-06-19T08:00:00.000Z",
        completedAt: "2026-06-19T08:02:00.000Z",
        retentionUntil: "2026-07-19T08:02:00.000Z",
        durationMs: 120000,
        dbDumpBytes: 24576,
        storageArchiveBytes: 65536,
        dbDumpSha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        storageArchiveSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        toolVersions: {
          pgDump: "pg_dump 16.9",
          pgRestore: "pg_restore 16.9",
          tar: "tar 1.34"
        },
        error: null
      },
      {
        id: "backup-2",
        status: "failed",
        startedAt: "2026-06-18T08:00:00.000Z",
        completedAt: "2026-06-18T08:00:10.000Z",
        retentionUntil: null,
        durationMs: 10000,
        dbDumpBytes: null,
        storageArchiveBytes: null,
        dbDumpSha256: null,
        storageArchiveSha256: null,
        toolVersions: {
          pgDump: "pg_dump 16.9"
        },
        error: "pg_dump failed before validation."
      }
    ]
  }
};
