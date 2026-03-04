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

## Documents vNext - Monaco Editor + Word Sync (2026-02-23)
- [x] Integrate Monaco editor (local bundled) in document detail replacing textarea editor.
- [x] Add custom language/theme registration for LaTeX and BibTeX (`.tex` + `.bib`) with indentation rules.
- [x] Add editor shortcuts for find/replace, indent/outdent (`Tab`, `Shift+Tab`, `Ctrl+]`, `Ctrl+[`), and editor-only font zoom (`Ctrl/Cmd +`, `Ctrl/Cmd -`, `Ctrl/Cmd 0`) with persisted font size.
- [x] Keep existing shortcuts behavior (`Ctrl/Cmd+S` save+compile, `Ctrl/Cmd+B` tree toggle) in Monaco integration.
- [x] Add bidirectional word sync via `postMessage`: editor double-click highlights in PDF, PDF double-click highlights in editor.
- [x] Extend self-hosted PDF.js viewer to render text layer and support temporary word highlights with auto-scroll to first match.
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Projects vNext - List First + Collapsible Create + Persistent Pins (2026-03-03)
- [x] Add per-user project pin model in Prisma (`UserPinnedProject`) with migration and relations.
- [x] Extend `GET /projects` payload with `createdAt` and `isPinned`.
- [x] Add `POST /projects/:projectId/pin` and `DELETE /projects/:projectId/pin` endpoints with read-access checks and audit logs.
- [x] Add backend unit tests for project list mapping and pin/unpin idempotent behavior.
- [x] Refactor `/projects` UI to remove demo metrics and make project list the main content.
- [x] Add `New project` collapsible creation panel (reader blocked for create).
- [x] Add `Order by` selector (`Newest`, `Key`, `Name`) with final ordering rule: pinned first, then selected comparator.
- [x] Add pin/unpin actions in project list cards and refresh list from backend state.
- [x] Add dedicated Projects page styles for toolbar, list actions, and pinned badge.
- [x] Validate with `pnpm --filter @doctoral/db db:generate`, `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/web build`.

## Project Home vNext - Real Dashboard (2026-03-03)
- [x] Replace generic `/projects/:projectId` cards with a dashboard showing real project activity.
- [x] Add Recent Documents widget (top 5 by `updatedAt`) with direct navigation to each document detail.
- [x] Add current month Meetings calendar widget (Monday-first, highlighted days with minutes, today/muted states).
- [x] Make calendar days clickable to open Meetings with deep-link query (`view=calendar`, `date`, `month`).
- [x] Add Tasks in Progress widget (top 6 by `updatedAt`, fallback `createdAt`) with assignee/priority/due metadata.
- [x] Add module CTA links (`Open documents`, `Open meetings`, `Open tasks board`) in each widget.
- [x] Add robust empty states and non-blocking error state for dashboard data loading.
- [x] Extend Meetings page to accept query params (`view`, `date`, `month`) and initialize calendar accordingly.
- [x] Add dedicated dashboard styles and responsive behavior (desktop 2-col + full-width meetings row, stacked on tablet/mobile).
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Branding vNext - WorkMesh + Project Header Cleanup (2026-03-03)
- [x] Remove demo-like suffix from `Project overview` subtitle and keep only `KEY - Name`.
- [x] Update sidebar brand text from `Doctoral OS` to `WorkMesh`.
- [x] Update global app metadata title to `WorkMesh` and align description branding.
- [x] Keep existing brand subtitle `Collaboration Workspace`.
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Documents vNext - PDF-First Entry + On-Demand Editor (2026-03-03)
- [x] Default document detail to PDF-only view on open.
- [x] Add explicit `Edit` toggle to open/close left LaTeX editor pane.
- [x] Trigger auto-compile once when opening a document with LaTeX sources.
- [x] Reorganize topbar actions for clear preview-first workflow.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Documents vNext - Viewer Controls + Preview-Only Polish (2026-03-03)
- [x] Move `Show tree` control from topbar to editor toolbar next to `Show log`, `Save`, and `Compile`.
- [x] Ensure editor-closed mode renders PDF preview as full-width/fill-height workspace panel.
- [x] Remove persistent `PDF rendered.` status message and keep viewer status only for loading/error states.
- [x] Add contextual PDF zoom inside viewer (`Ctrl/Cmd+wheel`, `Ctrl/Cmd +`, `Ctrl/Cmd -`, `Ctrl/Cmd 0`) without affecting page-level zoom outside iframe.
- [x] Regenerate self-hosted PDF viewer assets via `pnpm --filter @doctoral/web pdfjs:sync`.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Wiki vNext - Knowledge Hub Real (2026-03-03)
- [x] Finalize backend Wiki routes (`tree`, `by-path`, `draft`, `publish`, `backlinks`, `assets` upload/stream) while keeping legacy `PUT /wiki-pages/:id`.
- [x] Add backend Wiki service tests for path uniqueness, draft conflict (`409`), publish flow, reader visibility, and asset validation.
- [x] Implement frontend Wiki client SDK (`apps/web/lib/wiki.ts`) for tree/page/draft/publish/backlinks/assets.
- [x] Replace static `/projects/:projectId/wiki` with real hub UI (tree + search + new page + read/edit + live preview).
- [x] Add canonical deep-link route `/projects/:projectId/wiki/[...wikiPath]`.
- [x] Add image upload insertion, internal `[[path]]` links visibility, and conflict UX actions (`Reload draft`, `Copy local`, `Retry`).
- [x] Add Wiki styles in `globals.css` with responsive split layout.
- [x] Validate with `pnpm --filter @doctoral/db db:generate`, `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

## Wiki vNext - Math + Full-text Search (2026-03-03)
- [x] Add KaTeX markdown rendering in wiki read view and live preview (`remark-math` + `rehype-katex` + global KaTeX CSS).
- [x] Add `GET /projects/:projectId/wiki-pages/search?q=&limit=` endpoint with project-scoped PostgreSQL full-text ranking.
- [x] Enforce role-aware scope in search (reader: published only; editor/admin: published + draft).
- [x] Add backend tests for search behavior (reader/editor scope, short query validation, mapping).
- [x] Replace sidebar client filter with API-backed search results panel (debounced) and clear tree fallback when query is empty.
- [x] Add UI match badges and snippets for search results, with navigation to selected wiki path.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

## Navigation UX vNext - Contextual Overview + Exit Project (2026-03-04)
- [x] Change project-context sidebar first item from `Projects` to `Overview` (`/projects/:projectId`).
- [x] Add explicit `Exit project` control in sidebar for project-context pages.
- [x] Add optional `AppShell` exit hook (`onExitProjectRequest`) with cancelable navigation.
- [x] Wire unsaved-changes guard on exit in Wiki (draft dirty state).
- [x] Wire unsaved-changes guard on exit in Documents detail (loaded/saved LaTeX baseline comparison).
- [x] Add responsive sidebar footer styles so `Exit project` stays visible on desktop and mobile.
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Navigation UX vNext - Reusable Unsaved Changes Guard Hook (2026-03-04)
- [x] Add shared frontend hook `useUnsavedChangesGuard` for `Exit project` confirmation and browser `beforeunload`.
- [x] Replace local unsaved-exit confirmation logic in Wiki with the shared hook.
- [x] Replace local unsaved-exit confirmation logic in Documents detail with the shared hook.
- [x] Keep `AppShell` `onExitProjectRequest` contract unchanged and feed it from the shared hook.
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Sidebar Branding vNext - Project KEY Context (2026-03-04)
- [x] Remove sidebar subtitle copy `Collaboration Workspace`.
- [x] Resolve sidebar brand title dynamically to `project.key` when `projectId` context exists.
- [x] Keep `WorkMesh` as fallback brand outside project context and on fetch/auth errors.
- [x] Apply minimal brand typography/spacing adjustments after subtitle removal.
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Documents UX vNext - Closed Reading Mode Comfort (2026-03-04)
- [x] Make PDF viewer zoom mode contextual: editor open => `page-width`, editor closed => `page-fit`.
- [x] Wrap closed-mode preview in centered container with constrained max width (`1200px`).
- [x] Keep edit-mode split layout and splitter behavior unchanged.
- [x] Keep mobile closed preview full-width (`max-width: 100%`) for usability.
- [x] Validate with `pnpm --filter @doctoral/web build` and `pnpm --filter @doctoral/api build`.

## Meetings UX vNext - Modal Editor + Hierarchical Markdown Lists (2026-03-04)
- [x] Replace inline meetings form drawer with centered modal editor (create/edit) and explicit save flow.
- [x] Add natural list editing behavior in minute textareas (`Enter` sibling/exit, `Tab` indent, `Shift+Tab` outdent).
- [x] Seed create-mode `Done / To discuss / To do` fields with default bullet marker (`- `) while keeping edit fallback for empty legacy content.
- [x] Replace snippet previews with real Markdown rendering for minute sections in list and calendar side panel.
- [x] Add modal + markdown section styles in `globals.css` with desktop/mobile responsive behavior.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Atlasium Go-Live Prep (2026-03-04)
- [x] Update infrastructure naming from `doctoral-platform` paths to `atlasium` paths in docs/scripts.
- [x] Add production-ready Nginx template for `atlasium.info` + `www` redirect + `/api` reverse proxy.
- [x] Add explicit go-live runbook (`infra/GO_LIVE_ATLASIUM.md`) with bootstrap, deploy, migrations, TLS, and rollback.
- [x] Align Docker setup to mount storage at `/var/lib/atlasium/storage` in API/worker containers.
- [x] Add web build arg wiring for `NEXT_PUBLIC_API_BASE_URL` and document production value `/api`.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Atlasium Go-Live Fix - Docker `tsc` missing in worker/api build (2026-03-04)
- [x] Fix monorepo Docker multi-stage build by reinstalling filtered dependencies in build stages for `api`, `worker`, and `web`.
- [x] Remove deployment blocker where `pnpm --filter @doctoral/worker build` failed with `sh: tsc: not found`.
- [x] Validate with local image build checks (`docker compose build worker api web`) and web build.

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
- 2026-02-23: Upgraded document editor to Monaco with VS Code-like shortcuts, persistent font zoom, and bidirectional editor↔PDF word highlighting through a secure same-origin postMessage bridge.
- 2026-03-03: Refocused `/projects` to production workflow (list-first layout, collapsible create flow, per-user persistent pins, and configurable client-side ordering with pinned priority).
- 2026-03-03: Replaced project home placeholder cards with a real dashboard (recent documents, current-month meetings calendar with deep-linking, and in-progress tasks summary).
- 2026-03-03: Completed branding cleanup by renaming UI metadata/brand to `WorkMesh` and removing demo-style copy from the project overview subtitle.
- 2026-03-03: Updated document detail to preview-first UX (PDF-only on entry), added explicit `Edit` toggle for the left LaTeX pane, and auto-compile on first load per version.
- 2026-03-03: Moved tree toggle into editor toolbar, made closed-editor preview panel full-width, and upgraded PDF viewer behavior (loading/error-only status + contextual zoom controls inside iframe).
- 2026-03-03: Implemented Wiki vNext knowledge hub with hierarchical tree navigation, canonical deep-links, shared drafts with optimistic conflict handling, explicit publish flow, internal links/backlinks, and authenticated wiki image uploads/rendering.
- 2026-03-03: Added wiki math rendering with KaTeX and switched wiki search to backend full-text results with role-aware draft visibility.
- 2026-03-04: Updated project-context navigation to `Overview` + `Exit project` and added unsaved-change exit guards for Wiki and Documents editor workflows.
- 2026-03-04: Extracted a reusable unsaved-changes guard hook and enabled `beforeunload` protection for dirty Wiki/Documents states.
- 2026-03-04: Updated sidebar branding to show project `KEY` in project context, removed `Collaboration Workspace`, and kept `WorkMesh` fallback outside project scope.
- 2026-03-04: Tuned document detail closed mode for readability by centering preview with max-width and switching initial PDF zoom to `page-fit` outside editor mode.
- 2026-03-04: Reworked Meetings editing UX to a centered modal and added natural hierarchical Markdown list behavior with real rendered section output in list/calendar views.
- 2026-03-04: Added Atlasium production deployment prep: updated infra naming/paths, added `atlasium.info` nginx template, created go-live runbook, and aligned container storage/API-base env wiring for direct-VPS HTTPS setup.
- 2026-03-04: Fixed deployment-time Docker build failure (`tsc: not found`) by ensuring PNPM filtered dependencies are installed during each build stage in monorepo Dockerfiles.
