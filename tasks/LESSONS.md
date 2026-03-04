# Lessons Learned

## Environment loading
- Do not assume users will `source .env` in every new shell before running `pnpm dev`.
- For runtime-critical variables (e.g., `DATABASE_URL` for Prisma), load `.env` programmatically at process startup.
- Apply the same env-loading pattern to all entrypoints (`api main`, `worker main`, and maintenance scripts like `seed-admin`) to avoid inconsistent behavior.

## Project navigation
- Do not hardcode placeholder project identifiers (e.g., `demo`) in production navigation links.
- Shared layout components must receive active route context (like `projectId`) so links target real resources.
- When a route depends on project context, hide or disable those links outside project-scoped pages.

## UI consistency
- When fixing a user-facing label issue in one project tab, apply the same fix across equivalent tabs to avoid inconsistent UX.
- Prefer shared UI components for repeated project-context text (e.g., project header subtitle) to prevent drift.
- Keep action button labels concise; do not append keyboard shortcut hints in the visible label unless explicitly requested.

## Tasks UX defaults
- Task boards should prioritize reading state first: keep create/edit forms collapsed by default and open them explicitly via actions like `New task` or `Edit`.
- For task actions, always provide both desktop and accessible paths (`right-click` context menu plus visible button trigger) so mobile and non-mouse workflows are covered.
- When exposing assignee in cards, keep API and UI aligned with both `assigneeId` (compatibility) and denormalized assignee identity (`name`, `email`) for immediate clarity.

## Local runtime verification
- If a newly added endpoint returns `Cannot <METHOD> /...` but code contains the route, first check for stale Node processes occupying the API port (`ss -ltnp | rg :4000`) before changing backend code.
- Always verify route registration in Nest startup logs and confirm behavior with a direct `curl` call (`401` without token is expected for guarded routes; `404` indicates route missing or wrong process).

## Design system rollout
- For full visual redesigns, start by centralizing tokens and component primitives in `globals.css`; then migrate pages to those primitives and remove inline styles to keep consistency.
- Keep behavior untouched while redesigning: visual changes should not alter API contracts or business flows, and validation must include a production build after refactor.

## API boundary normalization
- When backend endpoints may return enum values with different casing (e.g. Prisma enums vs API-friendly lowercase), normalize values in frontend API helpers before UI state logic consumes them.
- Keep normalization in one place (`lib/*` fetch helpers) instead of scattering case handling across components.

## Workspace-first editor UX
- For technical document editors, avoid stacking file tree above editor on desktop; use a persistent lateral tree (VSCode-like) and reserve vertical space for the code and preview panes.
- When adding keyboard shortcuts, include both `Ctrl` and `Cmd` variants and persist key layout preferences (e.g., tree collapsed state) so users keep a stable workspace across reloads.

## Shared storage path consistency
- Never rely on a relative `STORAGE_ROOT` interpreted from each package cwd in a monorepo: API and worker may resolve different directories and break compile/file workflows.
- Normalize relative storage paths to a shared absolute path at env-load time (using the selected `.env` directory as anchor), with compatibility fallback to existing initialized storage folders.

## Document editor density
- In split editor/preview workspaces, keep non-critical chrome minimal: avoid redundant pane headings when context is already obvious.
- Compile logs should default collapsed and be explicitly toggled to preserve editing/preview focus; auto-open only on compile failures/timeouts.
- Reading mode and editing mode should not share the same width/zoom policy; closed preview benefits from constrained width and `page-fit`, while open split preview remains effective with `page-width`.

## PDF preview determinism
- Browser-native PDF viewers inside `iframe` are not reliable for enforcing initial zoom on `blob:` URLs; `#zoom=page-width` may be ignored depending on engine.
- For deterministic default zoom and consistent behavior, use a self-hosted PDF.js viewer endpoint and control rendering/zoom policy explicitly.
- When implementing resizable splitters, avoid relying only on pointer capture on a tiny separator; global `window` pointer listeners during drag are more robust across browsers/input devices.
- Keyboard shortcuts must be contextual across parent page and iframe: capture `Ctrl/Cmd+S` in the PDF viewer itself to prevent default browser “save webpage” behavior and trigger PDF download instead.
- For editor/PDF split views with iframes, use an Overleaf-style wide invisible drag handle and a temporary fullscreen drag scrim while resizing; this prevents pointer loss when crossing iframe boundaries.
- Do not mutate splitter width on `pointerdown`; initialize drag from the rendered pane width and apply width changes only on actual pointer movement to avoid click-only jumps.
- For editor↔PDF interactions, use a same-origin `postMessage` contract with explicit `type` payloads and strict origin checks in both parent and iframe.
- For reliable PDF word-level interactions, render PDF.js text layers (not just canvas) and implement highlight/scroll behavior over text spans instead of trying to map canvas pixels.
- For PDF zoom UX, intercept `Ctrl/Cmd+wheel` and `Ctrl/Cmd +/-/0` inside the iframe viewer itself; never bind these globally in the parent page or you risk hijacking browser page zoom.

## Monaco integration
- In Monaco-based editors, keep business shortcuts (`save+compile`, tree toggle) wired via editor actions so focus context is respected and browser defaults do not leak in.
- Persist editor-only zoom (`Ctrl/Cmd +`, `Ctrl/Cmd -`, `Ctrl/Cmd 0`) in localStorage to avoid changing global page zoom while preserving user preferences.

## Day-only scheduling
- For date-first workflows (minutes/meetings), normalize day-only input to a stable UTC noon timestamp before persistence to avoid timezone drift in UI rendering.
- Expose an explicit `scheduledDate` (`YYYY-MM-DD`) in API responses so list/calendar grouping does not depend on client timezone conversions.

## Minutes content structure
- For meeting minutes workflows, model sections explicitly (`done`, `toDiscuss`, `toDo`) instead of overloading generic `agenda/notes`; this keeps API, UI labels, and future automation aligned.
- When using plain Markdown textareas, provide lightweight editing affordances (toolbar + `Tab`/`Shift+Tab` indent behavior) so users can create nested lists without introducing heavy editor dependencies.
- In dense monthly calendars, prefer presence indicators (highlight + dot) over per-cell counters to reduce visual noise while keeping exact counts available via accessible labels.
- For long-form minute editing, a modal-focused editor with explicit save is clearer than inline drawers, and Markdown should be rendered in read views (not flattened snippets) to preserve hierarchy.

## Projects workspace focus
- The `/projects` landing view should prioritize actionable content (project directory) over dashboard-like demo metrics.
- Keep project creation secondary and collapsible behind explicit intent (`New project`) so returning users land directly on navigation/work items.
- Treat pins as per-user preferences in backend storage, not shared project metadata, to avoid coupling personal ordering with team-visible domain data.
- In project-context pages, keep navigation contextual (`Overview`, module tabs) and separate global workspace navigation into an explicit `Exit project` action.
- Centralize unsaved-change guards in a reusable hook (instead of per-page `window.confirm` duplication) so `Exit project` and `beforeunload` stay behaviorally consistent across modules.

## Project home dashboard
- The `/projects/:projectId` landing page should surface live, cross-module signals (recent documents, in-progress tasks, current-month meetings) rather than static module descriptions.
- Reuse existing module data contracts in dashboard widgets instead of introducing one-off backend endpoints until aggregation/performance needs justify it.
- When a dashboard widget links into a module with preselected state, pass explicit query params (`view`, `date`, `month`) and make the target page initialize from them defensively.

## Wiki knowledge hub
- When APIs use bearer-token auth, markdown `<img src="/api/...">` links will not automatically include auth headers; render protected images through an authenticated fetch-to-blob component instead of plain image tags.
- For collaborative wiki editing, keep draft writes optimistic (`baseDraftVersion`) and expose explicit conflict actions (`reload`, `copy local`, `retry`) in UI rather than silently overwriting shared drafts.
- For markdown math in a ReactMarkdown pipeline, add `remark-math` + `rehype-katex` and load KaTeX CSS globally; `remark-gfm` alone does not render `$$...$$`.
- For wiki search at project scope, backend full-text (`websearch_to_tsquery` + `ts_rank_cd`) gives better relevance than client title/path filtering, and role checks must gate draft content visibility.

## Branding consistency
- Avoid demo-like descriptive copy in production headers; project headers should prioritize concise identity context (e.g., `KEY - Name`) over marketing text.
- Keep product naming aligned across visible UI brand labels and metadata title to avoid split identity between sidebar and browser tab.
- In project-scoped navigation, the sidebar brand can switch from global product name to operational project identifier (`project.key`) while preserving a stable fallback (`WorkMesh`) when context/token fetch fails.
- Keep deployment naming consistent end-to-end (`/opt/<brand>`, `/var/lib/<brand>/storage`, nginx site name) to avoid mixed legacy identifiers during infrastructure migration.

## Monorepo Docker builds
- In multi-stage Dockerfiles for PNPM workspaces, do not assume copying only root `node_modules` is enough for build scripts; ensure filtered dependencies are installed in the build stage before running `pnpm --filter <pkg> build` to avoid missing local binaries like `tsc`.
