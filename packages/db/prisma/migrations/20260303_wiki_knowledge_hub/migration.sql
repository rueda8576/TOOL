-- Wiki Knowledge Hub: hierarchy paths, drafts, links, and assets

ALTER TABLE "WikiPage"
  ADD COLUMN "folderPath" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "path" TEXT;

UPDATE "WikiPage"
SET "path" = lower("slug")
WHERE "path" IS NULL;

ALTER TABLE "WikiPage"
  ALTER COLUMN "path" SET NOT NULL;

DROP INDEX "WikiPage_projectId_slug_key";
CREATE UNIQUE INDEX "WikiPage_projectId_path_key" ON "WikiPage"("projectId", "path");

CREATE TABLE "WikiDraft" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "contentMarkdown" TEXT NOT NULL,
  "draftVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WikiDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiDraft_pageId_key" ON "WikiDraft"("pageId");
CREATE INDEX "WikiDraft_updatedAt_idx" ON "WikiDraft"("updatedAt");

ALTER TABLE "WikiDraft"
  ADD CONSTRAINT "WikiDraft_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiDraft"
  ADD CONSTRAINT "WikiDraft_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "WikiDraft" ("id", "pageId", "title", "contentMarkdown", "draftVersion", "updatedById", "createdAt", "updatedAt")
SELECT
  'draft_' || "WikiPage"."id",
  "WikiPage"."id",
  "WikiPage"."title",
  COALESCE("WikiRevision"."contentMarkdown", ''),
  1,
  "WikiPage"."createdById",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "WikiPage"
LEFT JOIN "WikiRevision" ON "WikiRevision"."id" = "WikiPage"."currentRevisionId";

CREATE TABLE "WikiLink" (
  "id" TEXT NOT NULL,
  "fromPageId" TEXT NOT NULL,
  "toPath" TEXT NOT NULL,
  "toPageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WikiLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiLink_fromPageId_toPath_key" ON "WikiLink"("fromPageId", "toPath");
CREATE INDEX "WikiLink_toPageId_idx" ON "WikiLink"("toPageId");
CREATE INDEX "WikiLink_toPath_idx" ON "WikiLink"("toPath");

ALTER TABLE "WikiLink"
  ADD CONSTRAINT "WikiLink_fromPageId_fkey" FOREIGN KEY ("fromPageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiLink"
  ADD CONSTRAINT "WikiLink_toPageId_fkey" FOREIGN KEY ("toPageId") REFERENCES "WikiPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WikiAsset" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fileObjectId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WikiAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiAsset_fileObjectId_key" ON "WikiAsset"("fileObjectId");
CREATE INDEX "WikiAsset_projectId_createdAt_idx" ON "WikiAsset"("projectId", "createdAt");

ALTER TABLE "WikiAsset"
  ADD CONSTRAINT "WikiAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiAsset"
  ADD CONSTRAINT "WikiAsset_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiAsset"
  ADD CONSTRAINT "WikiAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
