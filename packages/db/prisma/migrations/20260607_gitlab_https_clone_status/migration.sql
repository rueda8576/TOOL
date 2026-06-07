ALTER TABLE "User" ADD COLUMN "gitlabHttpsPasswordSyncedAt" TIMESTAMP(3);

UPDATE "User" AS u
SET "gitlabHttpsPasswordSyncedAt" = latest."createdAt"
FROM (
  SELECT "userId", MAX("createdAt") AS "createdAt"
  FROM "AuditLog"
  WHERE "userId" IS NOT NULL
    AND "action" IN ('auth.gitlab.https_password.sync', 'auth.password.change')
  GROUP BY "userId"
) AS latest
WHERE u."id" = latest."userId";
