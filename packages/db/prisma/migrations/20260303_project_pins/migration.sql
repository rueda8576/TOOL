CREATE TABLE "UserPinnedProject" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserPinnedProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPinnedProject_userId_projectId_key" ON "UserPinnedProject"("userId", "projectId");
CREATE INDEX "UserPinnedProject_userId_idx" ON "UserPinnedProject"("userId");
CREATE INDEX "UserPinnedProject_projectId_idx" ON "UserPinnedProject"("projectId");

ALTER TABLE "UserPinnedProject"
  ADD CONSTRAINT "UserPinnedProject_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPinnedProject"
  ADD CONSTRAINT "UserPinnedProject_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
