CREATE TYPE "MeetingAutomationStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'STALE');

ALTER TABLE "Task"
  ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "Task"
SET "completedAt" = "updatedAt"
WHERE "status" = 'DONE' AND "completedAt" IS NULL;

ALTER TABLE "MeetingAction"
  ADD COLUMN "automationRunId" TEXT,
  ADD COLUMN "aiSourceHash" TEXT,
  ADD COLUMN "aiSourceText" TEXT;

CREATE TABLE "MeetingAutomationRun" (
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestedById" TEXT,
  "status" "MeetingAutomationStatus" NOT NULL DEFAULT 'QUEUED',
  "inputHash" TEXT NOT NULL,
  "queueJobId" TEXT,
  "errorMessage" TEXT,
  "createdTaskCount" INTEGER NOT NULL DEFAULT 0,
  "createdActionCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Task_projectId_completedAt_idx" ON "Task"("projectId", "completedAt");
CREATE UNIQUE INDEX "MeetingAction_aiSourceHash_key" ON "MeetingAction"("aiSourceHash");
CREATE INDEX "MeetingAction_linkedTaskId_idx" ON "MeetingAction"("linkedTaskId");
CREATE INDEX "MeetingAction_automationRunId_idx" ON "MeetingAction"("automationRunId");
CREATE INDEX "MeetingAutomationRun_meetingId_createdAt_idx" ON "MeetingAutomationRun"("meetingId", "createdAt");
CREATE INDEX "MeetingAutomationRun_projectId_status_idx" ON "MeetingAutomationRun"("projectId", "status");

ALTER TABLE "MeetingAction"
  ADD CONSTRAINT "MeetingAction_automationRunId_fkey"
  FOREIGN KEY ("automationRunId") REFERENCES "MeetingAutomationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingAutomationRun"
  ADD CONSTRAINT "MeetingAutomationRun_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MeetingAutomationRun"
  ADD CONSTRAINT "MeetingAutomationRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MeetingAutomationRun"
  ADD CONSTRAINT "MeetingAutomationRun_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
