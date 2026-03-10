CREATE TYPE "InviteAccessMode" AS ENUM ('ALL_CURRENT_PROJECTS', 'SELECTED_PROJECTS');

ALTER TABLE "Invite"
  ADD COLUMN "accessMode" "InviteAccessMode" NOT NULL DEFAULT 'SELECTED_PROJECTS';

CREATE TABLE "InviteProject" (
  "id" TEXT NOT NULL,
  "inviteId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InviteProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteProject_inviteId_projectId_key" ON "InviteProject"("inviteId", "projectId");
CREATE INDEX "InviteProject_projectId_idx" ON "InviteProject"("projectId");

ALTER TABLE "InviteProject"
  ADD CONSTRAINT "InviteProject_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InviteProject"
  ADD CONSTRAINT "InviteProject_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
