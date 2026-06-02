-- Wiki Docs sync persistence for GitLab-backed project documentation.

ALTER TABLE "ProjectRepository"
  ADD COLUMN "wikiDocsPrefix" TEXT,
  ADD COLUMN "wikiDocsLastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "wikiDocsLastSyncError" TEXT;

CREATE UNIQUE INDEX "ProjectRepository_projectId_wikiDocsPrefix_key"
  ON "ProjectRepository"("projectId", "wikiDocsPrefix");

CREATE TABLE "WikiDocsBinding" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "wikiPageId" TEXT,
  "docsPath" TEXT NOT NULL,
  "wikiPath" TEXT NOT NULL,
  "gitBlobId" TEXT,
  "gitLastCommitId" TEXT,
  "gitContentHash" TEXT,
  "wikiRevisionId" TEXT,
  "wikiContentHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WikiDocsBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiDocsBinding_wikiPageId_key"
  ON "WikiDocsBinding"("wikiPageId");

CREATE UNIQUE INDEX "WikiDocsBinding_repositoryId_docsPath_key"
  ON "WikiDocsBinding"("repositoryId", "docsPath");

CREATE UNIQUE INDEX "WikiDocsBinding_projectId_wikiPath_key"
  ON "WikiDocsBinding"("projectId", "wikiPath");

CREATE INDEX "WikiDocsBinding_projectId_status_idx"
  ON "WikiDocsBinding"("projectId", "status");

CREATE INDEX "WikiDocsBinding_repositoryId_status_idx"
  ON "WikiDocsBinding"("repositoryId", "status");

ALTER TABLE "WikiDocsBinding"
  ADD CONSTRAINT "WikiDocsBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiDocsBinding"
  ADD CONSTRAINT "WikiDocsBinding_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "ProjectRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiDocsBinding"
  ADD CONSTRAINT "WikiDocsBinding_wikiPageId_fkey" FOREIGN KEY ("wikiPageId") REFERENCES "WikiPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
