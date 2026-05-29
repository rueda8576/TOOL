-- Wiki link consistency, soft-delete path reuse, and search indexes.

DROP INDEX IF EXISTS "WikiPage_projectId_path_key";

CREATE UNIQUE INDEX "WikiPage_projectId_path_active_key"
  ON "WikiPage"("projectId", "path")
  WHERE "deletedAt" IS NULL;

CREATE INDEX "WikiPage_projectId_path_idx"
  ON "WikiPage"("projectId", "path");

CREATE INDEX "WikiPage_search_title_idx"
  ON "WikiPage" USING GIN (to_tsvector('simple', COALESCE("title", '')));

CREATE INDEX "WikiPage_search_path_idx"
  ON "WikiPage" USING GIN (to_tsvector('simple', COALESCE("path", '')));

CREATE INDEX "WikiRevision_search_content_idx"
  ON "WikiRevision" USING GIN (to_tsvector('simple', COALESCE("contentMarkdown", '')));

CREATE INDEX "WikiDraft_search_content_idx"
  ON "WikiDraft" USING GIN (to_tsvector('simple', COALESCE("contentMarkdown", '')));
