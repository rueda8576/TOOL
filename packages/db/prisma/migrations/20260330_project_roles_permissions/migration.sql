CREATE TYPE "ProjectRole" AS ENUM ('EDITOR', 'READER');

ALTER TABLE "Invite"
  ADD COLUMN "defaultProjectRole" "ProjectRole";

ALTER TABLE "InviteProject"
  ADD COLUMN "role" "ProjectRole";

ALTER TABLE "ProjectMember"
  ADD COLUMN "role" "ProjectRole";

UPDATE "ProjectMember" AS pm
SET "role" = CASE
  WHEN u."globalRole" IN ('ADMIN', 'EDITOR') THEN 'EDITOR'::"ProjectRole"
  ELSE 'READER'::"ProjectRole"
END
FROM "User" AS u
WHERE pm."userId" = u."id";

UPDATE "InviteProject" AS ip
SET "role" = CASE
  WHEN i."globalRole" IN ('ADMIN', 'EDITOR') THEN 'EDITOR'::"ProjectRole"
  ELSE 'READER'::"ProjectRole"
END
FROM "Invite" AS i
WHERE ip."inviteId" = i."id";

UPDATE "Invite"
SET "defaultProjectRole" = CASE
  WHEN "globalRole" IN ('ADMIN', 'EDITOR') THEN 'EDITOR'::"ProjectRole"
  ELSE 'READER'::"ProjectRole"
END
WHERE "accessMode" = 'ALL_CURRENT_PROJECTS';

ALTER TABLE "InviteProject"
  ALTER COLUMN "role" SET DEFAULT 'READER',
  ALTER COLUMN "role" SET NOT NULL;

ALTER TABLE "ProjectMember"
  ALTER COLUMN "role" SET DEFAULT 'READER',
  ALTER COLUMN "role" SET NOT NULL;
