ALTER TABLE "ProjectRepository"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ProjectRepository" AS repo
SET
  "name" = project."name",
  "description" = project."description",
  "lastActivityAt" = repo."updatedAt"
FROM "Project" AS project
WHERE repo."projectId" = project."id";

UPDATE "ProjectRepository"
SET "name" = "pathWithNamespace"
WHERE "name" IS NULL OR btrim("name") = '';

ALTER TABLE "ProjectRepository"
  ALTER COLUMN "name" SET NOT NULL;

DROP INDEX IF EXISTS "ProjectRepository_projectId_key";
CREATE INDEX "ProjectRepository_projectId_idx" ON "ProjectRepository"("projectId");
