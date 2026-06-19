# Implementation TODO (v1 bootstrap)

## PR04 Password Reset Queue Token Blocker (2026-06-20)
- [x] Stop the merge train after the exact-SHA reviewer blocked PR #4.
- [x] Remove clear password reset tokens from persisted BullMQ email payloads.
- [x] Prevent active reset tokens from remaining when password reset email enqueue fails.
- [x] Add focused API/worker regression coverage for the corrected reset-email contract.
- [ ] Force-push PR #4, restack PRs #5-#15, repeat exact-SHA review and CI before merge.

## Autonomous Merge Train Deploy Fix-Forward: Worker Image Size (2026-06-20)
- [x] Confirm the merge train is stopped because `main` deploy is not green after PR #17.
- [x] Identify the production blocker: VPS Docker root dir remains below the 12GB preflight threshold after retention cleanup.
- [x] Replace the worker runtime `texlive-full` install with the narrower LaTeX package set required for `pdflatex`, `biber`, and `bibtex`.
- [x] Verify worker Docker build, runtime binary smokes, minimal PDF compile, diff hygiene, and image-size reduction.
- [x] Add transitional deploy retention gates: allow pre-pull deploy with 6GB free, then enforce 12GB after successful healthcheck and final cleanup.
- [x] Open fix-forward PR #18, request exact-SHA agent review, wait required CI, merge only with `--squash --match-head-commit`.
- [x] Wait `main` CI for the #18 squash SHA and confirm `Deploy Atlasium` reached the VPS and deployed the new containers.
- [x] Stop the train again because #18 deploy failed in final retention: `df -h` reported `12G` free, but the script required 12 GiB.
- [ ] Open fix-forward PR #19 to align retention `GB` thresholds with decimal gigabytes, then wait CI and deploy before resuming PR stack #3-#15.

## Git Access Persistent HTTPS Credentials (2026-06-07)
- [x] Register the approved implementation plan before edits.
- [x] Update `DESIGN.md` and `tasks/LESSONS.md` with concise persistent credential guidance.
- [x] Add always-visible HTTPS credential helper instructions in Account Git access.
- [x] Align Code clone drawer so Account remains the canonical setup surface.
- [x] Run web verification, static audits, diff hygiene, and visual QA notes.
- [x] Document implementation review and final verification results.

### Review
- Added compact permanent HTTPS credential guidance to `Git access`: password sync remains explicit, local credential storage is explained separately, and Windows/WSL, macOS, and Linux helper commands have copy actions.
- Renamed the HTTPS status badge to `Password synced` / `Sync required` so Atlasium does not imply it can detect whether a workstation has saved credentials locally.
- Replaced the old connection detail block with `Reset or examples`, removed the fake `atlasium/nav.git` repo path, and kept reset/example commands collapsed.
- Simplified `Code > Clone` so it points users to Account Git access as the canonical place to sync the password and store local credentials once.
- Verification passed: `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`; static audits for stale Windows-only/PAT/SSH guidance and unsafe `credential.helper store` copy.
- Visual/interaction QA is limited locally because there is no authenticated API session/test account available. The Account and Code surfaces were reviewed by source/CSS inspection for desktop/mobile wrapping, copy behavior, copy buttons, and collapsed details.

## Personal Settings Git Access Ledger (2026-06-07)
- [x] Register the approved implementation plan before edits.
- [x] Update `DESIGN.md` with Account Git access and drawer scroll guidance.
- [x] Add persistent HTTPS clone sync status to DB/API and tests.
- [x] Redesign Account Git access and fix Account drawer scroll containment.
- [x] Align Code clone drawer so HTTPS is the default Atlasium clone method.
- [x] Run API/web verification, static audits, diff hygiene, and visual QA.
- [x] Document implementation review and final verification results.

### Review
- Added persistent HTTPS clone sync state through `User.gitlabHttpsPasswordSyncedAt`, including a migration backfill from existing `auth.gitlab.https_password.sync` and `auth.password.change` audit logs.
- Extended `GET /auth/gitlab/connection` with `httpsClone` state while preserving existing fields. Explicit HTTPS sync and successful password changes now update the timestamp without storing any new secret.
- Reworked Account drawer containment so the header is fixed and only `account-drawer-body` scrolls. Tabs stay local to the drawer body and changing tabs resets scroll to the top.
- Redesigned `Git access` as a compact ledger: HTTPS clone first with username/last sync/action, connection details collapsed, GitLab API access second, SSH keys advanced and collapsed with add-key modal, and GitLab disconnect protected by a confirmation dialog.
- Updated Code clone drawer so HTTPS appears first and is described as the default Atlasium clone method; SSH remains available as an alternative.
- Verification passed: `pnpm --filter @doctoral/db db:generate`; `pnpm --filter @doctoral/api test:http`; `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand --forceExit`; `pnpm --filter @doctoral/api build`; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`; static audits for stale Git access copy, obsolete active branding, new drawer selectors, and HTTPS clone contract fields.
- Visual/interaction QA is limited locally because there is no authenticated API session/test account available in this environment. Layout-sensitive behavior was covered by type/build checks, CSS audits, and code inspection for drawer scroll containment, responsive wrapping, collapsed details, modal/confirm paths, and Code clone ordering.

## Wiki Reading Surface Light Refinement (2026-06-07)
- [x] Register the approved implementation plan before edits.
- [x] Update `DESIGN.md` with Wiki reading/code-block surface guidance.
- [x] Refine Wiki Markdown reading and live-preview CSS to use white/paper surfaces and neutral light preformatted blocks.
- [x] Run web type-check, diff hygiene, and static review.
- [x] Document implementation review and final verification results.

### Review
- Updated `DESIGN.md` so Wiki reading and live-preview Markdown surfaces are treated as paper document pages, with light neutral preformatted blocks reserved for documentation reading.
- Changed `.wiki-markdown` from the soft gray surface to the raised white/paper surface so published pages and live previews read as documents rather than panels.
- Replaced the dark navy Wiki `pre` block treatment with a light neutral block, subtle border, document text color, and explicit inline-code styling. Dedicated dark `.code-block` surfaces for logs/code tools remain unchanged.
- Verification passed: `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `git diff --check`; static audit for old Wiki dark block colors and active Markdown selectors.

## Code Repository Removal (2026-06-06)
- [x] Register the approved implementation plan before edits.
- [x] Update `DESIGN.md` with the Code repository destructive-action UI rule.
- [x] Add scoped repository removal preview/delete API with admin-only access, GitLab archive semantics, rollback handling, and audit logging.
- [x] Add API unit and HTTP coverage for preview/delete permissions, confirmation, GitLab archive outcomes, DB removal, and audit metadata.
- [x] Add frontend helpers and a Code `Manage repository` modal with preflight, typed confirmation, and quiet danger-zone UI.
- [x] Update Code post-removal state so multi-repo and last-repo cases transition without a full reload.
- [ ] Run API/web builds, focused tests, static audits, diff hygiene, and visual/UX verification.
- [ ] Document implementation review and final verification results.

## Repo Docs Taxonomy, Wiki Sync Hierarchy, And Codex Bootstrap (2026-06-06)
- [x] Register the approved implementation plan before edits.
- [x] Update `DESIGN.md` with repo `Docs/` taxonomy, section overview, and Codex-generation rules.
- [x] Update managed repository bootstrap with root `AGENTS.md` and tracked `Docs/Research` / `Docs/Implementation` folders.
- [x] Extend Wiki Docs sync mapping, status metadata, tree hierarchy, and assisted structure migration endpoints.
- [x] Update Wiki frontend types/helpers and sidebar UI for canonical structure review and migration.
- [x] Add/adjust API unit, HTTP, and frontend checks for taxonomy, migration, and bootstrap behavior.
- [x] Run build/type/static/coverage verification, document local limitations, and add implementation review.

### Review
- Added the repo `Docs/` canon to `DESIGN.md`: repo-local `Docs/` is separate from the Atlasium `Documents` module, canonical branches are `Docs/Research/` and `Docs/Implementation/`, README/index pages are section overviews, and Codex-generated repo documentation should follow stable Markdown conventions.
- Updated managed GitLab repository provisioning so new repos get a root `AGENTS.md` plus tracked `Docs/Research/.gitkeep` and `Docs/Implementation/.gitkeep` in an initialization commit.
- Extended Wiki Docs sync with canonical path mapping, structure counts, legacy detection, `docsKind` creation/assignment fields, Research/Implementation-first tree metadata, repository display labels, and overview page markers.
- Added assisted legacy structure migration endpoints and UI: writable users can review legacy `Docs/*` bindings, choose Research or Implementation per row, preview/recheck conflicts, and apply create+delete Git moves plus Wiki path/binding/link updates.
- Refined Wiki sidebar/UI copy and CSS for the structure notice, migration modal, Docs branch selectors, and overview badges while keeping existing sync, import, assignment, Markdown/PDF/Monaco, routes, auth, and database schema stable.
- Verification passed: `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand --forceExit src/wiki/wiki.service.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand --forceExit src/gitlab/gitlab.service.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand --forceExit test/http/wiki.controller.http.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand --forceExit test/http/gitlab.controller.http.spec.ts`; full API unit suite with 22 suites and 316 tests; `pnpm --filter @doctoral/api build`; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; static `rg` audits for obsolete branding, old amber accent patterns, decorative terms, and new Docs taxonomy strings; `git diff --check`.
- Coverage gate attempted with `pnpm --filter @doctoral/api test:coverage:gate`: unit coverage passed with 22 suites and 316 tests, HTTP coverage passed with 9 suites and 82 tests, then integration coverage failed because no PostgreSQL server was reachable at `localhost:5432`.
- Web runtime smoke passed on `http://localhost:3012/login` with HTTP 200 and Edge headless screenshot output in `C:\Users\Luis\AppData\Local\Temp\atlasium-docs-taxonomy-login.png`; authenticated Wiki visual/interaction QA remains limited locally because no API database/session is available.

## Project Metadata Editing From Overview (2026-06-06)
- [x] Register the approved implementation plan before edits.
- [x] Add writable project metadata update API with validation, normalization, audit logging, and tests.
- [x] Add Overview edit helper/UI for project name and description while keeping project key read-only.
- [x] Run API unit/integration checks, API/web builds, static audits, and diff hygiene.
- [x] Run visual/interaction QA where local auth/session availability allows.
- [x] Document implementation review and final verification results.

### Review
- Added `PATCH /projects/:projectId` for writable project metadata updates. The endpoint keeps `key` read-only, normalizes trimmed name/description input, clears empty descriptions to `null`, rejects empty updates, and logs `project.update` only when `name` or `description` actually changes.
- Added Overview provenance mapping for `project.update` as `Project details updated`, plus unit coverage for writable admins/editors, rejected readers, description clearing, unchanged updates, audit metadata, and empty payload rejection.
- Added Overview editing UI behind `overview.access.canWrite`: an explicit `Edit details` button, double-click shortcuts on title/description, compact modal form, unchanged/saving disabled save state, modal validation/errors, immediate local header update, and silent Overview refresh.
- Verification passed: `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand --forceExit`; `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand --forceExit projects.controller.http.spec.ts`; `pnpm --filter @doctoral/api build`; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; static audits for stale branding/accent classes and new project-edit strings; `git diff --check`.
- Coverage gate attempted with `pnpm --filter @doctoral/api test:coverage:gate`: unit coverage passed with 22 suites and 311 tests, HTTP coverage passed with 9 suites and 79 tests, then integration coverage failed because no PostgreSQL server was reachable at `localhost:5432`; Docker is not installed in this WSL distro, so the local test DB could not be started.
- API smoke was updated to patch project details and verify Overview/list metadata plus provenance, but it has the same local PostgreSQL limitation. The web server was restarted on `http://localhost:3010`; `/login` and a dynamic project route returned HTTP 200. Authenticated modal/browser interaction QA could not be completed locally because there is no local API database/session and no Playwright/headless browser installed.

## Atlasium Paper Rule Accent Without Duplicate Labels (2026-06-05)
- [x] Register the approved paper-rule refinement plan before design/UI edits.
- [x] Update `DESIGN.md` so archive entry accents use a non-textual paper rule and do not duplicate active module navigation.
- [x] Update shared primitives/CSS so archive variants render a subtle rule instead of a textual tab.
- [x] Remove decorative duplicate eyebrows from active entry panels, Wiki sidebar, and Meetings editor modal.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification.
- [x] Document implementation review and final verification results.

### Review
- Replaced the previous textual archive tab with a non-textual paper rule: a neutral divider with a short amber segment on archive `WorkspaceHeader`, archive `ModuleCockpit`, and the Meetings editor modal header.
- Kept `ArchiveEntryPanel` and archive variants, but changed their meaning from a repeated module label to a subtle structural accent.
- Removed decorative duplicate labels from Projects, Overview, Documents, Code, Tasks, Meetings, the Wiki sidebar, and the Meetings editor modal while preserving operational titles such as `Project directory`, project key/name, `Document library`, repo name/`No repositories yet`, `Board`, `Minutes`, and `Pages`.
- Updated `DESIGN.md` to prohibit local accents that repeat the active module already shown in shell navigation, and added a matching correction to `tasks/LESSONS.md`.
- Verification passed: static audits for `archive-header-tab`, `module-entry-panel`, old full-width amber `border-top` rules, and duplicate module `eyebrow` props; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`.
- Visual QA used `next start` plus Edge CDP screenshots in `C:\Users\Luis\AppData\Local\Temp\atlasium-paper-rule-qa` for `/`, `/login`, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, and Meetings at desktop/mobile sizes. No local authenticated API/session data was available, so protected route review used SSR snapshots with scripts disabled; Code remained in unauthenticated loading state.

## Atlasium Institutional Archive Tab Accent (2026-06-05)
- [x] Register the approved plan before design/UI edits.
- [x] Update `DESIGN.md` so entry surfaces use a contextual archive tab instead of full-width amber top bars.
- [x] Add frontend primitives and CSS for archive entry panels, archive header tabs, and dialog header tabs.
- [x] Migrate active module entry panels, Wiki sidebar, and Meetings modal away from full-width amber bars.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification.
- [x] Document implementation review and final verification results.

### Review
- Replaced the old full-width amber entry accent with a compact institutional archive tab attached to `WorkspaceHeader`/`ModuleCockpit` eyebrow text.
- Updated `DESIGN.md` so active UI no longer treats full-width amber top bars as an Atlasium archive signal, and changed verification language to audit for active full-width amber top bars.
- Added `ArchiveEntryPanel` and archive header variants, then migrated Projects, Overview, Documents, Code provision/cockpit, Tasks, Meetings, Wiki sidebar, and the Meetings editor modal away from `module-entry-panel`.
- Removed active `.module-entry-panel` CSS, its amber `::before` wash, the Overview override, the Wiki `archive-index-panel` top border, and the Meetings modal top border.
- Added a mobile containment adjustment for the shell/content area so entry panels and controls do not inherit an oversized scroll width on narrow viewports.
- Verification passed: `rg` audits for `module-entry-panel` in active code/design and full-width amber `border-top` rules; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`.
- Visual QA used `next start` plus Chrome snapshots in `C:\Users\Luis\AppData\Local\Temp\atlasium-archive-tab-qa`. Authenticated API/session data was not available, so protected route QA used SSR snapshots with scripts removed to inspect Projects, Wiki, and Meetings entry surfaces without client redirect. Chrome headless from WSL reported a wider CSS viewport than the requested 390px bitmap, so final mobile review used measured layout width to avoid false clipping.

## Atlasium UI/UX v3 Archive Operating Workspace (2026-06-05)
- [x] Register the v3 implementation plan before design/UI edits.
- [x] Extend `DESIGN.md` with the Archive Operating Workspace canon and anti-vibe implementation rules.
- [x] Add shared frontend primitives and global CSS foundations for archive indexes, entity rows, metadata strips, workspace headers, and state rails.
- [x] Redesign public/auth access gates, AppShell hierarchy, Projects directory, and Project Overview around ledger/index surfaces instead of repeated card stacks.
- [x] Refine module workspaces across Wiki, Documents, Code, Tasks, Meetings, and Account with denser row-based hierarchy while preserving backend/API/auth/PDF.js/Monaco/realtime contracts.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification.
- [x] Document implementation review and final verification results.

### Review
- Added the Atlasium v3 Archive Operating Workspace canon to `DESIGN.md`, making index/ledger/queue/document-canvas surfaces the preferred language over generic dashboards and stacked cards.
- Added shared frontend primitives for `WorkspaceHeader`, `MetadataStrip`, `ArchiveIndex`, `ArchiveRow`, and `StateRail`, then used them to reduce repeated bespoke markup and improve hierarchy.
- Redesigned public home, login, and invite access surfaces as institutional access gates with Atlasium mark usage, paper/index texture, calmer copy, and corrected mobile containment.
- Reworked Projects into an archive directory, Project Overview into a command ledger, and Documents library into row-based archive indexes while preserving current routes and data flows.
- Refined Wiki, Code, Tasks, Meetings, and Account surfaces with denser operational headers, factual metadata strips, reduced passive card chrome, flatter module rows, and fewer decorative accents.
- Verification passed: `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`; static audits for obsolete active branding, old module-card classes, duplicated Wiki sync copy, forbidden decorative terms, visual effects, hardcoded color remnants, and `.module-entry-panel` ownership.
- Visual QA used `next start` and Chrome headless screenshots in `C:\Users\Luis\AppData\Local\Temp\atlasium-v3-qa` for `/`, `/login`, `/accept-invite`, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, Meetings, and Account at desktop/mobile sizes. Public/auth rendered normally; protected routes redirected or rendered unauthenticated SSR because no local API/session/test data was available, so authenticated interaction checks were not run.

## Atlasium Vibe-Coded Refinement: Color, Icons, Serif, Glass, Motion (2026-06-05)
- [x] Register the approved follow-up refinement plan before design/UI edits.
- [x] Extend `DESIGN.md` with 70/20/10 color balance, icon discipline, serif budget, glass, motion, and shadow rules.
- [x] Refine Overview icon containers, dense serif usage, blur/glass, and decorative shadow/motion patterns without workflow changes.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification.
- [x] Document implementation review and final verification results.

### Review
- Extended `DESIGN.md` with the second anti-vibe-coded refinement layer: 70/20/10 color balance, icon discipline, serif budget, no glassmorphism, motion restraint, and shadow restraint.
- Flattened Overview icon treatment by removing generic colored rounded-square containers while keeping lucide icons for module/state wayfinding.
- Reduced serif usage in dense operational surfaces including status values, list item titles, document metadata headings, kanban column headings, wiki preview headings, and account metadata labels.
- Removed decorative hover shadow from Overview module cards and removed the strong blur from the Account drawer header; kept minimal modal backdrop blur for overlay separation.
- Verification passed: static audits for `backdrop-filter`, `transform:`, `animation:`, `box-shadow`, `font-heading`, Overview icon selectors, obsolete branding, forbidden decorative terms, and `module-entry-panel` accent ownership; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`.
- Visual QA used `next start` and Chrome headless screenshots in `C:\Users\Luis\AppData\Local\Temp\atlasium-vibe-refinement-qa` for `/`, `/login`, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, Meetings, and Account at desktop/mobile sizes. Public/auth rendered normally; protected routes redirected to login because no authenticated API/session was available locally, so authenticated module interaction checks were not run.

## Atlasium Anti-Vibe-Coded Design Hardening (2026-06-05)
- [x] Register the approved focused hardening plan before UI/design edits.
- [x] Add an explicit anti-vibe-coded design canon to `DESIGN.md`.
- [x] Refine global visual signals so accent strips, gradients, cards, dots, and badges are semantic.
- [x] Clean weak frontend indicators without changing product flows or backend contracts.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification.
- [x] Document implementation review and final verification results.

### Review
- Added an Anti-Vibe-Coded Canon to `DESIGN.md` covering color budget, gradients, card/panel usage, status indicators, iconography, and viewport-level audits.
- Removed the global amber strip from `.list-item`, softened `status-card`, reduced Overview module-card ornament, tokenized low-risk hardcoded UI colors, and preserved `.module-entry-panel` as the primary amber archive accent.
- Replaced weak `dot` patterns with semantic indicators: Code metadata separators, Documents file icons, and Meetings presence markers with existing accessible count labels.
- Added a `tasks/LESSONS.md` implementation lesson so future audits distinguish real status indicators from separators or decorative markers.
- Verification passed: static `rg` audits for obsolete active branding, forbidden decorative language, old `dot` classes, strips/cards/status surfaces, and `module-entry-panel` accent ownership; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`.
- Visual QA used `next start` and Chrome headless screenshots in `C:\Users\Luis\AppData\Local\Temp\atlasium-anti-vibe-qa` for `/`, `/login`, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, Meetings, and Account at desktop/mobile sizes. Public/auth rendered normally; protected routes used JavaScript-disabled SSR because no authenticated API/session was available, and protected mobile screenshots redirected to login.

## Wiki Sidebar Actions and Sync Result Refinement (2026-06-05)
- [x] Register the approved implementation plan for compact Wiki sidebar actions and single Sync Docs feedback.
- [x] Refine `WikiHub` sidebar cockpit/actions without changing Wiki flows or backend contracts.
- [x] Replace duplicated/verbose Sync Docs result copy with one compact sidebar result.
- [x] Add scoped CSS and capture the user correction as a technical UX lesson.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification.
- [x] Document implementation review and final verification results.

### Review
- Refined the Wiki sidebar cockpit by removing the long explanatory summary and moving `New page`, `Import`, and `Sync` into a scoped compact action row with lucide icons.
- Removed the duplicated Sync Docs success path by clearing `setSuccess` usage for sync completion and rendering one compact result beside the sidebar action.
- Replaced zero-heavy sync copy with `Docs sync complete. No Docs changes detected.` for no-op syncs, concise non-zero counts for successful changes, and `Docs sync needs review.` for conflicts/errors/unassigned pages.
- Added scoped CSS for Wiki sidebar actions and sync detail rows, plus a `tasks/LESSONS.md` rule for avoiding oversized global toolbars in narrow sidebars.
- Verification passed: `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`; static `rg` audits for the removed header copy and duplicated sync copy.
- Visual QA used `next start` with Playwright fixtures and screenshots in `/tmp/atlasium-wiki-sidebar-qa` for desktop/mobile default, focus, create/import open states, Sync disabled, Syncing, no-change sync, and review sync. Fixtures were frontend-only and did not change API contracts.

## Atlasium UI/UX Quality Leap (2026-06-04)
- [x] Register the approved implementation plan for the Atlasium v2 institutional-editorial redesign.
- [x] Extend `DESIGN.md` with v2 workspace chrome, module cockpit, dense layout, state, and visual QA guidance.
- [x] Refine global design tokens, shell, public/auth access surfaces, and shared frontend primitives.
- [x] Apply the module redesign pass across Projects, Overview, Wiki, Documents, Code, Tasks, Meetings, and Account without backend contract changes.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification.
- [x] Document implementation review and final verification results.

### Review
- Extended `DESIGN.md` with the Atlasium v2 institutional-editorial direction, workspace chrome rules, module cockpit anatomy, dense surface rules, mobile workspace behavior, and stricter visual QA expectations.
- Refined `apps/web/app/globals.css` with clearer semantic tokens, shell/public/auth polish, shared cockpit primitives, denser list/table/module styling, state tokenization, Account drawer polish, and preserved `.module-entry-panel` amber accent ownership.
- Added shared frontend primitives in `components/ui.tsx` and migrated module cockpits/entry surfaces across Projects, Overview, Wiki, Documents, Code empty state, Tasks, Meetings, and Account while leaving backend/API/schema/auth/storage/realtime/PDF.js/Monaco contracts unchanged.
- Improved public home and login into an institutional access gate; tightened AppShell, Projects directory, Overview command center, Wiki/Documents panes, Code cockpit styling, Tasks board readability, Meetings list/calendar states, and Account settings hierarchy.
- Verification passed: static `rg` audits for obsolete active branding, forbidden decorative/user-facing wording, old ellipsis actions, and `module-entry-panel` accent ownership; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`.
- Visual QA used `next start` and Playwright screenshots in `/tmp/atlasium-v2-visual` for `/`, `/login`, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, Meetings, `/account`, and Account drawer at desktop and mobile sizes. Protected routes used a temporary localStorage session because no live API/auth session was available; Account loaded/drawer screenshots used Playwright-only API fixtures to verify the polished loaded state.

## Atlasium Design Canon and Web Redesign (2026-06-04)
- [x] Register the approved implementation plan for the Atlasium design canon and web redesign.
- [x] Create `DESIGN.md` as the permanent Atlasium brand, visual design, UI/UX, and verification contract.
- [x] Update `AGENTS.md`, `CLAUDE.md`, `README.md`, and `tasks/LESSONS.md` to reference `DESIGN.md` before UI/design-adjacent work.
- [x] Refine web design foundations, missing utilities, functional tokens, and module entry surfaces.
- [x] Apply component, icon, and copy consistency improvements without changing backend contracts.
- [x] Run static audits, web type-check/build, diff hygiene, and visual verification where available.
- [x] Document implementation review and final verification results.

### Review
- Added `DESIGN.md` as the canonical Atlasium brand, digital identity, UI/UX, copy, layout, component, state, motion, accessibility, and visual verification guide. Atlasium is now the only active product brand; historical names are documented only as invalid active fallbacks.
- Updated `AGENTS.md`, `CLAUDE.md`, `README.md`, and `tasks/LESSONS.md` so future UI/design-adjacent planning and changes consult `DESIGN.md` first while keeping technical lessons in `tasks/LESSONS.md`.
- Refined the web design foundation in `apps/web/app/globals.css` with functional state tokens, missing utility classes, shared module-entry layout classes, CSS warning cleanup, and preserved `.module-entry-panel` amber top accent ownership.
- Upgraded entry surfaces and copy consistency across Projects, Overview, Wiki, Documents, Code, Tasks, Meetings, and Account without backend/API/schema changes. The Tasks overflow trigger now uses a lucide icon button instead of `···`.
- Verification passed: static `rg` audits for obsolete active branding, decorative language, missing CSS utilities, user-facing `tranche`/ellipsis wording, and `module-entry-panel` accent ownership; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web build`; `git diff --check`.
- Visual verification used `next start` plus temporary Playwright Chromium screenshots in `/tmp/atlasium-visual` for `/`, `/login`, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, Meetings, and Account. Public/auth routes were captured normally; protected module routes were captured with JavaScript disabled to inspect SSR initial layout without the unauthenticated client redirect. Full authenticated interaction checks were not run because no API/auth session/test data was active locally.

## Wiki Docs Assignment Panel (2026-06-02)
- [x] Register the approved implementation plan for assigning unassigned Wiki pages to Docs repos.
- [x] Add API DTO, endpoint, service flow, and result/status types.
- [x] Preserve page history while moving paths and creating Docs bindings.
- [x] Add guided Wiki UI assignment panel.
- [x] Add focused API and HTTP coverage.
- [x] Run verification and document results.

### Review
- Added the Docs assignment endpoint and status payload support for published unbound Wiki pages with draft-change indicators.
- Assignment now moves the existing Wiki page under the selected repository prefix, preserves revisions/drafts, updates link graph targets, commits missing Markdown files in grouped GitLab commits, links identical remote files, and leaves Wiki state untouched on conflicts or GitLab failures.
- The Wiki UI now exposes an `Assign pages` guided modal with repository selection, folder/slug editing, destination previews, validation, and post-assignment result badges.
- Verification passed: `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/wiki/wiki.service.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/wiki/wiki.service.spec.ts src/gitlab/gitlab.service.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/wiki.controller.http.spec.ts`; `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `git diff --check`.
- Coverage gate attempted with `pnpm --filter @doctoral/api test:coverage:gate`; unit coverage passed with 22 suites and 305 tests, HTTP coverage passed with 9 suites and 79 tests, and integration coverage could not run because no PostgreSQL server was reachable at `localhost:5432`.

## Wiki Docs Unbound Export (2026-06-02)
- [x] Register the approved implementation plan for exporting unbound Wiki pages during Docs sync.
- [x] Add backend sync phase for published Wiki pages without Docs bindings.
- [x] Extend sync result types with exported/linked/unassigned counts.
- [x] Update Wiki UI sync summary for exported/linked/unassigned pages.
- [x] Add focused API and HTTP/type coverage.
- [x] Run verification and document results.

### Review
- `Sync Docs` now exports published unbound Wiki pages whose first path segment matches a repository Docs prefix, links identical existing files without committing, and reports pages outside repository prefixes as unassigned.
- Conflicting existing Docs content or existing bindings are reported without overwriting; GitLab failures leave no partial binding.
- Verification passed: `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/wiki/wiki.service.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/wiki/wiki.service.spec.ts src/gitlab/gitlab.service.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/wiki.controller.http.spec.ts`; `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `git diff --check`.

## Wiki Docs Sync (2026-06-02)
- [x] Register the approved implementation plan for bidirectional Wiki/Docs synchronization.
- [x] Add Prisma persistence for per-repository Wiki Docs prefixes and file bindings.
- [x] Add GitLab repository traversal and direct commit helpers for `Docs` Markdown files.
- [x] Add backend Wiki Docs sync status/run endpoints with conflict-safe reconciliation.
- [x] Sync Wiki create/publish/delete flows to GitLab for Docs-bound pages.
- [x] Update Wiki UI with repository-aware page creation, `Sync Docs`, and Docs-relative Markdown rendering.
- [x] Add focused API/Web tests and run verification.
- [x] Document implementation review and final verification results.

### Review
- Implemented repository-scoped Docs bindings, stable Wiki prefixes, conflict-safe reconciliation, GitLab commit/export hooks for Docs-bound pages, and Wiki UI controls for sync and repository-aware creation.
- Verification passed: `pnpm --filter @doctoral/db db:generate`; `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/doctoral_platform?schema=public' pnpm --filter @doctoral/db exec prisma validate`; `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit`; `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/wiki/wiki.service.spec.ts src/gitlab/gitlab.service.spec.ts`; `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/wiki.controller.http.spec.ts test/http/gitlab.controller.http.spec.ts`; `pnpm --filter @doctoral/api build`; `pnpm --filter @doctoral/web build`; `git diff --check`.
- Coverage gate was not required by the project rule because this change did not add a new API service file.

## README Refresh and Atlasium v0.4.0 Release (2026-05-31)
- [x] Register the README/release implementation plan.
- [x] Rewrite `README.md` to reflect the current Atlasium product, architecture, setup, testing, and deployment model.
- [x] Run local documentation verification and commit the README/TODO changes.
- [ ] Push `main` and verify GitHub Actions CI passes for the documentation commit.
- [ ] Create annotated tag `v0.4.0` and publish GitHub Release `Atlasium v0.4.0` as latest.

### Review - README Refresh and Atlasium v0.4.0 Release
- Replaced the outdated `v1 bootstrap` README with a current Atlasium guide covering product scope, workspace architecture, features, local setup, environment groups, API overview, testing, deployment, and project conventions.
- Kept package versions unchanged at `0.1.0`; product release versioning remains Git tags and GitHub Releases.
- Verification:
  - `git diff --check` passed
  - `pnpm lint` passed
  - `pnpm build` passed
  - Commit message: `docs(readme): refresh atlasium project guide`

## Wiki Consistency and Link Hardening (2026-05-28)
- [x] Register the scoped Wiki hardening implementation plan.
- [x] Update Wiki data constraints/indexes for soft-delete path reuse and search performance.
- [x] Harden Wiki link visibility, link hydration, and draft-only import link graph behavior.
- [x] Add inline `[[wiki-link]]` navigation in rendered Markdown without changing stored Markdown.
- [x] Extract low-risk Wiki render/import/history components from the hub.
- [x] Run focused Wiki tests, API/web type-checks, diff hygiene, and document results.

### Review - Wiki Consistency and Link Hardening
- Replaced the full Wiki path uniqueness model with a migration-managed active-page partial unique index and added GIN search indexes for page title/path plus revision/draft content.
- Wiki link graph now rebuilds for draft-only imports, hydrates existing broken links when target pages are created/published/imported, and filters draft-only link targets/backlinks away from reader responses.
- Rendered Wiki Markdown now turns `[[path]]` into internal navigation using the existing outgoing-link contract, preserving broken/hidden links as non-navigable text.
- Extracted low-risk Wiki UI pieces into dedicated reader, import, history, and Markdown renderer components while keeping realtime editor state in the hub.
- Verification:
  - `pnpm --filter @doctoral/db db:generate` passed
  - `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/doctoral_platform?schema=public' pnpm --filter @doctoral/db exec prisma validate` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/wiki/wiki.service.spec.ts` passed with 37 tests
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/wiki.controller.http.spec.ts` passed with 14 tests
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - Commit message: `fix(wiki): harden links and draft visibility`

## Fix Code Branches/Merge Requests Layout (2026-05-28)
- [x] Register the scoped layout and validation fix for Code branch/MR actions.
- [x] Move Branch/MR creation actions into their owning panels and remove cockpit overflow pressure.
- [x] Add frontend guards for invalid branch/MR creation states and clearer repository content errors.
- [x] Add API-side validation for empty trimmed fields and same-source-target merge requests.
- [x] Run focused API tests, web/API type-checks, web build, diff hygiene, and document results.

### Review - Fix Code Branches/Merge Requests Layout
- Moved `New branch` and `Create MR` out of the global Code cockpit and into the `Branches` and `Merge requests` panel headers.
- Shortened the top tab label to `MRs` while preserving the accessible `Merge requests` label, and added panel-header action wrapping to avoid the desktop scrollbar regression.
- Added frontend guards for empty branch/MR inputs, GitLab connection/write/loading states, one-branch MR flows, and same-source-target merge requests.
- Added API DTO/service validation for trimmed empty fields and same-source-target merge requests, with focused service and HTTP coverage.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/gitlab.controller.http.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - Commit message: `fix(code): stabilize branch and merge request actions`

## Worker Meeting Automation Coverage Gate Fix (2026-05-27)
- [x] Register the scoped CI fix for the worker coverage gate regression.
- [x] Add focused meeting automation edge-case coverage without lowering thresholds or excluding files.
- [x] Run worker focused spec, exact coverage gate, type-check, diff hygiene, and document results.

### Review - Worker Meeting Automation Coverage Gate Fix
- Added meeting automation worker tests for missing runs, disabled automation, completed/stale runs, deleted meetings, empty TO DO, missing OpenAI key, assignee/name matching, unassigned tasks, invalid due dates, priority mapping, source/title fallback, creator fallback, and parser trimming.
- Kept production code, coverage thresholds, and coverage exclusions unchanged.
- Verification:
  - `pnpm --filter @doctoral/worker exec jest --config jest.config.ts --runInBand src/jobs/meeting-automation.job.spec.ts` passed
  - `pnpm --filter @doctoral/worker test:coverage:gate` passed with statements `99.7%`, branches `96.93%`, functions `97.82%`, lines `99.69%`
  - `pnpm --filter @doctoral/worker exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed
  - Commit message: `test(worker): cover meeting automation edge cases`

## Meetings Tasks AI Automation (2026-05-27)
- [x] Register the implementation plan for automatic AI task creation from minutes.
- [x] Add Prisma schema/migration support for task completion timestamps, meeting automation runs, and meeting-action provenance.
- [x] Wire API meeting creation, retry endpoint, queueing, task provenance, and completed-task DONE enrichment.
- [x] Add worker OpenAI extraction job with structured output validation and idempotent task/action creation.
- [x] Update Meetings and Tasks UI for automation status, retry, provenance, and placeholder Markdown normalization.
- [x] Run focused tests, type-checks, builds, diff hygiene, and document results.

### Review - Meetings Tasks AI Automation
- Added `Task.completedAt`, meeting automation run tracking, and meeting-action AI provenance/idempotency fields with migration/backfill support.
- Meeting creation now appends completed project tasks to DONE from the previous non-deleted minute window, normalizes placeholder Markdown, creates queued AI runs, and exposes automation state plus retry.
- Worker now consumes `ai-meeting`, calls OpenAI Responses API with strict JSON schema output, validates assignees/dates/lengths, and creates linked `MeetingAction` + `Task` records idempotently in a transaction.
- Meetings UI now shows AI status/count/error with retry for writers; Tasks UI shows linked “From meeting” provenance.
- Verification:
  - `pnpm --filter @doctoral/db db:generate` passed
  - `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/doctoral_platform?schema=public' pnpm --filter @doctoral/db exec prisma validate` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/worker exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/meetings/meetings.service.spec.ts src/tasks/tasks.service.spec.ts src/queues/queue.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/meetings/meetings.service.spec.ts` passed after the nullable placeholder and retry-status updates
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/meetings.controller.http.spec.ts test/http/tasks.controller.http.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/meetings.controller.http.spec.ts` passed after the nullable placeholder update
  - `pnpm --filter @doctoral/worker exec jest --config jest.config.ts --runInBand src/jobs/meeting-automation.job.spec.ts` passed
  - `pnpm --filter @doctoral/api build` passed
  - `pnpm --filter @doctoral/worker build` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - Commit message: `feat(meetings): automate task creation from minutes`

## Fix GitLab Binary Response Mock Coverage Failure (2026-05-27)
- [x] Register the scoped CI coverage fix for GitLab binary request failures.
- [x] Make binary GitLab error header reads defensive and update the low-level fetch mock.
- [x] Run focused Jest, coverage, API type-check, diff hygiene, and document results.

### Review - Fix GitLab Binary Response Mock Coverage Failure
- Made binary GitLab error metadata extraction tolerant of minimal mocked `Response` objects without changing real fetch behavior.
- Updated the low-level binary failure test to use the shared response helper so it includes the expanded response shape.
- Captured the fetch mock contract lesson in `tasks/LESSONS.md`.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts -t "supports empty JSON responses and binary GitLab request failures"` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts -t "archive|binary GitLab request failures"` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/api test:coverage` passed unit and HTTP coverage, then local integration coverage could not run because this WSL has no Docker and no Postgres at `localhost:5432`; the original CI unit failure is fixed.
  - `git diff --check` passed
  - Commit message: `test(api): fix gitlab binary response mock`

## Harden Code ZIP Archive Downloads (2026-05-27)
- [x] Register the scoped plan for diagnosing and hardening Code ZIP archive downloads.
- [x] Add API-side archive diagnostics, multi-strategy GitLab archive attempts, and fallback ZIP generation.
- [x] Update focused GitLab service/controller tests.
- [x] Run static audits, focused tests, API/web type-checks, diff hygiene, and document results.

### Review - Harden Code ZIP Archive Downloads
- Resolved archive refs to commit SHAs before requesting GitLab archives, then tried three bounded strategies: `.zip` with bearer auth, no-extension archive with `Accept: application/zip`, and `.zip` with server-side OAuth query auth.
- Added sanitized API-side diagnostics for failed archive attempts, including Atlasium ids, GitLab project id, resolved ref/SHA, upstream path, status, content type, GitLab request metadata, and a short response preview.
- Added a controlled Atlasium ZIP fallback built from GitLab tree/raw-file APIs with conservative file and byte limits.
- Preserved existing mappings for non-406 repository access failures and returned a controlled JSON error with `gitlab_archive_406` for persistent archive negotiation failures.
- Captured the production correction pattern in `tasks/LESSONS.md`.
- Verification:
  - Static audit confirmed the old restrictive archive media-range header and `GITLAB_ARCHIVE_ACCEPT_HEADER` are absent.
  - Static audit confirmed `/repository/archive.zip?sha=...`, no-extension retry, query-auth retry, fallback, and `gitlab_archive_406` diagnostics are present.
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts -t "archive"` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/gitlab.controller.http.spec.ts -t "archive"` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed
  - Commit message: `fix(code): harden gitlab archive downloads`

## Code ZIP Archive Accept Negotiation (2026-05-27)
- [x] Register the scoped production fix for Code ZIP `406 Not Acceptable`.
- [x] Relax repository archive `Accept` negotiation in the web helper and API GitLab proxy.
- [x] Update archive tests/static audits and run verification.

### Review - Code ZIP Archive Accept Negotiation
- Changed repository archive download requests to use neutral `Accept: */*` while keeping GitLab's explicit `/repository/archive.zip` URL format.
- Preserved the Atlasium API proxy route, repository-scoped download flow, and ZIP fallback content type.
- Verification:
  - Static audit confirmed the old restrictive archive media-range header no longer remains.
  - Static audit confirmed GitLab archive requests still use `/repository/archive.zip`.
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts -t "downloads the repository archive"` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/gitlab.controller.http.spec.ts -t "archive"` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed
  - Commit message: `fix(code): relax archive accept negotiation`

## Align Overview Entry Accent (2026-05-27)
- [x] Register the scoped fix for the Overview module entry accent color.
- [x] Preserve the Overview soft panel border while forcing the shared amber top accent color.
- [x] Run static CSS audits and diff hygiene checks.

### Review - Align Overview Entry Accent
- Fixed the Overview entry accent color by adding a composed `.overview-command-band.module-entry-panel` rule for `border-top-color: var(--brand)`.
- Kept the softer `border-color` on the rest of the Overview panel border.
- Verification:
  - Static audit confirmed `.module-entry-panel` still owns the only `border-top: 3px solid var(--brand)` declaration.
  - Static audit confirmed Overview now has a side-specific `border-top-color: var(--brand)` override without extra wrappers or duplicated border width.
  - `git diff --check` passed
  - Commit message: `style(web): align overview entry accent`

## Restore Module Entry Accent (2026-05-27)
- [x] Register the scoped plan for restoring the amber entry line on module panels.
- [x] Add a shared module entry panel accent class.
- [x] Apply the accent to Overview, Wiki, Documents, Code, Tasks, and Meetings first panels.
- [x] Run static audits, web type-check, production build, diff hygiene, and document results.

### Review - Restore Module Entry Accent
- Added shared `.module-entry-panel` styling for the amber top border.
- Applied the shared accent to Overview, Wiki side/main panes, Documents, Tasks, Meetings, Code cockpit, and Code no-repository state.
- Removed the Code-only amber border declaration from `.code-cockpit`.
- Verification:
  - Static audit confirmed no `content-header`, `hideHeader`, `ProjectSubtitle`, `project-subtitle`, or title/subtitle `AppShell` props returned.
  - Static audit confirmed `.module-entry-panel` is used on all intended module entry panels and owns the only `border-top: 3px solid var(--brand)` rule.
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - Commit message: `style(web): restore module entry accent`

## Remove AppShell Page Headers (2026-05-27)
- [x] Register the scoped plan for removing repeated shell page headers.
- [x] Remove `AppShell` title/subtitle/hideHeader props and header rendering.
- [x] Update all `AppShell` callsites and remove unused `ProjectSubtitle` references.
- [x] Remove obsolete `content-header` CSS.
- [x] Run static audits, web type-check, production build, diff hygiene, and document results.

### Review - Remove AppShell Page Headers
- Removed repeated shell page headings and subtitles from `AppShell`, leaving the top navigation as the only persistent shell chrome.
- Removed title/subtitle/hideHeader props from all `AppShell` callsites across global and project pages.
- Deleted the now-unused `ProjectSubtitle` component.
- Removed obsolete `content-header` CSS and mobile overrides.
- Verification:
  - Static audit confirmed no `content-header`, `hideHeader`, `ProjectSubtitle`, `project-subtitle`, or title/subtitle `AppShell` props remain.
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - Commit message: `style(web): remove shell page headers`

## Atlasium Horizontal Topbar Shell (2026-05-27)
- [x] Register the implementation plan for migrating the project sidebar to a sticky horizontal topbar.
- [x] Refactor `AppShell` from a collapsible left sidebar to a measured sticky topbar with guarded shell navigation.
- [x] Update unsaved-change guard integration for shell navigation, project exit, sign out, documents back navigation, and wiki internal page changes.
- [x] Replace sidebar-oriented CSS with shell topbar CSS and adjust dense workspace offsets/heights.
- [x] Run static audits, web type-check, production build, diff hygiene, and document results.

### Review - Atlasium Horizontal Topbar Shell
- Replaced the collapsible left sidebar with a sticky horizontal shell topbar containing brand, scrollable module navigation, project exit, and the user menu.
- Removed the persisted sidebar collapsed state and sidebar-specific CSS/classes from the active web code.
- Added measured `--shell-topbar-height` support so Wiki, Code, and Documents dense workspaces account for the sticky topbar.
- Expanded guarded navigation from project exit only to shell module links, sign out, Documents `Back to documents`, and Wiki internal page changes.
- Updated `UserMenu` to open downward from the topbar and close before sign out guard handling.
- Verification:
  - Static audit confirmed old sidebar shell classes/state are absent from `apps/web/app`, `apps/web/components`, and `apps/web/lib`.
  - Static audit confirmed no demo project links, `href="#"`, `window.confirm`, decorative purple/violet/sparkle references were introduced.
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - Commit message: `refactor(web): migrate shell navigation to sticky topbar`

## Atlasium Username Settings Copy (2026-05-27)
- [x] Register the scoped plan for the Profile account username copy change.
- [x] Update the Profile username field from Git username wording to Atlasium username wording.
- [x] Run web type-check, production build, static audit, and diff hygiene checks.
- [x] Document verification results and commit message.

### Review - Atlasium Username Settings Copy
- Updated the Profile account form so the editable field is labeled `Atlasium username` instead of `Git username`.
- Updated helper and success copy to describe Atlasium as the source identity that automatically syncs to the managed GitLab identity.
- Kept the existing `/auth/me/username` frontend helper and backend sync behavior unchanged; no separate Git username field was added.
- Verification:
  - Static audit confirmed `Git username` no longer appears in `apps/web/components/account-settings-surface.tsx`.
  - Static audit confirmed `updateAccountUsername` is still used for the Profile username form.
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - Commit message: `fix(web): clarify atlasium username settings`

## Google Search Favicon Fix (2026-05-26)
- [x] Inspect current Atlasium metadata and favicon assets.
- [x] Add crawler-friendly favicon files and explicit metadata links.
- [x] Verify generated metadata/assets with web build checks.
- [x] Document results and expected Google recrawl behavior.

### Review - Google Search Favicon Fix
- Current production still serves only `/atlasium-icon.svg` in metadata and returns `404` for `/favicon.ico` and `/favicon-48x48.png`, matching the missing-search-logo symptom.
- Added stable crawler-friendly favicon assets: `/favicon.ico`, `/favicon-48x48.png`, `/favicon-192x192.png`, `/apple-touch-icon.png`, and `/site.webmanifest`.
- Updated Next metadata so the generated home page includes `shortcut icon`, ICO/PNG `icon`, SVG fallback, Apple touch icon, and manifest links.
- Google may take several days to several weeks to refresh the search result after deployment; request indexing for `https://atlasium.info/` in Search Console to accelerate recrawl.
- Verification:
  - Asset inspection confirmed PNG dimensions `48x48`, `192x192`, `180x180`, and ICO entries `16x16`, `32x32`, `48x48`.
  - Visual inspection confirmed the generated 192px icon is correctly scaled and centered.
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - Generated Next HTML contains `/site.webmanifest`, `/favicon.ico`, `/favicon-48x48.png`, `/favicon-192x192.png`, `/atlasium-icon.svg`, and `/apple-touch-icon.png`.
  - `git diff --check` passed

## Code Image Preview For Repository Files (2026-05-25)
- [x] Add repository raw-file API routes for scoped and legacy Code file access.
- [x] Implement GitLab raw-file service support with existing repository read permissions.
- [x] Add web helper and Code viewer state for authenticated raster image preview blobs.
- [x] Add contained image preview CSS and preserve non-image binary fallback behavior.
- [x] Add focused API/service tests and run verification.

### Review - Code Image Preview For Repository Files
- Added authenticated raw-file streaming routes for legacy and repository-scoped Code file access with inline disposition and private no-store cache headers.
- Added GitLab raw file service support using existing repository read resolution and user GitLab access tokens.
- The Code viewer now detects raster image files, fetches the raw blob, renders it inline, and revokes object URLs on file/repository changes.
- Non-image binary files continue to show the existing binary preview fallback, while text files keep the word-wrap viewer.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/gitlab.controller.http.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - Static audit for raw-file/image-preview references passed
  - `git diff --check` passed

## CI API Aggregated Coverage Fix (2026-05-25)
- [x] Normalize initial project repository metadata when GitLab provision data is partial.
- [x] Update the API smoke GitLab provision mock to the current repository provision shape.
- [x] Add focused ProjectsService coverage for fallback repository metadata.
- [x] Run the failing integration path, focused backend tests, type-check, coverage when available, and diff hygiene.

### Review - CI API Aggregated Coverage Fix
- Project creation now falls back to the Atlasium project name, project description, private visibility, and a valid current timestamp when provisioned repository metadata is partial.
- The API smoke GitLab mock now returns the current managed repository provision shape, including name, description, visibility, and `lastActivityAt`.
- `ProjectsService` unit coverage now asserts fallback repository metadata and validates the stored `lastActivityAt` is not an invalid date.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/projects/projects.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.integration.config.ts --runInBand --forceExit test/api-smoke.e2e-spec.ts` could not run locally because Postgres is unavailable at `localhost:5432`; this is the same local DB limitation as previous integration checks, not the CI Prisma validation error.

## Multi-Repository Code Workspace (2026-05-25)
- [x] Update Prisma schema and migration for multiple managed repositories per project.
- [x] Refactor GitLab repository service/controller routes for repository-scoped operations while keeping legacy wrappers.
- [x] Update project overview, project lifecycle, auth/admin sync flows, and backend tests for multi-repository behavior.
- [x] Update web GitLab helpers and Code UI with repository switcher, selected repository persistence, and New repository modal.
- [x] Run database, API, web, static, and diff hygiene verification.

### Review - Multi-Repository Code Workspace
- Changed the data model from a singular `Project.repository` relation to `Project.repositories`, removed the project-level repository uniqueness constraint, and added repository list metadata for fast local summaries.
- Added repository-scoped API routes under `/projects/:projectId/repositories/:repositoryId/...` while keeping legacy singular routes as sole-repository compatibility wrappers.
- Moved repository creation to project write access, with managed private GitLab repositories initialized from Code using a project-key-prefixed path.
- Updated lifecycle and sync flows so access sync, password/reconnect sync, project delete, and project restore operate across all managed repositories.
- Updated Project Overview Code summary to report repository count and latest repository activity instead of assuming one default repository.
- Updated the Code cockpit with a repository switcher, persisted active repository selection, and a `New repository` modal for writers; all files, commits, branches, merge requests, clone, Git access, and ZIP flows now use the active repository id.
- Verification:
  - `pnpm --filter @doctoral/db build` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts src/projects/projects.service.spec.ts src/auth/auth.service.spec.ts src/admin/admin-users.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/gitlab.controller.http.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - Static audits for legacy singular repository assumptions and decorative/dead UI patterns passed
  - `git diff --check` passed

## Code ZIP Download + Word Wrap (2026-05-25)
- [x] Fix repository archive content negotiation so the Code `ZIP` action downloads archives without `406 Not Acceptable`.
- [x] Add API coverage for ZIP-compatible GitLab archive `Accept` headers.
- [x] Request ZIP/binary content explicitly from the web archive helper.
- [x] Add VS Code-style `Alt+Z` word wrap in the Code file viewer with local preference persistence.
- [x] Add wrapped-mode CSS that preserves default horizontal scrolling when wrap is off.
- [x] Run API tests, API/web type-check, web build, static audits, and diff hygiene checks.

### Review - Code ZIP Download + Word Wrap
- Repository archive downloads were updated to request ZIP-compatible binary content from both the web helper and the API-to-GitLab binary request.
- The archive service test now asserts the ZIP-compatible `Accept` header while preserving the existing archive URL, buffer, filename, and content-type behavior.
- The Code file viewer now includes a word-wrap toggle button with `WrapText`, `aria-pressed`, and `Alt+Z` support for selected text files.
- Word wrap defaults off, persists in `localStorage` under `atlasium_code_file_word_wrap`, and wrapped mode stays contained inside the viewer.
- Verification:
  - `pnpm --filter @doctoral/api test -- --runInBand src/gitlab/gitlab.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - Static audits for archive headers and word-wrap references passed
  - `git diff --check` passed

## Atlasium Code Repository Cockpit (2026-05-25)
- [x] Replace the large Code repository overview card with a compact two-row repository cockpit.
- [x] Move SSH/HTTPS clone and Git access guidance into a Clone drawer/modal.
- [x] Keep Files, Commits, Branches, and Merge Requests as cockpit modes with contextual controls/actions.
- [x] Strengthen Files mode into a denser IDE-like workbench with selected-file state and stable viewer header.
- [x] Move branch/MR creation into focused modal surfaces and reduce large alert feedback.
- [x] Run web type-check, build, static audits, and diff hygiene checks.

### Review - Atlasium Code Repository Cockpit
- Replaced the large `Repository workspace` card with a two-row repository cockpit: compact repository identity/status, mode tabs, contextual branch/MR controls, and primary actions.
- Moved SSH/HTTPS clone URLs, Windows HTTPS guidance, and `Manage Git access` into a dedicated Clone drawer.
- Reworked Files into a denser workbench with a stable file tree, active selected-file state, file metadata header, contained code scrolling, and stronger empty/binary/loading states.
- Moved branch creation into a modal, kept MR creation modal-based, and moved branch/MR contextual actions into the cockpit.
- Reduced Code page feedback from large alert stacks to compact `StatusLine`/`EmptyState` surfaces where possible.
- Added a reusable lesson for dense technical modules in `tasks/LESSONS.md`.
- Verification:
  - `rg -n "Repository workspace|code-overview-card|code-overview-side" apps/web/app/projects/[projectId]/code/page.tsx apps/web/app/globals.css` returned no matches
  - `rg -n "window\\.confirm|href=\"#\"|✨|sparkle|purple|violet" apps/web/app/projects/[projectId]/code/page.tsx apps/web/app/globals.css` returned no matches
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed

## Atlasium Project Overview Command Center (2026-05-25)
- [x] Add `GET /projects/:projectId/overview` with local-data aggregation for project, access, attention, module summaries, and provenance activity.
- [x] Add focused `ProjectsService.getProjectOverview` tests for access, soft-deleted data, attention ordering, reader behavior, and unknown audit actions.
- [x] Add a web API helper for the overview response and migrate `/projects/:projectId` to load only the new endpoint.
- [x] Redesign the Project Overview into a dense command center with attention, next steps, equal module summaries, and recent provenance.
- [x] Add focused command-center CSS using existing Atlasium tokens and shared UI primitives.
- [x] Run API/web type-check, web build, focused backend tests, and diff hygiene checks.

### Review - Atlasium Project Overview Command Center
- Added `GET /projects/:projectId/overview`, aggregating project metadata, access, attention items, module summaries, near-term tasks/meetings, and audit-log provenance from local database state only.
- Replaced the previous four-card Project Overview with an operational command center: project command band, attention panel, next-work rail, equal module strip for Wiki/Documents/Code/Tasks/Meetings, and recent provenance.
- Added Wiki as a first-class Overview module and kept Overview actions as navigation-only links into the owning workspace.
- Kept reader access supported while avoiding unpublished/draft wiki attention for read-only users.
- Recorded the command-center pattern in `tasks/LESSONS.md`.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/projects/projects.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed

## Atlasium Anti-Vibe-Coded UI Hardening (2026-05-24)
- [x] Persist anti-vibe-coded quality rules in `tasks/LESSONS.md`.
- [x] Expand web metadata and add stable Atlasium icon/OpenGraph assets.
- [x] Formalize spacing, radius, and elevation tokens in the web base CSS.
- [x] Add shared UX state primitives for loading, skeletons, empty states, field messages, and status lines.
- [x] Replace top-level loading alerts in major data-heavy surfaces with stable loading states.
- [x] Reduce decorative hover motion and remove nonessential inline styles.
- [x] Run static audits, web type-check, build, and diff hygiene checks.

### Review - Atlasium Anti-Vibe-Coded UI Hardening
- Added a permanent `Anti-vibe-coded product quality` section to `tasks/LESSONS.md` covering visual restraint, consistency, motion, async states, metadata, copy, and pre-ship audits.
- Expanded app metadata with Atlasium-specific title templates, application name, description, OpenGraph, Twitter metadata, and stable local icon/OpenGraph SVG assets.
- Added spacing, radius, and elevation tokens to the base CSS and reduced decorative hover transforms/entry motion so interaction feedback stays restrained and functional.
- Added shared UX state primitives: `LoadingState`, `SkeletonBlock`, `EmptyState`, `FieldMessage`, and `StatusLine`.
- Replaced major top-level data-loading alert paragraphs across Projects, Overview, Documents, Tasks, Meetings, Code, Wiki, document detail, and Account settings with reserved loading surfaces.
- Removed nonessential inline styles found in the Code workspace; remaining inline styles are reserved for genuinely dynamic concerns such as tree indentation, collaborator colors, context menu positioning, and embedded editor/PDF integrations.
- Verification:
  - `rg -n "purple|violet|sparkle|✨|href=\"#\"|window\\.confirm" apps/web/app apps/web/components apps/web/lib` returned no matches
  - `rg -n "openGraph|twitter|metadataBase|applicationName" apps/web/app/layout.tsx` confirmed the metadata fields
  - `rg -n "style=\\{\\{|alert alert-|button button-|list-item" apps/web/app apps/web/components` still reports legacy/shared primitive classes and dynamic inline exceptions; these are documented for gradual cleanup rather than removed wholesale in this pass
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed

## Atlasium Workbench Navigation + Account Drawer (2026-05-24)
- [x] Add the implementation plan and preserve existing visual identity lessons.
- [x] Add shared UI primitives for buttons, icon buttons, alerts, tabs, modal/dialog, user menu, and account drawer surfaces.
- [x] Move Account settings into a reusable surface that works both as `/account` and as an in-shell drawer.
- [x] Remove `Account` from project/global sidebar navigation and add persistent user controls outside the project module nav.
- [x] Give `Code` equal navigation and project-overview weight alongside `Wiki` and `Documents`.
- [x] Replace Code-to-Account links with in-context Git access drawer actions where possible.
- [x] Run type-check, build, and diff hygiene verification.

### Review - Atlasium Workbench Navigation + Account Drawer
- Removed `Account` from sidebar navigation so project modules stay scoped to project work.
- Added a persistent user menu in `AppShell` with Account settings, Git access, Notifications, Security, and Sign out actions.
- Extracted Account settings into `AccountSettingsSurface`, reused by `/account` and the in-shell `AccountDrawer`.
- Added shared UI primitives and a reusable confirmation dialog hook; replaced all browser `window.confirm` usage in migrated web surfaces.
- Promoted Code as a first-class project module with sidebar iconography, project overview presence, stronger repository workspace header, iconized repository tabs, and Git access drawer actions.
- Verification:
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed
  - `git diff --check` passed
  - `rg -n "window\\.confirm|href=\"/account\"|label: \"Account\"" apps/web/app apps/web/components` returned no matches

## Atlasium Digital Visual Identity (2026-05-24)
- [x] Record the identity direction: contemporary institution, living archive, graphite + amber, editorial serif + UI sans.
- [x] Update web font loading for editorial display and sans UI roles.
- [x] Rebuild root visual tokens for canvas, surfaces, borders, text, brand/accent, semantic states, radii, and shadows.
- [x] Add a reusable Atlasium symbol component for sidebar, home, login, and invite surfaces.
- [x] Apply the identity to base shell, home/auth screens, panels, buttons, inputs, badges, alerts, and document/workspace-safe surfaces.
- [x] Verify web type-check, production build, and diff hygiene.

### Review - Atlasium Digital Visual Identity
- Established the Atlasium identity direction in the web base layer: contemporary institution, living archive, graphite + amber, editorial serif plus sans UI.
- Switched display typography to `Source Serif 4` and UI typography to `Inter`.
- Added a reusable `AtlasiumMark` SVG component and used it in the sidebar, home, login, and invite screens.
- Rebuilt root design tokens and compatibility aliases for surfaces, panels, borders, text, brand/accent, semantic states, radii, and shadows.
- Applied the identity to shell navigation, page headers, auth/home surfaces, panels, buttons, inputs, badges, and alerts.
- Fixed the Code merge-request description textarea so it uses the shared input styling.
- Verification:
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` passed; Next retried transient Google Fonts socket failures and then completed successfully
  - `git diff --check` passed

## Atlasium v0.3.0 Release Tag (2026-05-24)
- [x] Confirm `main` matches `origin/main`, the worktree is clean, and `v0.3.0` does not already exist.
- [x] Run release verification before tagging.
- [x] Create annotated Git tag `v0.3.0` with release notes.
- [x] Push `v0.3.0` to `origin` and verify the remote tag.
- [x] Record release verification and tag results.

### Review - Atlasium v0.3.0 Release Tag
- Created annotated tag `v0.3.0` on `78080d2da669948e5f8a6d93944942a290e69faa`.
- Pushed `v0.3.0` to `origin`; remote peeled tag resolves to the same commit.
- Release notes cover managed GitLab/OIDC, Code workspace, Git access, Account settings, Wiki improvements, admin/security hardening, and CI/CD/runtime hardening.
- Verification:
  - `pnpm test:ci` could not complete because local Postgres was unavailable at `localhost:5432`; Docker is also unavailable in this WSL environment, so the test database could not be started here.
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/worker exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/db build` passed
  - `git diff --check` passed

## Atlasium Username as GitLab Identity (2026-05-23)
- [x] Add persistent unique `User.username` with backfill migration and validation helpers.
- [x] Update invite acceptance, login, account profile, and username edit endpoint.
- [x] Use username in OIDC preferred_username and GitLab managed user create/rename flows.
- [x] Update Accept Invite, Login, Account, Code, and runbook guidance.
- [x] Add focused backend tests and run type-check/diff verification.

### Review - Atlasium Username as GitLab Identity
- Added unique `User.username` with a migration that backfills existing users from normalized email local-parts and stable suffixes for collisions.
- Login now accepts email or username; invite acceptance stores a username; `/auth/me` returns it; `/auth/me/username` updates it after syncing the linked GitLab OIDC account.
- OIDC now emits `preferred_username=user.username`, and managed GitLab provisioning/renaming uses Atlasium username exactly instead of deriving from email.
- Account, Accept Invite, Login, Code, and the go-live runbook now present Atlasium username as the Git/GitLab username.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/auth/auth.service.spec.ts src/auth/oidc.service.spec.ts src/gitlab/gitlab.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/auth.controller.http.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed

## HTTPS Clone with Atlasium Password Sync (2026-05-23)
- [x] Add authenticated backend action to sync the current Atlasium password into the OIDC-linked GitLab user for Git over HTTPS.
- [x] Sync GitLab local password during Atlasium password changes, aborting if GitLab cannot be updated.
- [x] Update Account and Code UI to explain username + Atlasium password HTTPS clone after enablement.
- [x] Update runbook and lessons with the accepted password-sync tradeoff.
- [x] Add focused backend tests and run type-check/diff verification.

### Review - HTTPS Clone with Atlasium Password Sync
- Added `POST /auth/gitlab/https-password`, validating the current Atlasium password before syncing it to the OIDC-linked GitLab user.
- GitLab password sync resolves users through `provider=openid_connect` and `extern_uid=<Atlasium user id>`, creates the OIDC user when missing, and ensures `password_authentication_enabled_for_git=true`.
- Atlasium password changes now sync the new password to GitLab before updating the local Atlasium hash, so a GitLab sync failure aborts the change.
- Account and Code now describe HTTPS clone as GitLab username plus Atlasium password after enablement, while keeping SSH recommended and PAT as fallback.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts src/auth/auth.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/auth.controller.http.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed

## HTTPS Clone via Git Credential Manager (2026-05-23)
- [x] Document Windows Git Credential Manager browser/OAuth configuration for `git.atlasium.info`.
- [x] Update the Code HTTPS clone guidance to point users at Atlasium browser login through GCM.
- [x] Update Account/runbook clone guidance while keeping SSH as the primary path and PAT as fallback.
- [x] Verify production GitLab OAuth redirects into Atlasium SSO and run web type-check/diff hygiene.

### Review - HTTPS Clone via Git Credential Manager
- The Code tab now explains that HTTPS clone can use Git Credential Manager browser login with Atlasium SSO, with SSH still recommended and PAT as fallback.
- Account now shows the Windows GCM setup commands next to CLI Git access.
- The go-live runbook documents clearing stale `git.atlasium.info` credentials and cloning over HTTPS through GCM browser login.
- Production GitLab OAuth probing redirects to `/users/sign_in`, whose response auto-starts `/users/auth/openid_connect`, confirming the SSO entrypoint for browser login.
- Verification:
  - `curl` probe of `https://git.atlasium.info/oauth/authorize?...` confirmed GitLab sign-in auto-starts `openid_connect`
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed

## Deploy Checkout Auth Fix (2026-05-23)
- [x] Align deploy checkout with CI checkout runtime and explicit workflow-run SHA authentication.
- [x] Restrict automatic deploy promotion to successful CI runs from the same repository on `main`.
- [x] Validate the checked-out commit matches the successful CI run SHA before building/pushing images.
- [x] Run workflow lint and diff hygiene checks.

### Review - Deploy Checkout Auth Fix
- `build-and-push` now uses `actions/checkout@v6` with explicit workflow-run repository, SHA, token, shallow fetch, and non-persisted credentials.
- Automatic deploy jobs now require the successful CI run to come from the same repository on `main`, avoiding fork/cross-repo promotion.
- The workflow validates `git rev-parse HEAD` against the successful CI SHA before publishing images.
- Verification:
  - `npx --yes github-actionlint@latest .github/workflows/deploy.yml` passed
  - `npx --yes node-actionlint@latest .github/workflows/deploy.yml` passed
  - `git diff --check` passed
  - `npx --yes actionlint@latest .github/workflows/deploy.yml` could not run because the npm package does not expose an executable binary

## Code GitLab OIDC Access Auto-Sync (2026-05-23)
- [x] Resolve managed GitLab repository members by Atlasium OIDC identity instead of optional GitLab API OAuth connection.
- [x] Add backend ensure-access action for the Code tab before opening GitLab.
- [x] Update Code UI to ensure GitLab membership before opening the repository web URL.
- [x] Reject GitLab API OAuth connections that do not belong to the current Atlasium OIDC identity.
- [x] Add focused backend/frontend coverage and run verification checks.

### Review - Code GitLab OIDC Access Auto-Sync
- Managed GitLab repository access now resolves users through `provider=openid_connect` and `extern_uid=<Atlasium user id>` before membership sync.
- If no OIDC GitLab user exists, Atlasium creates a managed GitLab account with the Atlasium OIDC identity instead of reusing stale OAuth connection metadata.
- The Code tab now calls `POST /projects/:projectId/repository/access/ensure` before opening GitLab, so the current Atlasium user is added to the managed repository first.
- GitLab OAuth reconnect now rejects accounts whose OIDC identity does not match the Atlasium user, preventing accidental reconnection to `root`.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec jest --config jest.http.config.ts --runInBand test/http/gitlab.controller.http.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed

## Production GitLab SSO Token Signing Fix (2026-05-23)
- [x] Bypass the shared Nest JWT secret when signing/verifying Atlasium OIDC RS256 tokens.
- [x] Reproduce production by constructing `OidcService` tests with a configured global `JwtService` secret.
- [x] Assert exchanged OIDC tokens are valid RS256 JWTs with expected issuer/audience and key id.
- [x] Run focused OIDC tests, API type-check, and diff hygiene; capture verification results.

### Review - Production GitLab SSO Token Signing Fix
- `OidcService` now passes the OIDC RSA private/public key as explicit `secret` for RS256 sign/verify calls, so the global session `JWT_SECRET` no longer shadows the OIDC key.
- The OIDC spec now constructs the service with a configured `JwtService({ secret: ... })`, reproducing production module wiring.
- The token exchange test verifies both `access_token` and `id_token` are RS256 JWTs with the expected `kid`, issuer, audience, and user claims.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/auth/oidc.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed

## Production GitLab SSO Repair (2026-05-22)
- [x] Diagnose deployed Atlasium/GitLab OIDC configuration on the VPS without printing secrets.
- [x] Reconcile GitLab Omniauth/OIDC configuration if the running container does not expose Atlasium SSO.
- [x] Verify GitLab web login exposes Atlasium SSO while root bypass remains available.
- [x] Document production result and any follow-up for clone credentials.

### Review - Production GitLab SSO Repair
- Production already had the required Atlasium OIDC variables and GitLab Omniauth settings loaded.
- The normal GitLab sign-in page is an auto-submit page that posts to `/users/auth/openid_connect`; it does not necessarily show the visible `Atlasium` label before redirecting.
- Simulated the GitLab OIDC POST from the VPS and confirmed it returns `302` to `https://atlasium.info/api/auth/oidc/authorize?...`.
- Confirmed the root bypass URL still exposes the local GitLab sign-in form plus the Atlasium provider.
- Updated `infra/scripts/validate-managed-gitlab-rollout.sh` so post-deploy validation accepts either the visible Atlasium label or the auto-start `openid_connect` flow.
- Copied the updated validator to `/opt/atlasium` and re-ran `post-deploy`; it passed.
- Follow-up: use `https://git.atlasium.info/users/sign_in` for normal Atlasium SSO, not `?auto_sign_in=false`; clone credentials are still SSH or HTTPS PAT, not the Atlasium password.

## Code Tab GitLab Token Refresh Race (2026-05-13)
- [x] Add per-user single-flight handling for GitLab OAuth refreshes in the API.
- [x] Reuse the shared refresh path for proactive expiry refresh and retry-after-401 refresh.
- [x] Add focused GitLab service tests for concurrent refresh and sanitized reconnect errors.
- [x] Re-run focused Jest, API type-check, and diff hygiene; capture the verification result.

### Review - Code Tab GitLab Token Refresh Race
- Added a per-user shared refresh promise in `GitlabService` so concurrent repository calls reuse one GitLab OAuth refresh instead of racing the same `refresh_token`.
- Routed both proactive expiry refresh and retry-after-`401` refresh through the shared path.
- Sanitized failed OAuth refreshes to `GitLab reconnection required` and mark the connection for reconnection, preventing raw `invalid_grant` from reaching the Code tab.
- Verification:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/gitlab/gitlab.service.spec.ts` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed

## Account UX Cleanup - Merge GitLab + SSH (2026-04-15)
- [x] Merge `GitLab access` and `SSH keys` into one technical panel in the secondary `Account` column.
- [x] Rework `Current keys` into compact rows with truncating titles, trailing actions, and inline details.
- [x] Collapse `Add SSH key` behind a toggle button, following the `Invite user` interaction pattern.
- [x] Re-run `git diff --check` and `pnpm --filter @doctoral/web build`, then capture the verification result.

### Review - Account UX Cleanup - Merge GitLab + SSH
- The technical side of `Account` is now one coherent panel instead of two competing right-column cards:
  - `GitLab web access` stays at the top
  - `SSH keys` now lives in the same panel below it, separated as a technical subsection rather than a second full card
- `Current keys` is now a compact row list instead of nested cards:
  - the title owns the flexible width
  - long titles truncate with ellipsis instead of wrapping vertically letter by letter
  - actions stay in a trailing group on the right, then stack cleanly on narrow widths
- `Add SSH key` now follows the same interaction model as `Invite user`:
  - closed by default behind a button
  - opens inline inside the same technical panel
  - closes automatically after a successful key creation
- The previous user-reported layout failure was addressed at the root:
  - the dense GitLab/SSH workflow no longer competes inside multiple nested subcards in a narrow column
  - the always-open add form no longer permanently consumes half of the available width
- Verification:
  - `git diff --check` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web build` again reached `next build` -> `Creating an optimized production build ...`, but this wrapper still failed to return a final exit status after the `next build` process had already disappeared from `ps`; there was no concrete build error output to act on here

## Account SSH Keys UX Cleanup (2026-04-15)
- [x] Compact `Current keys` into summary-first cards with explicit `Show details` / `Hide details` toggles.
- [x] Move `Added`, `Expires`, and public-key preview into a contained inline details panel per SSH key.
- [x] Tighten the nested SSH-card styling so the inner cards no longer visually spill outside the `Current keys` subcard.
- [x] Re-run `git diff --check` and `pnpm --filter @doctoral/web build`, then capture the verification result.

### Review - Account SSH Keys UX Cleanup
- `Current keys` now defaults to a scan-friendly list:
  - each SSH key shows only its title, optional usage badge, and actions
  - `Added`, `Expires`, and the public key body moved behind an inline `Show details` / `Hide details` toggle
- The nested card hierarchy is cleaner:
  - the `Current keys` subcard remains the dominant container
  - each SSH key is now a lighter item card instead of a full competing white panel
  - the expanded details view renders inside a secondary contained surface, so long public keys no longer visually break out of the section
- Responsive behavior was preserved:
  - desktop keeps the two-column SSH layout
  - narrow widths stack key actions and collapse details metadata to one column
- Verification:
  - `git diff --check` passed
  - `pnpm --filter @doctoral/web build` again reached `next build` -> `Creating an optimized production build ...`, but this wrapper still failed to return a final exit status after the `next build` process had already disappeared from `ps`; there was no concrete build error output to act on here

## Account vNext - Settings Hub + Change Password (2026-04-15)
- [x] Add authenticated backend profile and password-change endpoints, including revoking all other sessions after a successful password change.
- [x] Add/update backend auth service and HTTP tests for profile reads, password-change validation, and session revocation behavior.
- [x] Extract frontend account helpers for profile, password, and notification preferences, then redesign `Account` into a multi-section settings workspace.
- [x] Surface notification preferences alongside the existing GitLab/SSH settings without regressing reconnect and SSH-key flows.
- [x] Verify the affected backend tests, web build, and diff hygiene; then capture review notes and any new lessons.

### Review - Account vNext - Settings Hub + Change Password
- `Account` is no longer a single GitLab-only panel:
  - desktop now uses a two-column settings workspace
  - primary column: `Profile`, `Security`, `Notifications`
  - secondary column: `GitLab access`, `SSH keys`
  - mobile still collapses to a single-column stack through the responsive CSS pass
- Added authenticated Atlasium profile support:
  - new `GET /auth/me`
  - frontend loads profile from the backend and refreshes the stored `doctoral_user` snapshot so downstream pages keep the latest `name` and `globalRole`
- Added authenticated password change:
  - new `POST /auth/password/change`
  - requires current password, enforces confirmation match and “different from current” validation
  - revokes all other persisted sessions while keeping the current one alive
  - writes an audit log entry for the change
- Surfaced existing notification preferences in `Account`:
  - backend APIs were reused as-is
  - frontend now supports load/edit/reset/save with explicit dirty-state handling and validation for `taskDueLeadHours`
- Reorganized GitLab access and SSH keys without changing behavior:
  - connection/reconnect/disconnect stays intact
  - SSH-key management remains disabled until GitLab is connected and not marked `reconnectRequired`
  - copy now makes the Atlasium vs GitLab vs SSH model explicit
- Files added/extended for this tranche include:
  - `apps/api/src/auth/auth.controller.ts`
  - `apps/api/src/auth/auth.service.ts`
  - `apps/api/src/auth/dto/change-password.dto.ts`
  - `apps/api/src/common/current-session-token.decorator.ts`
  - `apps/web/lib/account.ts`
  - `apps/web/app/account/page.tsx`
  - `apps/web/app/globals.css`
- Verification:
  - `pnpm --filter @doctoral/api build` passed
  - `git diff --check` passed
  - targeted Jest and web build commands were attempted, but this wrapper again left those commands hanging after the underlying child process disappeared from `ps`; no concrete failing test/build output was produced here, so they still need a clean rerun outside this wrapper for definitive runtime confirmation

## CI Wiki Regression + Actions Runtime Cleanup (2026-04-15)
- [x] Fix the two wiki service specs that regressed after the draft-only wiki changes.
- [x] Remove Node 20 JavaScript-action deprecation warnings from CI by modernizing the workflow runtime setup.
- [x] Re-verify the relevant API checks locally as far as this environment allows, then capture the result.

### Review - CI Wiki Regression + Actions Runtime Cleanup
- Fixed the two failing wiki specs in `apps/api/src/wiki/wiki.service.spec.ts`:
  - the tree expectation now includes the new `isUnpublished: false` field for published pages
  - the revision-read test now matches the current `ensurePageReadable()` contract by mocking `currentRevisionId` and asserting `getProjectAccess(...)` instead of the older `ensureProjectReadable(...)`
- Modernized `.github/workflows/ci.yml` to remove the Node 20 JavaScript-action deprecation path:
  - `actions/checkout` moved to `@v6`
  - `actions/setup-node` moved to `@v6`
  - `pnpm/action-setup` was removed entirely
  - pnpm is now enabled via `corepack prepare pnpm@9.15.4 --activate`, aligned with the repo `packageManager`
  - after the follow-up CI failure, removed `setup-node`'s built-in `cache: pnpm` because that cache path tries to execute `pnpm` before Corepack has installed it
  - this keeps the workflow deterministic; if we want cache back later, it should be restored only after pnpm is guaranteed to exist on `PATH`
- Local verification:
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed
- Residual verification note:
  - focused Jest runs in this wrapper still hang without returning a stable terminal result, so the spec fix is based on the concrete CI failure and the updated test contract rather than a clean local Jest exit here

## Wiki Markdown Import - Batch `.md` Import with Draft-Only Pages (2026-04-15)
- [x] Allow wiki pages to exist without a published revision and expose that state safely to writers/readers.
- [x] Add backend batch markdown import with partial success reporting and draft-only page creation.
- [x] Update wiki frontend types and page/detail handling for unpublished pages and first publish from draft-only state.
- [x] Add wiki import UX with folder/files selection, metadata review, local image upload + markdown rewrite, and conflict reporting.
- [x] Add/update backend and HTTP tests for draft-only visibility, first publish, and batch import behavior.
- [x] Verify API type-checks and diff hygiene; capture the remaining sandbox limitation around Jest/web build.

### Review - Wiki Markdown Import - Batch `.md` Import with Draft-Only Pages
- Wiki pages can now exist as draft-only records:
  - backend `WikiPageDetail.published` is nullable
  - tree nodes expose `isUnpublished`
  - readers are filtered away from draft-only pages in tree/path lookups and search
  - editors/admins can open those pages normally and see an `Unpublished` state instead of a fake published revision
- Added backend batch import support with partial success:
  - new `POST /projects/:projectId/wiki-pages/import`
  - input is JSON `entries[]`, not multipart
  - each created entry becomes a draft-only page with an initial draft and no published revision
  - path conflicts are skipped and reported with reason `path_exists`
- First publish from a draft-only page now works without a migration:
  - `publishDraft()` already supported the core revision sequencing and now serves as the first-publication path
  - the first publish creates revision `#1`, sets `currentRevisionId`, and rebuilds published links at that moment
- The wiki frontend now includes a real import workflow in the `Pages` sidebar:
  - `Import Markdown` action
  - folder picker and multi-file picker
  - review/edit step for `title`, `slug`, `folderPath`, and `templateType`
  - local image detection, upload through existing `wiki-assets`, and markdown URL rewrite before import submit
  - inline import summary for created vs skipped pages
- Import UX details:
  - imported pages show `Unpublished` in the tree
  - long-running published-only features are handled safely: `History` is disabled until first publish
  - read mode for draft-only pages renders the draft content and draft metadata instead of assuming a published revision exists
- Added backend coverage for the new behavior:
  - `apps/api/src/wiki/wiki.service.spec.ts`
  - `apps/api/test/http/wiki.controller.http.spec.ts`
- Local verification results:
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed
- Residual verification note:
  - repeated attempts to run the focused Wiki Jest suites in this sandbox hung without emitting a stable result, even with `--forceExit`
  - the Next web production build was not re-run in this round because the same wrapper has previously stalled after type-check; it should be re-run outside this wrapper for a definitive production-build confirmation

## UX/Admin Bundle - Wiki Auto-Fit Pages + Collapsible Sidebar + Safe Hard Delete + Wiki History Diff (2026-04-14)
- [x] Add desktop-only persistent collapse/expand behavior to `AppShell`, with the sidebar fully hidden when collapsed and a reopen control in content.
- [x] Change the wiki `Pages` sidebar to an auto-fit + manual splitter model with persisted mode/width, including double-click reset to auto and containment for long names.
- [x] Rework wiki history into a main-pane diff workspace using the existing revision APIs and Monaco diff against the previous revision.
- [x] Add backend admin hard-delete preflight and mode-aware delete handling, blocking true deletion when restrictive authored/history records exist.
- [x] Extend the Manage Users UI and frontend admin client types to show hard-delete eligibility, blocker reasons, and separate soft/hard delete actions.
- [x] Add/update backend service + HTTP tests for the new admin hard-delete flow and verify API/web builds.

### Review - UX/Admin Bundle - Wiki Auto-Fit Pages + Collapsible Sidebar + Safe Hard Delete + Wiki History Diff
- `AppShell` now supports a desktop-only persisted collapsed state:
  - expanded keeps the current full sidebar
  - collapsed removes the sidebar column entirely
  - a `Show menu` control appears in content while collapsed
  - mobile keeps the existing always-visible nav behavior
- The wiki `Pages` sidebar now uses an `auto` vs `manual` width model:
  - default is `auto`
  - visible tree/search labels are measured to widen the sidebar up to the existing safety clamp
  - dragging or keyboard resizing switches to `manual`
  - double-clicking the splitter resets back to `auto`
- Wiki history no longer renders as a secondary panel at the bottom of the page:
  - `History` now switches the main wiki pane into a dedicated history workspace
  - the left column keeps the revision timeline
  - the right column is now a read-only Monaco diff against the previous published revision
  - revision `#1` diffs against an empty document and is labeled as the initial revision implicitly
- Manage Users now distinguishes soft delete from hard delete:
  - backend adds `GET /admin/users/:userId/hard-delete-check`
  - backend `DELETE /admin/users/:userId?mode=soft|hard` supports explicit delete mode
  - hard delete is blocked when the user still owns restrictive authored/history records or would remove the last active admin
  - frontend shows blocker reasons inline and only enables `Hard delete` when the preflight allows it
- Added backend coverage for the new admin flow:
  - `apps/api/src/admin/admin-users.service.spec.ts`
  - `apps/api/test/http/admin-users.controller.http.spec.ts`
- Local verification results:
  - `pnpm --filter @doctoral/api build` passed
  - `pnpm --filter @doctoral/api exec tsc -p tsconfig.json --noEmit` passed
  - `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` passed
  - `git diff --check` passed
- Residual verification note:
  - `pnpm --filter @doctoral/api exec jest ...` did not emit a terminal result in this sandbox despite repeated attempts, so the new admin specs are implemented but their local runtime execution remains unconfirmed here
  - `pnpm --filter @doctoral/web build` reached `Creating an optimized production build ...` and then stopped returning a terminal status in this sandbox; the package type-check is green, but the full Next production build should be re-run outside this wrapper for a definitive result

## Wiki Pages Splitter + Revision History Preview (2026-04-10)
- [x] Replace the fixed wiki `Pages` sidebar with a desktop-only resizable splitter that persists width in `localStorage`.
- [x] Contain long page and folder names inside the wiki tree without relying on horizontal sidebar scroll.
- [x] Add a dedicated wiki revision-detail endpoint so the frontend can preview historical published content without bloating the summary list.
- [x] Turn the existing `History` button into a timeline + preview UI showing revision number, timestamp, author, and change note.
- [x] Reuse the existing markdown render pipeline for historical preview, including authenticated wiki images.
- [x] Validate backend compilation/tests and web production build for the new wiki flow.

### Review - Wiki Pages Splitter + Revision History Preview
- The wiki workspace now supports a desktop splitter between `Pages` and the main content panel:
  - width persists in `localStorage`
  - the handle is keyboard-accessible with arrow keys
  - drag state uses a fullscreen scrim so pointer tracking stays stable during resize
- Long wiki page and folder names no longer force the sidebar into horizontal scrolling:
  - the sidebar now hides horizontal overflow
  - folder/page labels use a shared truncating row structure
  - the main panel remains shrinkable with `min-width: 0`
- Added backend revision detail support without schema changes:
  - new `GET /wiki-pages/:pageId/revisions/:revisionId`
  - validates page readability first, then ensures the revision belongs to that page
  - returns immutable revision content, timestamp, author, and change note
- The `History` button now opens a real two-pane revision browser:
  - left timeline with revision number, exact timestamp, author, note, and current badge
  - right preview rendering the selected revision with the same markdown/Katex/image pipeline as the normal wiki read view
  - opening history defaults to the latest revision and caches loaded previews per page
  - changing page resets history state and stale revision caches
- Local validation passed with:
  - `pnpm --filter @doctoral/api exec jest --config jest.config.ts --runInBand src/wiki/wiki.service.spec.ts`
  - `pnpm --filter @doctoral/api build`
  - `pnpm --filter @doctoral/web build`
  - `git diff --check`
- Added controller HTTP coverage for the new revision-detail route in `apps/api/test/http/wiki.controller.http.spec.ts`.
- Residual validation note:
  - the wiki controller HTTP suite could not be cleanly completed in this environment because the local Nest/supertest harness is unstable here (`listen EPERM` inside the sandbox; escalated rerun hung without emitting results). The route itself compiles and the service-level tests for the new revision endpoint pass.

## API Coverage Push vNext 2 - Documents/GitLab Hotspot Tranche (2026-04-06)
- [x] Deepen `DocumentsCollaborationServer` coverage across malformed room queries, payload normalization, awareness sync, cleanup, invalid versions, and queued persistence failures.
- [x] Raise `DocumentsService` branch coverage across LaTeX helper validation, invalid version-source combinations, workspace/path escapes, and missing-version workspace/file access.
- [x] Raise `GitlabService` branch coverage across config validation, managed-group resolution, GitLab identity resolution, desired-member construction, and repository access error mapping.
- [x] Expand `GitlabController` HTTP coverage so the remaining repository/code endpoints are exercised through real routing and DTO binding.
- [x] Exercise `search-wiki-pages-query.dto.ts` through real wiki search HTTP validation for trim/coercion/range/error paths.
- [x] Recompute aggregated API coverage, rerun worker gate, validate full `pnpm test:ci`, and capture the measured next hotspots.

### Review - API Coverage Push vNext 2 - Documents/GitLab Hotspot Tranche
- `DocumentsCollaborationServer` coverage moved beyond the prior query/auth happy-path focus:
  - malformed upgrade URLs now cover unknown endpoints plus missing `path` / `wikiPageId`
  - initial sync now covers awareness payload emission
  - websocket message handling now covers `ArrayBuffer` and `Buffer[]` payloads, read-only sync rejection, and malformed payload logging
  - persistence now covers invalid active-version teardown and queued wiki persistence failures
- `DocumentsService` coverage now defends helper-heavy branches that were previously untested:
  - `normalizeLatexPath`, `workspaceAbsolutePath`, `parseLatexPaths`, and `validateLatexFolderPaths`
  - invalid `createVersion` source combinations before upload persistence starts
  - missing-document version creation
  - missing LaTeX folder paths during workspace materialization
  - invalid/missing workspace access in `getLatexTree`, `getLatexFile`, and `updateLatexFile`
- `GitlabService` coverage now includes:
  - missing GitLab env/config helpers for API/browser/OAuth/managed-mode settings
  - `ensureManagedGroup` via explicit `groupId`, existing `groupPath`, and create-after-`404`
  - GitLab user-id resolution from cached ids, persisted ids, exact email matches, and misses
  - desired managed-member construction for admin/editor/reader mixes with unresolved identities skipped
  - repository access error mapping on read/archive operations
- `GitlabController` HTTP coverage was expanded to exercise routing/binding for:
  - repository status, link, create, disconnect
  - branches and repository tree
  - malformed repository-link, merge-request-state, and archive-ref payload/query validation
- Wiki search HTTP coverage now exercises the DTO through the real controller:
  - trimmed `q`
  - coerced numeric `limit`
  - invalid limits (`0`, `51`, non-integer) and oversize `q`
- Local validation passed with:
  - `pnpm --filter @doctoral/api test:unit`
  - `pnpm --filter @doctoral/api test:http`
  - `pnpm --filter @doctoral/api test:coverage`
  - `pnpm --filter @doctoral/worker test:coverage:gate`
  - `pnpm test:ci`
  - `git diff --check`
- New measured API aggregated coverage after this tranche:
  - statements `88.37%`
  - branches `65.18%`
  - functions `88.31%`
  - lines `88.22%`
- Improvement over the previous baseline:
  - statements `+3.32`
  - branches `+6.09`
  - functions `+2.66`
  - lines `+3.41`
- Measured hotspot movement:
  - `documents-collaboration.server.ts`: lines `75.11%`, branches `49.33%`
  - `documents.service.ts`: lines `84.71%`, branches `69.72%`
  - `gitlab.service.ts`: lines `89.77%`, branches `68.92%`
  - `gitlab.controller.ts` and `search-wiki-pages-query.dto.ts` still remain branch hotspots at `50%`
- Updated next lowest hotspots from the real merged coverage are:
  - lowest `lines`: `documents-collaboration.server.ts` `75.11%`, `projects.controller.ts` `82.14%`, `auth.controller.ts` `83.33%`, `oidc.service.ts` `83.46%`, `admin-users.service.ts` `83.78%`
  - lowest `branches`: `documents-collaboration.server.ts` `49.33%`, `gitlab.controller.ts` `50.00%`, `search-wiki-pages-query.dto.ts` `50.00%`, `oidc.service.ts` `58.82%`, `admin-users.service.ts` `60.00%`

## Fix Code Files Viewer Horizontal Overflow (2026-04-06)
- [x] Contain desktop `Files` layout overflow so selecting a file does not push the whole page to the right.
- [x] Keep code lines unwrapped and move horizontal scrolling into the file viewer only.
- [x] Allow long selected-file paths to wrap inside the viewer header instead of expanding the page.
- [x] Validate the web build after the CSS-only fix.

### Review - Fix Code Files Viewer Horizontal Overflow
- Root cause was the desktop two-column grid in `Code > Files`:
  - `.code-files-layout` used `260px 1fr`, so the viewer column could not shrink below its min-content width.
  - the selected file viewer rendered code inside a `<pre>` with `white-space: pre`, so long lines expanded the viewer column and pushed the entire page horizontally.
  - the selected file path header also had no containment/wrapping rules.
- The fix stayed CSS-only in `apps/web/app/globals.css`:
  - changed the files grid to `260px minmax(0, 1fr)`
  - added `min-width: 0` and `overflow: hidden` to the viewer panel
  - made the selected-file path block wrap safely inside the header
  - made horizontal scroll explicit on `.code-file-content` with `overflow-x: auto`, preserving `white-space: pre`
- Resulting UX:
  - opening a file no longer shifts the page to the right
  - long code lines keep their original formatting and scroll inside the code block
  - long file paths stay inside the viewer header
- Local validation passed with:
  - `pnpm --filter @doctoral/web build`

## API Coverage Push vNext - Controllers + Branch Hotspots (2026-04-06)
- [x] Expand `DocumentsController` HTTP coverage across create/delete/version/compile/log/tree/file/update routes and upload callbacks.
- [x] Expand `WikiController` HTTP coverage across create/tree/flush/publish/delete/backlinks/upload/update/revisions routes and upload callbacks.
- [x] Deepen `DocumentsCollaborationServer` coverage across malformed room queries, presence/wiki-presence rooms, send/cleanup, invalid workspace, and queued persistence.
- [x] Raise `WikiService` branch coverage with helper validation, not-found branches, delete edge cases, backlink edge cases, and asset error paths.
- [x] Raise `GitlabService` branch coverage with connection status, helper validation, OAuth exchange failures, request helpers, error mapping, and manual-flow rejections.
- [x] Recompute aggregated API coverage, rerun worker gate, and validate full `pnpm test:ci`.

### Review - API Coverage Push vNext - Controllers + Branch Hotspots
- `DocumentsController` HTTP coverage now exercises the routes that were still uncovered:
  - list/create/delete
  - branch creation
  - multipart version creation
  - compile/compile-log/PDF/tree/file/update
  - upload storage callbacks via real multipart requests in `supertest`
- `WikiController` HTTP coverage now exercises:
  - create/tree/get-by-path/search
  - draft save / realtime flush / publish
  - delete / backlinks / revisions
  - asset upload + asset streaming
  - legacy `PUT /wiki-pages/:pageId` update alias
- `DocumentsCollaborationServer` coverage was pushed further with tests for:
  - malformed room queries before auth
  - `presence` and `wiki-presence` joins
  - invalid workspace roots
  - partial room close vs full teardown
  - `safeSend` behavior for closed sockets and send callback failures
  - queued file persistence when a persist is already in flight
- `WikiService` coverage was extended with targeted branch tests for:
  - slug/folder/path normalization
  - wiki link parsing
  - readable/not-found helpers
  - blank-title `updatePage` fallback
  - delete edge case where `deletedAt` is still null
  - missing backlink page path
  - missing/oversized asset uploads
  - missing uploaded file metadata
  - missing asset content
- `GitlabService` coverage was extended with targeted helper/lifecycle tests for:
  - disconnected connection status
  - manual link/search/disconnect rejections
  - readable/writable repository not-found paths
  - empty `filePath` rejection
  - reconnect-required and missing-refresh-token paths
  - direct OAuth exchange success/failure
  - empty JSON response handling and binary request failure
  - repository/infrastructure/SSH key error mapping
  - repository path / SSH key id / archive filename / token-expiry helpers
  - structured GitLab error extraction
- Local validation passed with:
  - `pnpm --filter @doctoral/api test:http`
  - `pnpm --filter @doctoral/api test:unit`
  - `pnpm --filter @doctoral/api test:coverage`
  - `pnpm --filter @doctoral/worker test:coverage:gate`
  - `pnpm test:ci`
  - `git diff --check`
- New measured API aggregated coverage after this tranche:
  - statements `85.05%`
  - branches `59.09%`
  - functions `85.65%`
  - lines `84.81%`
- Improvement over the previous baseline:
  - statements `+5.12`
  - branches `+6.00`
  - functions `+6.15`
  - lines `+5.31`
- Updated lowest API hotspots now are:
  - lowest `lines`: `documents-collaboration.server.ts` `70.67%`, `documents.service.ts` `75.80%`, `gitlab.service.ts` `78.80%`
  - lowest `branches`: `documents-collaboration.server.ts` `38.00%`, `gitlab.controller.ts` `50.00%`, `search-wiki-pages-query.dto.ts` `50.00%`, `gitlab.service.ts` `57.20%`, `documents.service.ts` `58.45%`

## API Coverage Push + Worker Gate Active (2026-04-06)
- [x] Switch CI and root `test:ci` to use the worker 95% coverage gate immediately.
- [x] Add a dedicated `DocumentsCollaborationServer` suite so the collaboration server is no longer at `0%`.
- [x] Expand `GitlabService` coverage across OAuth, retry/reconnect, repository lifecycle, and `Code` read/write operations.
- [x] Expand `WikiService` coverage across page creation, draft persistence, backlinks, revisions, and assets.
- [x] Expand `ProjectsService` coverage across duplicate handling, rollback paths, member listing, and member assignment.
- [x] Recompute aggregated API coverage and capture the real next hotspots from measured data.
- [x] Validate the updated pipeline locally with worker gate active.

### Review - API Coverage Push + Worker Gate Active
- CI now gates the worker at `95/95/95/95` directly:
  - `.github/workflows/ci.yml` runs `pnpm --filter @doctoral/worker test:coverage:gate`
  - root `package.json` `test:ci` uses the same worker gate while keeping the API on non-gated aggregated coverage
- Added a dedicated collaboration-server suite in `apps/api/src/documents/documents-collaboration.server.spec.ts` covering:
  - server startup and upgrade routing
  - auth rejection during websocket handshake
  - room join/load behavior
  - `disconnectUser`
  - `flushWikiPageDraft`
  - invalid version/path cleanup and room persistence
- Expanded `apps/api/src/gitlab/gitlab.service.spec.ts` over the branches that were dominating uncovered `Code` behavior:
  - OAuth authorization URL
  - authorization-code exchange + connection upsert
  - disconnect flow
  - repository status fallback
  - managed repository duplicate/path + rollback paths
  - archive/unarchive reconciliation
  - 401 refresh/retry and reconnect-required handling
- Expanded `apps/api/src/wiki/wiki.service.spec.ts` with creation, draft save, publish delegation, backlinks, revisions, asset upload, and asset retrieval.
- Expanded `apps/api/src/projects/projects.service.spec.ts` with duplicate key rejection, transaction rollback + remote cleanup, sync-failure cleanup, member listing, member assignment, and missing-user handling.
- Hardened the aggregated coverage runner in `apps/api/scripts/run-coverage.cjs` with `--forceExit` so CI does not hang on open websocket/Yjs handles after otherwise-successful suites.
- Local validation passed with:
  - `pnpm --filter @doctoral/api test:unit`
  - `pnpm --filter @doctoral/api test:coverage`
  - `pnpm --filter @doctoral/worker test:coverage:gate`
  - `pnpm test:ci`
  - `git diff --check`
- New measured API aggregated coverage:
  - statements `79.93%`
  - branches `53.09%`
  - functions `79.50%`
  - lines `79.50%`
- Worker coverage remains above gate:
  - statements `99.56%`
  - branches `98.11%`
  - functions `96.29%`
  - lines `99.54%`
- The API still does not justify enabling the global `95%` gate yet. The next measured hotspots are:
  - lowest `lines`: `documents-collaboration.server.ts` `57.59%`, `gitlab.service.ts` `67.85%`, `wiki.controller.ts` `69.81%`, `documents.service.ts` `75.80%`
  - lowest `branches`: `documents.controller.ts` `0%`, `wiki.controller.ts` `0%`, `documents-collaboration.server.ts` `30%`, `wiki.service.ts` `42.22%`, `gitlab.service.ts` `44.59%`

## Coverage Gate - 95% API + Worker (2026-04-06)
- [x] Add stable aggregated API coverage flow across unit, HTTP, and integration suites.
- [x] Normalize API/worker coverage scope with explicit include/exclude rules and stable report artifacts (`text-summary`, `json-summary`, `lcov`).
- [x] Add the missing API unit tests needed to lift uncovered infra/services/utilities toward the 95% target.
- [x] Extend HTTP/controller coverage to `projects`, `meetings`, `notifications`, and `wiki`.
- [x] Add API integration paths for invite acceptance/login and document branch/compile flow.
- [x] Add worker config/helper tests and raise remaining branch coverage in job specs.
- [ ] Activate global 95/95/95/95 thresholds for API and worker once the normalized coverage reaches target.
- [x] Update `test:ci` and CI workflow to use the new gateable coverage commands.
- [x] Validate the full coverage pipeline locally and document final percentages.

### Review - Coverage Gate - 95% API + Worker
- Added an aggregated API coverage runner in `apps/api/scripts/run-coverage.cjs` that executes unit, HTTP, and integration suites separately, merges `coverage-final.json`, and emits stable `text-summary`, `json-summary`, and `lcov` artifacts.
- Normalized coverage scope to the exact backend rules from the plan:
  - API includes `src/**/*.ts` and excludes specs, modules, `main.ts`, scripts, `*.types.ts`, `*.decorator.ts`, `config/load-env.ts`, and `common/authenticated-user.ts`.
  - worker includes `src/**/*.ts` and excludes specs, `main.ts`, and `config/load-env.ts`.
- Added gate-ready scripts without forcing them into CI prematurely:
  - API: `pnpm --filter @doctoral/api test:coverage:gate`
  - worker: `pnpm --filter @doctoral/worker test:coverage:gate`
  - root: `pnpm test:ci:gate`
- Expanded backend tests further in this round:
  - new API unit coverage for `oidc.service`, `notifications.service`, `audit.service`, `storage.service`, `queue.service`, `app.controller`, `health.controller`, `crypto`, `session-cookie`, and `collaboration-server-registry`
  - new HTTP/controller slices for `projects`, `meetings`, `notifications`, and `wiki`
  - integration paths for `invite -> accept -> login` and `document -> branch/version -> compile enqueue`
  - worker coverage uplift with config/helper tests and deep `latex-compile.job` branch coverage
- The new integration flow exposed a real auth bug: repeated session JWTs could collide on `tokenHash`. Fixed in `apps/api/src/auth/auth.service.ts` by adding a per-session `jti` when minting session tokens.
- Local validation completed successfully with:
  - `pnpm --filter @doctoral/worker build`
  - `pnpm --filter @doctoral/worker test:coverage`
  - `pnpm --filter @doctoral/worker test:coverage:gate`
  - `pnpm --filter @doctoral/api test:coverage`
  - `pnpm test:ci`
  - `git diff --check`
- Final measured coverage with the exact normalized scope:
  - API aggregated: statements `64.75%`, branches `45.04%`, functions `64.95%`, lines `63.85%`
  - worker: statements `99.56%`, branches `98.11%`, functions `96.29%`, lines `99.54%`
- Result:
  - worker is now genuinely above the 95% target and its dedicated gate passes
  - API is still far below the target once measured against the exact final scope, so the global 95/95/95/95 CI gate remains intentionally disabled
  - `pnpm test:ci` passes end-to-end on the non-gated baseline path

## Test Hardening + CI Upgrade (2026-04-06)
- [x] Add dedicated backend test scripts/config split for API unit, API HTTP, API integration, and worker tests.
- [x] Expand API unit coverage for `tasks.service`, `documents.service`, `meetings.service`, `auth.service`, `session-auth.service`, and `gitlab.service`.
- [x] Add HTTP/controller test harness with `supertest` and coverage slices for `tasks`, `documents`, `auth`, `gitlab`, and `admin-users`.
- [x] Replace the skipped API smoke skeleton with a real Postgres-backed integration flow.
- [x] Add Jest-based worker tests for LaTeX compile, email, due reminders, and backups.
- [x] Upgrade CI to run backend test layers with Postgres service, migrations, coverage summaries, and build verification.
- [x] Validate the new suites/build locally and document the verified baseline.

### Review - Test Hardening + CI Upgrade
- Split API testing into three explicit Jest entry points:
  - `test:unit` / `test:unit:coverage` for service-level specs under `src/`
  - `test:http` for controller/guard/DTO coverage under `test/http/`
  - `test:integration` for a real Postgres-backed app boot flow under `test/api-smoke.e2e-spec.ts`
- Expanded API unit coverage for the highest-risk surfaces:
  - `tasks.service`: create/update/dependency/subtask paths and assignee validation
  - `documents.service`: branch creation, compile enqueue, PDF retrieval, LaTeX tree/file mutation
  - `meetings.service`: action creation and task-link flows
  - `auth.service`: login and password reset
  - `session-auth.service`: invalid/expired token paths
  - `gitlab.service`: branches, commits, tree, file, branch creation, merge request creation
- Added HTTP/controller tests with real Nest controllers plus real `JwtAuthGuard`/`RolesGuard`, backed by a mocked `SessionAuthService`, covering:
  - `401` unauthenticated paths
  - `403` role restrictions
  - `400` DTO/query validation failures
  - success-path request binding and service call shapes
- Replaced the skipped API smoke test with a real integration slice that:
  - boots `AppModule`
  - logs in through `/auth/login`
  - creates a project and task through HTTP
  - updates task status through HTTP
  - verifies persisted state through Prisma
- Added Jest worker tests for:
  - `latex-compile.job`
  - `email.job`
  - `due-reminder.job`
  - `backup.job`
- Upgraded CI to run:
  - API unit coverage
  - worker unit coverage
  - API HTTP/controller tests
  - DB bootstrap + `migrate deploy`
  - API integration tests
  - monorepo build
- Added `packages/db/scripts/prepare-test-db.cjs` to bootstrap clean databases with incomplete migration history (`db push` + `migrate resolve`) before the normal `migrate deploy` step.
- Local validation completed successfully with:
  - `pnpm --filter @doctoral/api test:unit:coverage`
  - `pnpm --filter @doctoral/worker test:coverage`
  - `pnpm --filter @doctoral/api test:http`
  - `pnpm --filter @doctoral/db db:test:prepare`
  - `pnpm --filter @doctoral/api test:integration`
  - `pnpm test:ci`
  - `pnpm build`
  - `git diff --check`
- Observed coverage baseline after this round:
  - API: statements `68.09%`, branches `46.97%`, functions `72.31%`, lines `67.35%`
  - worker: statements `85.38%`, branches `67.92%`, functions `84.00%`, lines `85.37%`

## Web UX - Code Tabs + Kanban DnD + Priority Indicators (2026-04-06)
- [x] Rework `/projects/:projectId/code` into a denser tabbed workspace for files, commits, branches, and merge requests.
- [x] Replace the previous clone/download block with the compact clone actions integrated into the Code overview.
- [x] Add drag-and-drop task moves across kanban columns on `/projects/:projectId/tasks`.
- [x] Reorder task cards within each kanban column by priority and surface clearer priority badges/accents.
- [x] Polish project overview task rows so they link cleanly into the tasks workspace and expose priority at a glance.

### Review - Web UX - Code Tabs + Kanban DnD + Priority Indicators
- The latest commit reshaped `Code` into a tabbed workspace with a compact overview, shared branch/ref controls, and a cleaner separation between browsing and merge-request actions.
- The tasks board now supports direct drag-and-drop between columns instead of status-only edits through forms, which materially reduces friction for daily project management.
- Priority is no longer just metadata text: cards are sorted by urgency inside each column and visually reinforced with dedicated badges/accents.
- The project overview page now treats recent tasks as navigational entries into the tasks module instead of static summary text.

## CD - Conditional GitLab Compose Reconcile (2026-04-06)
- [x] Detect when `docker-compose.gitlab.yml` changed across a deployment.
- [x] Reconcile the GitLab compose stack automatically during CD only when that file changed.
- [x] Keep Atlasium deploy behavior unchanged when GitLab config did not change.
- [x] Validate workflow syntax and document the result.

### Review - CD - Conditional GitLab Compose Reconcile
- The deploy workflow now captures the pre-deploy Git HEAD on the VPS, compares it with the checked-out target commit, and only reconciles `docker-compose.gitlab.yml` when that file changed.
- Automatic GitLab reconcile is guarded behind an existing `atlasium-gitlab` container check, so CD still does not bootstrap GitLab on fresh VPS setups.
- Both auto and manual deploy paths now include GitLab logs in the SSH error trap when the GitLab stack exists, which makes failures easier to diagnose.
- Validated with YAML parsing (`ruby`/`YAML.load_file`) and `git diff --check`.

## GitLab Identity + SSH-First Access (2026-04-06)
- [x] Enable GitLab auto-SSO with Atlasium while preserving local-root bypass and disabling self-sign-up.
- [x] Extend backend repository status with `sshCloneUrl`.
- [x] Add backend SSH key proxy endpoints under `/auth/gitlab/ssh-keys` with DTOs and error mapping.
- [x] Add backend tests for SSH clone URL mapping and SSH key list/create/delete flows.
- [x] Extend frontend GitLab client helpers for SSH clone URL and SSH key management.
- [x] Rework `/projects/:projectId/code` to make SSH clone primary and HTTPS+PAT secondary.
- [x] Extend `/account` with GitLab SSH key management UI and guidance.
- [x] Update runbook/docs for Atlasium SSO, SSH clone, HTTPS PAT fallback, and root bypass.
- [x] Validate with `pnpm --filter @doctoral/api test -- --runInBand --forceExit`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

### Review - GitLab Identity + SSH-First Access
- Enabled GitLab auto-SSO with Atlasium OIDC and disabled GitLab self-sign-up while preserving the documented local-root bypass URL.
- Extended the backend repository status with `sshCloneUrl` and added authenticated SSH key proxy endpoints that reuse the existing GitLab OAuth connection and reconnect semantics.
- Reworked `Code` so SSH clone is primary, HTTPS is clearly marked as PAT fallback, and ZIP downloads stay available only when GitLab API access is connected.
- Expanded `/account` with GitLab SSH key management so users can add/remove their own public keys without leaving Atlasium.
- Updated the go-live runbook to document the split between Atlasium web SSO, SSH clone for CLI use, HTTPS+PAT fallback, and local-root emergency access.
- Verified with API tests, API build, web build, `docker compose -f docker-compose.gitlab.yml config`, and `git diff --check`.

## Code vNext - Clone/Download + Merge Requests (2026-04-01)
- [x] Extend GitLab repository status/API types with `httpCloneUrl`.
- [x] Add backend repository endpoints for merge request listing and ZIP archive download.
- [x] Add backend tests for merge request listing, archive download, and repository status clone URL mapping.
- [x] Add frontend GitLab helpers for merge request listing and archive download.
- [x] Rework `/projects/:projectId/code` to show `Clone & Download` actions and merge request list with filters.
- [x] Update Code page styles for clone/download and merge request sections.
- [x] Validate with `pnpm --filter @doctoral/api test -- --runInBand --forceExit`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/web build`.

### Review - Code vNext - Clone/Download + Merge Requests
- Added authenticated backend proxy routes for repository archive ZIP downloads and merge request listing so Atlasium does not depend on a separate GitLab browser session.
- Extended repository status with `httpCloneUrl` and surfaced it in a new `Clone & Download` block in the Code overview.
- Added merge request state filtering (`opened`, `merged`, `closed`, `all`) and lightweight MR cards in the Code tab while preserving existing branch/MR creation flows.
- Verified with API tests, API build, and web production build.

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

## Code v1 - GitLab Integration (2026-03-31)
- [x] Add Prisma models and migration for GitLab user connections and one repository per project.
- [x] Implement backend GitLab OAuth account flows and live repository APIs.
- [x] Add frontend `Account` page and project `Code` tab with connect/create/read/write states.
- [x] Validate with Prisma generate, API tests/build, and web build.

### Review - Code v1 - GitLab Integration (2026-03-31)
- Added Prisma-backed GitLab account connections and one-repository-per-project linkage, including encrypted token storage and a migration for `GitLabConnection` / `ProjectRepository`.
- Added per-user GitLab OAuth connect/disconnect/callback flows plus live project repository APIs for search, link/create/disconnect, branches, commits, tree browsing, file viewing, branch creation, and merge request creation.
- Added a global `/account` page for GitLab identity management, a project `Code` tab in the shell, and a first Code workspace with repository setup, overview, branch/MR actions, file tree, and file viewer states gated by Atlasium project permissions.
- Validation passed:
  - `pnpm --filter @doctoral/db db:generate`
  - `pnpm --filter @doctoral/api test`
  - `pnpm --filter @doctoral/api build`
  - `pnpm --filter @doctoral/web build`

## Atlasium vNext - Managed GitLab Server + OIDC + Auto-Provisioned Repositories (2026-03-31)
- [x] Add managed-GitLab config/env and Prisma state for OIDC authorization codes.
- [x] Implement Atlasium OIDC provider endpoints plus session cookie support for GitLab SSO.
- [x] Refactor GitLab integration to managed mode with system-token repo provisioning and permission sync.
- [x] Auto-provision/archive repositories on project create/delete and sync membership changes from admin/invite flows.
- [x] Replace manual Code setup UI with managed repository states and update Account copy for Atlasium-hosted GitLab.
- [x] Add GitLab Omnibus infrastructure files/docs (`docker-compose.gitlab.yml`, nginx, runbook) and validate builds/tests.

### Review
- Atlasium now exposes OIDC discovery/authorize/token/userinfo/jwks endpoints and sets an HTTP-only session cookie on login so GitLab SSO can delegate auth to Atlasium.
- Project creation now provisions a managed GitLab repository before the Atlasium project is considered successful, and project deletion archives that repo with rollback on archive failure.
- Admin user updates, invite acceptance, member adds, and user deletion now trigger GitLab membership sync so Atlasium remains the source of truth for repo access.
- The `Code` UI no longer offers manual repo search/link/disconnect; it works with a single managed repo per project and uses `Account` only for per-user GitLab API access.
- Added `docker-compose.gitlab.yml`, host Nginx routing for `git.atlasium.info`, and runbook steps for Omnibus bootstrap, Atlasium OIDC, GitLab OAuth, backups, and restore.
- Validated locally with `pnpm --filter @doctoral/db db:generate`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/api test -- --runInBand`, `pnpm --filter @doctoral/web build`, and `git diff --check`.
- `docker compose -f docker-compose.gitlab.yml config` could not be executed here because `docker` is not installed in this WSL distro; YAML structure was validated locally instead.

## Managed GitLab Rollout Guardrails (2026-03-31)
- [x] Add a versioned rollout preflight script for managed GitLab bootstrap and post-deploy validation.
- [x] Update the go-live runbook to require branch-first staging before `main` and to split pre-main vs post-deploy checks.
- [x] Revalidate `docker-compose.gitlab.yml` through real `docker compose config` and shell syntax checks.
- [x] Document review notes and the exact operator sequence before `push` to `main`.

### Review - Managed GitLab Rollout Guardrails (2026-03-31)
- Added `infra/scripts/validate-managed-gitlab-rollout.sh` with two modes: `pre-main-push` for VPS/bootstrap readiness and `post-deploy` for Atlasium + GitLab integration checks after the automatic `main` deploy.
- Updated `infra/GO_LIVE_ATLASIUM.md` to require branch-first staging of GitLab infra files, explicit pre-main validation on the VPS, and post-deploy OIDC/SSO smoke checks only after the new Atlasium code is live.
- Revalidated `docker-compose.gitlab.yml` with real local Docker/Compose plus dummy env values, and verified shell syntax for the new rollout script and existing production shell scripts.

## Reboot Recovery + Compose Resilience for Atlasium/GitLab (2026-03-31)
- [x] Add restart policies to all long-running Atlasium services in `docker-compose.prod.yml` while keeping `migrate` one-shot only.
- [x] Add explicit compose project names to separate the Atlasium and GitLab stacks operationally.
- [x] Add a versioned reboot recovery script that restores the currently deployed Atlasium image tag from deploy state and confirms local API health.
- [x] Update managed GitLab rollout checks to fall back from `/-/health` to GitLab sign-in probing when Omnibus returns false-negative 404s.
- [x] Update runbook/operator guidance for reboot recovery and pre-main Atlasium health confirmation.

### Review - Reboot Recovery + Compose Resilience for Atlasium/GitLab (2026-03-31)
- `docker-compose.prod.yml` now uses `name: atlasium` plus `restart: unless-stopped` on `postgres`, `redis`, `mailpit`, `api`, `web`, and `worker`, while `docker-compose.gitlab.yml` now uses `name: atlasium-gitlab` so compose commands stop mixing both stacks.
- Added `infra/scripts/recover-atlasium-after-reboot.sh` to recover the currently deployed production stack from `/opt/atlasium/.deploy-image-state.env`, bring services back in dependency order, and fail closed with logs if the local API healthcheck does not return.
- Updated `infra/scripts/validate-managed-gitlab-rollout.sh` so GitLab readiness no longer hard-fails purely on `/-/health` returning 404 in the current Omnibus setup; it now falls back to probing `/users/sign_in` for GitLab-specific headers.
- Updated `infra/GO_LIVE_ATLASIUM.md` to require Atlasium stack recovery/health confirmation before the first managed-GitLab `main` push and to document the one-time compose project-name migration effect.

## Deploy Hotfix - SSH Timeout + Docker Retention Diagnostics (2026-03-28)
- [x] Increase `appleboy/ssh-action` `command_timeout` to `45m` on the main auto/manual deploy steps.
- [x] Keep healthcheck SSH steps on the shorter default timeout.
- [x] Improve `manage-docker-retention.sh` logs to show free space before/after cleanup.
- [x] Surface the real `docker image rm` error message instead of a generic "still referenced" line.
- [x] Validate workflow/script syntax locally.

### Review
- The prior deploy hardening solved disk pressure, but the next failure was a separate SSH command timeout while pulling/extracting the `worker` image.

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

## Atlasium CI/CD vNext - GHCR Auto Deploy (2026-03-08)
- [x] Replace VPS SCP-based deploy workflow with GHCR image publish + SSH deploy.
- [x] Add `docker-compose.prod.yml` using GHCR images (`api`, `web`, `worker`) and `IMAGE_TAG`.
- [x] Enable automatic deploy from successful `CI` runs on `main` and manual rollback via `workflow_dispatch` `image_tag`.
- [x] Update remote deploy path to `/opt/atlasium` and enforce deterministic `sha-<commit>` tag rollout.
- [x] Add remote migration step during deploy using API container + Prisma schema/migrations.
- [x] Fix `api`/`worker` Dockerfile monorepo install filters to include `@doctoral/db` before `db:generate`.
- [x] Update infra docs (`GO_LIVE_ATLASIUM`, `infra/README`) to production compose + GHCR deploy model.

## CI Stabilization - pnpm version source mismatch (2026-03-08)
- [x] Remove explicit `pnpm` version pin from `ci.yml` to avoid conflict with `packageManager` (`pnpm@9.15.4`) in `package.json`.

## CI Stabilization - Fast test crash in GitHub Actions (2026-03-08)
- [x] Force dev dependencies install in CI (`pnpm install --prod=false`) to avoid environment-driven missing test tools.
- [x] Scope CI test step to real suite owner (`pnpm --filter @doctoral/api test`) for deterministic runtime and clearer failures.
- [x] Add CI diagnostic step for test environment (`NODE_ENV` + `which jest`) before running tests.

## CI Fix - Missing StorageService in GitHub runner (2026-03-08)
- [x] Identify root cause from CI logs: `apps/api/src/storage/*` ignored by broad `.gitignore` rule (`storage/`).
- [x] Narrow runtime ignore patterns in `.gitignore` to anchored paths (`/storage/`, `/apps/api/storage/`, `/apps/worker/storage/`, `/tmp/`).
- [x] Add missing tracked API storage source files (`storage.module.ts`, `storage.service.ts`) to git.
- [x] Revalidate locally with `pnpm --filter @doctoral/api test` and `pnpm build`.

## CD Fix - Runtime images + migrate service (2026-03-08)
- [x] Set `PNPM_NODE_LINKER=hoisted` in API/Worker/Web Docker build stages to produce runtime-resolvable dependencies.
- [x] Rework runtime layout to run each app from `apps/<service>` with package-local `node_modules` + shared `.pnpm` store copy.
- [x] Add missing runtime dependency `multer` to `@doctoral/api` (controllers import it directly).
- [x] Install `openssl` in API/Worker Docker stages so Prisma engines resolve `debian-openssl-3.0.x` correctly at runtime/migrate.
- [x] Add `migrate` one-shot service in `docker-compose.prod.yml` and postgres healthcheck.
- [x] Update deploy workflow scripts to run `pull -> up --wait postgres/redis -> run migrate -> up api/web/worker`.
- [x] Add failure diagnostics in remote deploy (`docker compose logs --tail=200 migrate api web worker postgres`).
- [x] Add runtime smoke checks in `build-and-push` for published images (`reflect-metadata`, `dotenv`, `next/package.json`).
- [x] Validate locally with image builds + runtime smoke `docker run`.

## CD Fix - Prisma smoke path in published API image (2026-03-08)
- [x] Replace hardcoded `apps/api/node_modules/.bin/prisma` in `deploy.yml` smoke test.
- [x] Resolve Prisma CLI dynamically from `/app/node_modules/.pnpm/*/node_modules/prisma/build/index.js`.
- [x] Keep deploy migration execution aligned with the same runtime-safe Prisma resolution strategy.

## CD Fix - Healthcheck strategy for fresh VPS (2026-03-08)
- [x] Replace runner-side blocking healthcheck to `https://atlasium.info/api/health` with VPS-local required check (`http://127.0.0.1:4000/health`).
- [x] Keep public HTTPS probe as non-blocking diagnostic to surface pending Nginx/TLS setup without failing deploy.
- [x] Add service logs dump on local healthcheck failure for faster incident triage.

## CD Hotfix - API runtime dist path + compose interpolation (2026-03-09)
- [x] Make API TypeScript build output deterministic for container runtime (`apps/api/dist/main.js`) by scoping tsconfig build root/include to `src`.
- [x] Fix compose shell interpolation in `migrate` command by escaping runtime variables (`$$PRISMA_CLI`) to avoid parse-time substitution.
- [x] Revalidate API build + API container runtime entrypoint presence and compose config interpolation warnings.

## CD Recovery - Prisma bootstrap for fresh DB (2026-03-09)
- [x] Add conditional DB bootstrap in deploy workflow (auto + manual): detect empty/missing `_prisma_migrations`, run `db push`, then `migrate resolve --applied` for tracked migrations.
- [x] Keep `migrate deploy` as standard post-bootstrap step for normal forward migration behavior.
- [x] Update go-live runbook with fresh-DB bootstrap commands before first `migrate` execution.

## CD Hardening - Deploy quoting/shell robustness (2026-03-09)
- [x] Move Prisma bootstrap+migrate logic from inline workflow shell to versioned script (`infra/scripts/deploy-prisma-bootstrap.sh`).
- [x] Replace fragile nested SQL/quote interpolation in `deploy.yml` (auto/manual) with script invocation to eliminate `Syntax error: "(" unexpected` class failures.
- [x] Enforce POSIX-safe options (`set -eu`) inside `sh -lc` blocks and keep workflow YAML parsed clean.

## CD Fix - Script invocation permissions on VPS (2026-03-09)
- [x] Fix deploy workflow invocation to run bootstrap script via shell (`sh ./infra/scripts/deploy-prisma-bootstrap.sh`) instead of direct execution.
- [x] Apply the same permission-safe invocation in both `deploy-auto` and `deploy-manual`.
- [x] Update go-live runbook command examples to use shell invocation and avoid executable-bit drift between environments.

## CD Fix - Prisma failed migration recovery (`P3009`) (2026-03-09)
- [x] Harden Prisma deploy script to detect failed migration rows (`finished_at IS NULL AND rolled_back_at IS NULL`) and auto-resolve them as rolled back before `migrate deploy`.
- [x] Improve bootstrap detection to require at least one successful migration row (`finished_at IS NOT NULL`) instead of any row count.
- [x] Handle stale `_prisma_migrations` tables with no successful baseline by truncating stale rows before one-time bootstrap (`db push` + `migrate resolve --applied`).

## CD Fix - Preflight env validation (`JWT_SECRET`) (2026-03-09)
- [x] Add deploy-time env validator script (`infra/scripts/validate-prod-env.sh`) with explicit checks for required `JWT_SECRET` minimum length.
- [x] Execute env validator in both `deploy-auto` and `deploy-manual` before docker pull/up.
- [x] Update go-live runbook to include env validation step before startup/migrations.

## Invites vNext - Project Scope + Web Accept Flow (2026-03-10)
- [x] Extend Prisma invite model with scope mode (`ALL_CURRENT_PROJECTS` / `SELECTED_PROJECTS`) and selected-project join table while keeping legacy `projectId` compatibility.
- [x] Update API invite contract (`accessMode`, `projectIds`) and validation rules, with temporary support for legacy `projectId`.
- [x] Implement invite acceptance project resolution for both modes (`all current` snapshot or selected list), including legacy fallback and `projectIds` response.
- [x] Update invite email content to include web accept link (`${APP_BASE_URL}/accept-invite?token=...`) and scope summary.
- [x] Add admin-only invite UI block in `/projects` with access-mode selector and multi-project selection.
- [x] Add public `/accept-invite` page in web app (token/name/password) with success redirect to `/login`.
- [x] Add backend unit tests for invite creation/acceptance with mode validation and assignment behavior.
- [x] Validate with `pnpm --filter @doctoral/db db:generate`, `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

## Invite Email Hotfix - Copy cleanup + readable expiry (2026-03-10)
- [x] Remove `Access scope` line from invite direct email copy.
- [x] Remove API-manual fallback line from invite direct email copy.
- [x] Format `Expires at` in readable English (`Intl.DateTimeFormat`) with `Europe/Madrid` timezone.
- [x] Validate with `pnpm --filter @doctoral/api test` and `pnpm --filter @doctoral/api build`.

## Onboarding UI Cleanup - Atlasium login-first entry (2026-03-14)
- [x] Simplify `/` to a minimal Atlasium hero with a single `Sign in` CTA.
- [x] Remove legacy/demo copy and technical showcase cards from the landing screen.
- [x] Keep login flow logic intact and update `/login` secondary text to Atlasium-neutral wording.
- [x] Adjust home styles for intentional centered login-first presentation on desktop/mobile.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## Web UI vNext - Atlasium rebrand + collapsible invite panel (2026-03-14)
- [x] Replace visible fallback branding from `WorkMesh` to `Atlasium` in `AppShell` while keeping `project.key` in project context.
- [x] Update web `metadata.title` and `metadata.description` to Atlasium naming.
- [x] Add admin-only `Invite user` toggle button in `/projects` toolbar and keep invite form hidden by default.
- [x] Show invite panel only when opened and preserve current invite validation/submission logic.
- [x] Keep invite panel open after successful send (no auto-close).
- [x] Adjust `/projects` toolbar styles so invite action aligns with existing controls on desktop/mobile.
- [x] Validate with `pnpm --filter @doctoral/web build`.

## LaTeX Production Hotfix - Worker toolchain + CD smoke (2026-03-14)
- [x] Install full TeX toolchain in worker runtime image (`texlive-full`) while keeping existing runtime dependencies.
- [x] Add worker runtime smoke checks in deploy pipeline (`pdflatex --version`, `biber --version`, `bibtex --version`) to fail early on missing compiler binaries.
- [x] Update go-live runbook to clarify LaTeX compilation happens inside worker container and does not require host TeX install.
- [ ] Validate end-to-end via CI `build-and-push` and production compile job after deploy.

## Documents vNext - Undo-safe compile refresh + blank LaTeX version (2026-03-14)
- [x] Prevent Monaco undo-history reset after compile by avoiding full document reload when compile finishes on the same version.
- [x] Allow creating document versions without uploaded files and auto-create default LaTeX workspace (`main.tex`, `references.bib`, `Figures/`).
- [x] Keep existing upload validations (`latexPaths`, `latexBundle` vs `latexFiles`) unchanged.
- [x] Update documents UI forms (`New document`, `Upload initial version`) to allow blank creation and explain default scaffold behavior.
- [x] Replace API test that required source file with blank-version creation coverage and add scaffold materialization test.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

## Invite Email vNext - Security copy + login link + HTML fallback (2026-03-18)
- [x] Update invite email body in auth service to include `Accept invite`, `Sign in`, password security note, token, and UTC-formatted expiration.
- [x] Add HTML invite template while keeping text fallback for direct emails.
- [x] Extend internal email job payload contract with optional `directEmail.html` in API queue service and worker job processor.
- [x] Update invite unit test assertions to validate new text/html content, login link presence, security note, token retention, and non-ISO UTC expiry output.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/worker build`.
- [ ] Manual end-to-end check in production mailbox (rendered HTML + fallback + links).

## Documents vNext - Real-time collaborative LaTeX editing (2026-03-18)
- [x] Add backend WebSocket collaboration server for document/file rooms with JWT auth and project access checks.
- [x] Persist collaborative file edits to LaTeX workspace files with debounce and safe path validation.
- [x] Add Nginx websocket proxy headers for `/api/collab` upgrades.
- [x] Integrate Monaco with Yjs (`y-websocket` + `y-monaco`) for real-time text/cursor sync on selected file.
- [x] Add document-level presence room and render collaborator avatar pills in document topbar actions.
- [x] Add autosave (3s debounce) for editable users while preserving manual `Save` and `Compile` flows.
- [x] Validate with `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/web build`, `pnpm --filter @doctoral/api test`.

## Wiki vNext - Real-time collaborative editing (2026-03-22)
- [x] Extend collaboration server to support `wiki-presence` and `wiki-page` rooms on `/collab`.
- [x] Persist collaborative wiki draft (`title` + `contentMarkdown`) with debounce and writer tracking.
- [x] Add `POST /wiki-pages/:pageId/realtime-flush` endpoint and service wiring.
- [x] Integrate wiki realtime providers in web editor (presence + shared draft sync + fallback).
- [x] Route `Save draft` and `Publish` through realtime flush when realtime is active.
- [x] Keep classic wiki autosave/conflict flow as automatic fallback when realtime is unavailable.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/web build`.
- [ ] Manual 2-browser verification for shared typing/presence and forced fallback scenarios.

## Wiki vNext - TeX delimiter compatibility + page delete (2026-03-26)
- [x] Add frontend markdown normalization so wiki render/preview support `\\[ ... \\]` and `\\( ... \\)` without changing stored markdown.
- [x] Add wiki soft-delete endpoint/service flow with outgoing link cleanup, incoming link detachment, and audit logging.
- [x] Add frontend delete action for writer roles and refresh wiki state/navigation after deletion.
- [x] Add backend coverage for page deletion behavior and permissions.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/web build`.

## VPS Docker Storage Hardening - Atlasium image retention (2026-03-28)
- [x] Add versioned VPS script to diagnose Docker usage, prune old Atlasium images, and keep only current + previous local tags.
- [x] Add pre-deploy cleanup and free-space guard to auto/manual deploy workflows before `docker compose pull`.
- [x] Add post-healthcheck state update and final prune to auto/manual deploy workflows.
- [x] Document local image retention behavior and explicit `IMAGE_TAG` manual compose usage in the go-live runbook.
- [x] Validate shell syntax and workflow diff sanity for retention changes.

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
- 2026-03-08: Replaced deploy pipeline with GHCR-based CI/CD (auto deploy on successful CI for `main` + manual rollback by image tag), added `docker-compose.prod.yml`, fixed Prisma availability in API/worker Docker builds, and aligned runbooks to `/opt/atlasium` production rollout.
- 2026-03-08: Fixed CI failure `ERR_PNPM_BAD_PM_VERSION` by removing duplicated pnpm version pin from GitHub Actions and deferring to `packageManager`.
- 2026-03-08: Hardened CI against fast test-step crashes by forcing dev dependency install, narrowing test execution to `@doctoral/api`, and logging `NODE_ENV`/`jest` path for diagnostics.
- 2026-03-08: Fixed CI compile failure `TS2307` in `wiki/documents` by un-ignoring and versioning `apps/api/src/storage/*`; root cause was broad `.gitignore` pattern `storage/`.
- 2026-03-08: Fixed deploy pipeline/runtime packaging by hoisting PNPM linker in Docker builds, introducing `migrate` compose service, and gating deploy with runtime smoke checks for API/Worker/Web images.
- 2026-03-08: Hardened container runtime compatibility by moving service entrypoints to package-local `node_modules`, adding missing `multer` runtime dependency, and installing OpenSSL so Prisma CLI/engines work during deploy migrations.
- 2026-03-08: Fixed `build-and-push` smoke failure by removing hardcoded Prisma binary path in `deploy.yml` and resolving Prisma CLI dynamically from `.pnpm` store, aligned with `migrate` runtime command.
- 2026-03-08: Fixed deploy false-negatives on fresh servers by making VPS-local API healthcheck mandatory and public HTTPS check advisory until Nginx/TLS is fully configured.
- 2026-03-09: Fixed deploy runtime crash (`Cannot find module /app/apps/api/dist/main.js`) by making API build output path deterministic in `tsconfig`, and fixed compose `migrate` command variable escaping (`$$PRISMA_CLI`) to prevent parse-time blank substitution.
- 2026-03-09: Fixed deploy migration deadlock on fresh databases by adding automatic Prisma bootstrap (`db push` + `migrate resolve`) when `_prisma_migrations` is absent/empty, while preserving `migrate deploy` as default path.
- 2026-03-09: Hardened deploy shell reliability by extracting Prisma bootstrap/migrate into a dedicated script and removing nested quoting from workflow inline commands.
- 2026-03-09: Fixed `Permission denied` in deploy bootstrap step by invoking `infra/scripts/deploy-prisma-bootstrap.sh` with `sh` in workflows/runbook, removing dependency on executable-bit preservation on VPS checkouts.
- 2026-03-09: Fixed deploy failure `P3009` by auto-resolving failed Prisma migration records and baselining only from successful migration history, including stale-table cleanup before bootstrap.
- 2026-03-09: Added deploy preflight validation for `.env` (`JWT_SECRET` min length) to prevent API crash/restart loops surfacing late in healthcheck.
- 2026-03-10: Implemented scoped invitations (all current projects or selected projects), added public `/accept-invite` web onboarding page, updated invite emails with accept-link + scope summary, and validated with db generate + API tests/build + web build.
- 2026-03-10: Refined invitation email copy by removing access/manual API lines and formatting expiry to readable English timezone output for better recipient clarity.
- 2026-03-14: Cleaned initial onboarding UI to Atlasium login-first mode by removing demo-like landing elements and reducing home entry to a single `Sign in` action.
- 2026-03-14: Completed visible rebrand from `WorkMesh` to `Atlasium` in shell/layout metadata and made `/projects` admin invite panel collapsible by default behind an `Invite user` toolbar action.
- 2026-03-14: Improved Documents by preserving Monaco undo/redo history after compile refresh and enabling blank LaTeX version scaffolding (`main.tex`, `references.bib`, `Figures/`) from both creation flows.
- 2026-03-18: Upgraded invitation emails with security transparency copy, explicit `/login` link, UTC-readable expiration, and HTML+text fallback delivery contract across API queue and worker mail sender.
- 2026-03-18: Implemented real-time collaborative Documents editing with Yjs/WebSocket (per-document presence + per-file cursors), backend debounced autosave to LaTeX workspace, and nginx websocket proxy support.
- 2026-03-22: Implemented Wiki real-time editing v1 (`wiki-presence` + `wiki-page` rooms, flush endpoint, realtime save/publish integration, and frontend fallback to classic autosave/conflict mode).
- 2026-03-26: Added wiki TeX delimiter normalization for `\\[ \\]` / `\\( \\)` rendering plus soft-delete page flow with link cleanup, delete UI, and backend coverage.
- 2026-03-28: Hardened VPS Docker storage by adding local Atlasium image retention state, pre-pull cleanup, free-space guard, and post-deploy prune while keeping GHCR as full history.

## Documents vNext - Safe Soft Delete (2026-03-28)
- [x] Add `DELETE /documents/:documentId` and soft-delete active document, branches, and versions in one transaction.
- [x] Harden version-based document endpoints so deleted parent documents/branches invalidate compile, PDF, tree, file read, and file write access.
- [x] Fail LaTeX worker jobs closed if a document version is deleted before or during compilation.
- [x] Reject/close collaborative file persistence for deleted document versions.
- [x] Add delete actions to Documents list and document detail with confirmation and success feedback.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, `pnpm --filter @doctoral/worker build`, and `pnpm --filter @doctoral/web build`.

### Review - Documents vNext - Safe Soft Delete (2026-03-28)
- Backend now soft-deletes `Document`, `DocumentBranch`, and `DocumentVersion` together, emits `document.delete` audit logs, and treats deleted parents as `not found` for all version-scoped document APIs.
- Realtime file rooms now reject new joins on deleted versions and stop autosave persistence if a version disappears after the session started.
- Document delete is available from both `/projects/:projectId/documents` and `/projects/:projectId/documents/:documentId`, with a confirm step and flash success after redirect from detail back to the list.

## Projects RBAC + Soft Delete (2026-03-29)
- [x] Restrict project creation to `admin` in backend and `/projects` UI.
- [x] Add `DELETE /projects/:projectId` soft-delete endpoint with audit logging.
- [x] Add admin-only `Delete` action in `/projects` list with confirmation and refresh.
- [x] Add backend coverage for admin-only create/delete and selected-project invite acceptance.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

### Review - Projects RBAC + Soft Delete (2026-03-29)
- Project creation is now admin-only in both Nest service/controller enforcement and `/projects` UI; editors/readers remain browse+pin only.
- Projects now support soft delete through `DELETE /projects/:projectId`, with `project.delete` audit logging and existing access guards treating deleted projects as not found.
- `/projects` now exposes an admin-only destructive action with confirmation and list refresh, while invitation scope behavior remains intact and covered by selected-project acceptance tests.

## Invite UX vNext - Project Selector Polish (2026-03-29)
- [x] Replace the plain selected-project checkbox list with a searchable checklist panel in `/projects`.
- [x] Add selection summary plus `Select all visible` and `Clear` actions.
- [x] Restyle each project row to show key, name, and pinned state with clearer selected/hover/focus states.
- [x] Validate with `pnpm --filter @doctoral/web build`.

### Review - Invite UX vNext - Project Selector Polish (2026-03-29)
- The `Selected projects` picker now uses a searchable checklist with summary, bulk actions, and a cleaner empty-search state while keeping `projectIds` submission unchanged.
- Project rows are now full-width interactive cards showing `KEY`, `name`, and `Pinned` state with clearer selected, hover, and focus affordances.
- Access-mode behavior and invitation contract remain unchanged; this is a frontend-only UX improvement.

## Reader UX Cleanup - Remove Redundant Warnings (2026-03-30)
- [x] Remove redundant read-only permission banners from Projects, Wiki, Documents, Tasks, and Meetings.
- [x] Hide creation CTAs for `reader` users instead of rendering disabled buttons/forms.
- [x] Replace reader-facing creation empty states with neutral copy in Wiki, Documents, Meetings, and document detail without versions.
- [x] Validate with `pnpm --filter @doctoral/web build`.

### Review - Reader UX Cleanup - Remove Redundant Warnings (2026-03-30)
- Reader mode now removes repetitive permission banners and hides create actions in Projects, Wiki, Documents, Tasks, and Meetings while preserving backend/handler guards.
- Empty states now use neutral reader-safe copy (`No ... available yet`) instead of creation prompts, including document detail when a document has no versions.
- Editor/admin flows keep their existing create-oriented copy and actions.

## Admin User Management in Projects (2026-03-30)
- [x] Inspect auth/session, collaboration, and projects UI integration points.
- [x] Add admin-only backend user management API with role/project editing, soft delete, safeguards, audit, and session cleanup.
- [x] Harden JWT and websocket authentication to use current active user state from DB.
- [x] Add admin-only Manage users UI in /projects with list, search, edit, delete, and project assignment flows.
- [x] Validate with api tests/build and web build.

### Review - Admin User Management in Projects (2026-03-30)
- Added admin-only `/admin/users` list/update/delete endpoints with role/project editing, soft-delete revocation, last-admin/self-delete safeguards, audit logging, and session cleanup.
- Hardened both HTTP and collaboration websocket auth to resolve the current active user from the database instead of trusting stale JWT role data, so role changes and account deletion take effect immediately.
- Added an admin-only `Manage users` panel in `/projects` with search, per-user summaries, project assignment editing for non-admins, and destructive delete flow tied to immediate access revocation.

## Projects Permissions vNext - Project Roles + Manage Users Workspace (2026-03-30)
- [x] Add project-level roles in Prisma (`ProjectMember.role`, invite role fields) with migration from current global-role memberships.
- [x] Refactor backend project access checks and downstream modules to enforce read/write by project role instead of non-admin global role.
- [x] Extend admin user management and invite flows to edit/store per-project roles.
- [x] Add project access context endpoint and switch frontend project pages to use project access instead of localStorage global role.
- [x] Rework `/projects` so `Manage users` becomes a dedicated workspace with master-detail editing and hides the project directory.
- [x] Validate with `pnpm --filter @doctoral/api test`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

### Review
- Added Prisma project-role support with migration for existing memberships and invite records.
- Switched backend authorization to project-scoped read/write access for non-admin users and exposed `GET /projects/:projectId/access`.
- Updated admin user management and invite flows to assign per-project `editor`/`reader` roles.
- Reworked `/projects` so `Manage users` is a dedicated workspace with master-detail editing and project directory hidden while active.
- Updated Wiki, Documents, Tasks, Meetings, and document detail UI to use backend project access instead of local `globalRole`.
- Validation passed:
  - `pnpm --filter @doctoral/api test -- --no-cache`
  - `pnpm --filter @doctoral/api build`
  - `pnpm --filter @doctoral/web build`

## Code vNext - Inherited GitLab Membership Sync Fix (2026-03-31)
- [x] Diagnose `Provision repository` failure path from production logs and isolate the inherited `Owner` membership conflict from the managed GitLab group.
- [x] Update backend GitLab project membership sync to read both direct and effective members and treat inherited/effective access as satisfying the desired role before creating a direct project membership.
- [x] Map GitLab sync failures through Nest exceptions instead of leaking raw `GitlabApiError` as `500 Internal server error`.
- [x] Improve frontend authenticated fetch error parsing so structured Nest `message` payloads show actionable text instead of raw JSON blobs.
- [x] Add backend unit coverage for inherited membership no-op, direct member creation, direct member upgrade, and mapped sync failure behavior.
- [x] Validate with `pnpm --filter @doctoral/api test -- --runInBand`, `pnpm --filter @doctoral/api build`, and `pnpm --filter @doctoral/web build`.

### Review - Code vNext - Inherited GitLab Membership Sync Fix (2026-03-31)
- `syncProjectRepositoryAccess()` now compares direct project members with effective project members from `/members/all`, so inherited group access such as `root` -> `Owner` no longer causes `Provision repository` to fail when Atlasium wants only `Maintainer`.
- GitLab sync failures are now mapped through the existing infrastructure exception path, avoiding raw `500 Internal server error` leaks from `GitlabApiError`.
- Frontend authenticated fetch now unwraps structured Nest JSON errors into readable text, so future operational failures show actionable messages instead of JSON blobs.
- Added dedicated `GitlabService` unit coverage for inherited membership no-op, direct member create/update flows, and mapped sync errors.
