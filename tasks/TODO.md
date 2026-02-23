# Implementation TODO (v1 bootstrap)

## Sprint 0 - Foundation
- [x] Initialize git repository and monorepo structure.
- [x] Add root workspace config (`pnpm`, TS base, env example).
- [x] Add Docker Compose and CI pipeline skeleton.

## Sprint 1 - Access + Projects + Wiki
- [x] Implement Prisma data model for users, invites, projects, wiki, audit.
- [x] Build NestJS API with auth/invite flow and role checks.
- [x] Add projects membership and visibility controls.
- [x] Add wiki pages with linear revision history.

## Sprint 2 - Documents PDF/LaTeX
- [x] Add document entities, branches, immutable versions, file metadata.
- [x] Implement file upload and local storage adapter (1 GB limit).
- [x] Implement compile queue endpoint and compile status/log retrieval.
- [x] Implement worker compile processor (`pdflatex`, timeout, no shell-escape).

## Sprint 3 - Tasks + Notifications
- [x] Implement tasks CRUD, dependencies, subtasks (multilevel), fixed statuses.
- [x] Add reminder preferences by user.
- [x] Add notification event model and email queue processor.

## Sprint 4 - Meetings + Ops
- [x] Implement meeting module with structured actions and task links.
- [x] Add backup run model and backup worker.
- [x] Add health endpoints and ops docs.

## Sprint 5 - Frontend + Hardening
- [x] Build responsive Next.js shell for projects/wiki/docs/tasks/meetings.
- [x] Wire API SDK and basic authenticated flow.
- [x] Add unit/integration test skeleton for critical services.
- [x] Finalize deploy docs for VPS + domain + HTTPS.

## Task Board MVP - Real Data (2026-02-21)
- [x] Add `GET /projects/:projectId/tasks` with optional `includeSubtasks`.
- [x] Implement `TasksService.listTasks` with project-read access control and API enum mapping.
- [x] Add API unit tests for task listing behavior and permission path.
- [x] Add frontend task client helpers (`listProjectTasks`, `createProjectTask`).
- [x] Replace static tasks page with authenticated create form + live kanban columns.
- [x] Run API tests/build and web build validation.

## Fix - Dynamic Project Navigation (2026-02-21)
- [x] Remove hardcoded `/projects/demo/*` links from sidebar.
- [x] Make `AppShell` project-aware via optional `projectId` prop.
- [x] Pass `projectId` to `AppShell` in all project pages.
- [x] Verify frontend and API build checks still pass.

## Projects UI - Create Project (2026-02-21)
- [x] Add create-project form to `/projects`.
- [x] Enforce UI validation aligned with API (`key` uppercase pattern).
- [x] Respect roles in UI (`reader` cannot create).
- [x] Refresh list after successful creation.
- [x] Validate with frontend build.

## Project Header Label Consistency (2026-02-21)
- [x] Add shared project subtitle component (`KEY - Name`) from `/projects` list.
- [x] Apply consistent subtitle rendering across project tabs.
- [x] Remove direct raw `projectId` display from project subtitles.
- [x] Validate with frontend build.

## Tasks UX vNext (2026-02-22)
- [x] Add project members read endpoint (`GET /projects/:projectId/members`) for assignee selector.
- [x] Extend task list payload with assignee object (`id`, `name`, `email`) while keeping `assigneeId`.
- [x] Add soft-delete task endpoint (`DELETE /tasks/:taskId`) with blockers for active subtasks and incoming dependencies.
- [x] Validate assignee membership on create/update/subtask mutations.
- [x] Replace always-open create panel with toolbar + `New task` toggle (board-first by default).
- [x] Add unified create/edit task form (title, description, status, priority, assignee).
- [x] Add contextual task actions (`Edit`, `Delete`) via right-click and `...` button.
- [x] Show assignee on task cards (`Assigned to: ...` or `Unassigned`).
- [x] Enforce reader read-only behavior in UI for create/edit/delete actions.
- [x] Validate with `api test`, `api build`, and `web build`.

## Web UI Redesign - Academic Slate (2026-02-22)
- [x] Replace global visual tokens with `Academic Slate` system and accessible focus styles.
- [x] Modernize `AppShell` (fixed sidebar + stable content header + project-context active navigation).
- [x] Unify component styling for panels, buttons, forms, badges, alerts, cards, and kanban.
- [x] Refresh all web pages (`home`, `login`, `projects`, `project modules`, `documents editor`, `tasks`) without changing business logic.
- [x] Add responsive behavior for desktop/tablet/mobile while keeping sidebar/top-nav adaptation.
- [x] Preserve task workflows and contextual actions while improving visual hierarchy.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Documents vNext - Functional Flow (2026-02-22)
- [x] Finish backend docs list/detail endpoints and folder upload validation coverage.
- [x] Implement documents list page with real data and one-step create+upload flow.
- [x] Add document detail route `/projects/:projectId/documents/:documentId` with LaTeX editor + PDF preview.
- [x] Keep legacy editor route compatible via redirect.
- [x] Add responsive styles for documents split panes and code/file tree panels.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/web build`.

## Documents vNext - Dense Detail Workspace (2026-02-22)
- [x] Hide `AppShell` header only on document detail via `hideHeader`.
- [x] Replace detail metadata card with compact top bar (title/meta/status/back/tree toggle).
- [x] Implement 50/50 viewport-height workspace split (editor left, preview right).
- [x] Convert file tree to VSCode-like hierarchical sidebar with folder expand/collapse.
- [x] Add global tree collapse with persisted preference and `Ctrl/Cmd+B` shortcut.
- [x] Add `Ctrl/Cmd+S` shortcut to run Save then Compile (reader-safe/no-latex-safe).
- [x] Move compile log out of preview pane and keep PDF pane full-height.
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Fix - LaTeX Compile "main.tex not found" (2026-02-22)
- [x] Identify root cause: API and worker using different relative `STORAGE_ROOT` paths due package-specific cwd.
- [x] Normalize `STORAGE_ROOT` during `.env` load in API and worker to a shared absolute location.
- [x] Keep backward compatibility by preferring existing initialized storage directories (`apps/api/storage` or `apps/worker/storage`) when present.
- [x] Validate with `pnpm --filter @doctoral/api build` and `pnpm --filter @doctoral/worker build`.

## Documents Detail UX - Collapsible Compile Log + PDF Zoom (2026-02-22)
- [x] Keep compile log collapsed by default and add explicit show/hide toggle.
- [x] Auto-open compile log on terminal compile failures (`failed`, `timeout`).
- [x] Remove `PDF preview` heading above right panel in both LaTeX and PDF-only layouts.
- [x] Open PDF iframe with default zoom fragment `#zoom=page-width`.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Meetings vNext - Date-Oriented Minutes (2026-02-22)
- [x] Add meetings list/update/delete API endpoints with project access checks.
- [x] Normalize day-only dates and expose `scheduledDate` in meeting responses.
- [x] Enforce soft-delete behavior for meetings and block linking actions for deleted meetings.
- [x] Add meetings service unit tests for list filters, date normalization, update, delete, and deleted-meeting link guard.
- [x] Implement web meetings client (`apps/web/lib/meetings.ts`) for list/create/update/delete.
- [x] Replace static meetings page with functional List + Calendar views and inline create/edit form.
- [x] Add calendar month navigation, day selection, and side panel filtered by selected day.
- [x] Add responsive meetings styles in `globals.css` and keep reader role read-only behavior.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

## Meetings vNext - Minutes Sections + Markdown Toolbar (2026-02-22)
- [x] Rename minute content fields from `agenda/notes` to `done/toDiscuss/toDo` across Prisma, API, and web.
- [x] Add Prisma migration with backfill (`agenda -> toDiscuss`, `notes -> done`, `toDo -> null`) and remove legacy columns.
- [x] Update meetings DTOs, service mappings, and tests to new section fields.
- [x] Implement markdown toolbars on each section (`Bullets`, `Numbered`, `Checklist`, `Indent`, `Outdent`) with `Tab` / `Shift+Tab`.
- [x] Update minutes list/calendar snippets to display `Done`, `To discuss`, and `To do`.
- [x] Validate with `pnpm --filter @doctoral/db db:generate`, `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

## Meetings Calendar UX - Highlight Days Without Counts (2026-02-22)
- [x] Remove visible per-day `X minutes` counter text from month cells.
- [x] Add visual highlighted state for days with at least one minute.
- [x] Add non-text dot indicator for days with minutes.
- [x] Preserve keyboard/accessibility by adding descriptive day `aria-label` with minute availability/count.
- [x] Keep existing day selection/filter behavior and side panel flow unchanged.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Documents vNext - Resizable Split + Deterministic PDF Zoom (2026-02-23)
- [x] Add draggable vertical splitter between LaTeX editor pane and PDF preview pane in document detail.
- [x] Persist split width per browser in `localStorage` and keep responsive fallback stack layout on tablet/mobile.
- [x] Add keyboard accessibility for splitter (`ArrowLeft` / `ArrowRight`) and separator semantics.
- [x] Replace native blob iframe zoom behavior with self-hosted PDF.js viewer endpoint (`/pdfjs/web/viewer.html`) using default `zoom=page-width`.
- [x] Add `pdfjs-dist` dependency and asset sync script (`pdfjs:sync`) wired into `prebuild`.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Documents Fix - Robust Splitter + Contextual PDF Save (2026-02-23)
- [x] Fix splitter drag reliability by moving drag tracking to temporary global `window` pointer listeners.
- [x] Lower splitter-enabled viewport breakpoint from `1200px` to `992px`.
- [x] Correct split clamp math using real grid gap + splitter fixed width.
- [x] Add topbar `Download PDF` button in document detail.
- [x] Pass readable filename to PDF viewer and support download via query (`filename=`).
- [x] Add `Ctrl/Cmd+S` contextual behavior: editor => save+compile, PDF viewer/no-LaTeX => download PDF.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Documents Fix - Overleaf Splitter Interaction (2026-02-23)
- [x] Rework splitter to Overleaf-style handle (thin line + wide transparent drag area).
- [x] Enable splitter from `>=768px` and keep mobile stack below that breakpoint.
- [x] Add fullscreen transparent drag scrim during resize so pointer movement remains stable across PDF iframe.
- [x] Keep accessibility (`separator` semantics + keyboard arrows) and width persistence unchanged.
- [x] Revalidate PDF download regressions (`Download PDF`, contextual `Ctrl/Cmd+S`, viewer filename query).
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Documents Fix - Splitter Click Jump (2026-02-23)
- [x] Remove width mutation on splitter `pointerdown` to prevent initial jump without drag movement.
- [x] Initialize drag from real rendered editor pane width (`getBoundingClientRect`) for stable delta calculations.
- [x] Keep clamp behavior and persistence unchanged.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Review Log
- 2026-02-20: Bootstrap implementation started from empty repository.
- 2026-02-20: Monorepo scaffold completed with API, worker, web, DB schema, queues, backups, and deployment docs.
- 2026-02-20: Frontend login/token flow and API e2e test skeleton added.
- 2026-02-20: Containerized validation passed (`api build`, `worker build`, `web build`, `api tests`).
- 2026-02-20: Added LaTeX editable workspace endpoints (`tree`, `read file`, `update file`) tied to compile workflow.
- 2026-02-20: Added baseline web LaTeX editor page with load/save/compile actions.
- 2026-02-21: Fixed local startup regression by loading root `.env` automatically in API/worker/seed entrypoints.
- 2026-02-21: Implemented task board MVP with real task list API, create-task form, and live kanban rendering in web UI.
- 2026-02-21: Fixed 404 on task creation caused by hardcoded `demo` project links; sidebar now uses active `projectId`.
- 2026-02-21: Added create-project form in `/projects` with role-aware UI, input validation, and live list refresh.
- 2026-02-21: Unified project subtitle across tabs to show `KEY - Name` instead of raw CUID id.
- 2026-02-22: Implemented Tasks UX vNext with collapsed `New task` flow, assignee visibility/editing, contextual edit/delete actions, and safe soft-delete guards.
- 2026-02-22: Completed full frontend visual redesign to `Academic Slate` style with active navigation states, unified UI components, and responsive accessibility baseline (WCAG AA-oriented).
- 2026-02-22: Delivered Documents vNext functional flow with real list API wiring, one-step create+upload (PDF/folder), document detail editor+preview route, and responsive split-pane styling.
- 2026-02-22: Iterated Documents detail to dense workspace UX with hidden global header, compact topbar, VSCode-like collapsible tree (`Ctrl/Cmd+B`), and save+compile shortcut (`Ctrl/Cmd+S`).
- 2026-02-22: Fixed LaTeX compile failure (`main.tex` not found) by aligning API/worker storage root resolution to the same absolute directory.
- 2026-02-22: Improved Documents detail preview UX by collapsing compile logs by default, adding explicit log toggle, removing redundant PDF header labels, and opening PDFs with `page-width` zoom fragment.
- 2026-02-22: Implemented Meetings vNext with date-oriented minutes CRUD, list+calendar views, monthly navigation with day-side filtering, and backend day-only date normalization with soft-delete protections.
- 2026-02-22: Migrated minutes content model to `Done / To discuss / To do` with Prisma backfill migration and added markdown editing toolbar support (lists + indent/outdent shortcuts) in Meetings UI.
- 2026-02-22: Improved Meetings calendar readability by replacing per-cell numeric counters with subtle highlighted day states + dot markers, while preserving date filtering behavior and accessibility labels.
- 2026-02-23: Added document workspace resizable split pane (drag + keyboard + persistence) and switched embedded PDF preview to self-hosted PDF.js viewer for deterministic `page-width` initial zoom.
- 2026-02-23: Fixed document splitter usability (global drag tracking + 992px breakpoint), added explicit PDF download action, and made `Ctrl/Cmd+S` contextual so PDF focus triggers file download instead of saving webpage HTML.
- 2026-02-23: Reworked document splitter to Overleaf-style interaction with wide drag handle and fullscreen scrim, plus lowered activation breakpoint to `768px` for consistent availability.
- 2026-02-23: Fixed residual splitter click-jump by anchoring drag start to rendered pane width and avoiding any width set on `pointerdown`.
