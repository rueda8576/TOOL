ALTER TABLE "Meeting"
  ADD COLUMN "doneMarkdown" TEXT,
  ADD COLUMN "toDiscussMarkdown" TEXT,
  ADD COLUMN "toDoMarkdown" TEXT;

UPDATE "Meeting"
SET
  "toDiscussMarkdown" = "agendaMarkdown",
  "doneMarkdown" = "notesMarkdown"
WHERE "agendaMarkdown" IS NOT NULL OR "notesMarkdown" IS NOT NULL;

ALTER TABLE "Meeting"
  DROP COLUMN "agendaMarkdown",
  DROP COLUMN "notesMarkdown";
