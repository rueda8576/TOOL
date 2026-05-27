# Lessons Learned

## Environment loading
- Do not assume users will `source .env` in every new shell before running `pnpm dev`.
- For runtime-critical variables (e.g., `DATABASE_URL` for Prisma), load `.env` programmatically at process startup.
- Apply the same env-loading pattern to all entrypoints (`api main`, `worker main`, and maintenance scripts like `seed-admin`) to avoid inconsistent behavior.

## Project navigation
- Do not hardcode placeholder project identifiers (e.g., `demo`) in production navigation links.
- Shared layout components must receive active route context (like `projectId`) so links target real resources.
- When a route depends on project context, hide or disable those links outside project-scoped pages.
- Keep personal account/settings surfaces out of project module navigation; expose them through persistent user utilities so opening settings does not feel like leaving the active project.
- When repository work is a core product surface, treat `Code` as a first-class project module with the same navigation and overview weight as `Wiki` and `Documents`.

## UI consistency
- When fixing a user-facing label issue in one project tab, apply the same fix across equivalent tabs to avoid inconsistent UX.
- Prefer shared UI components for repeated project-context text (e.g., project header subtitle) to prevent drift.
- Keep action button labels concise; do not append keyboard shortcut hints in the visible label unless explicitly requested.
- Do not split a dense technical settings workflow into competing nested cards inside a narrow secondary column. If a section combines long labels, action buttons, and optional detail, merge the related controls into one coherent panel and collapse heavy forms by default.
- When adding shared visual accent classes, audit later page-specific shorthand rules like `border-color`; they can silently override one side of the shared accent through CSS cascade.

## Anti-vibe-coded product quality
- Avoid novelty-first UI: no random purple gradients, sparkles, emojis-as-UI, fake testimonials, decorative social links, or generic launch-copy.
- Consistency is the premium signal: use one spacing scale, one radius scale, one elevation model, one icon system, and shared components instead of page-specific visual improvisation.
- Motion must be functional and subtle; avoid bounce, rotation, aggressive card lift, glow, and page-wide animation unless it directly communicates product state.
- Every async action needs visible state: disabled controls, progress labels or spinners, and stable loading/empty/error surfaces.
- Prefer skeletons or reserved-size loading surfaces for data-heavy modules instead of alert text that shifts layout.
- Treat metadata as product surface: title, description, favicon/icon, OpenGraph, and Twitter metadata must be intentional and Atlasium-specific.
- Keep copy operational and specific to Atlasium; avoid generic slogans, buzzword stacking, placeholder/demo language, and vague value claims.
- Before shipping UI, audit mobile layout, button/link behavior, placeholder text, dead links, visual rhythm, spacing, radii, and motion restraint.

## Collaboration preferences
- After every implemented change, always provide the user with the exact commit message to use.
- Commit messages must use the conventional `type(scope): subject` format, not a free-form sentence.
- When adding a new file to a package with a coverage gate, run the exact coverage gate locally, not only the focused spec/type-check/build; `collectCoverageFrom` can fail CI even when every test passes.

## Tasks UX defaults
- Task boards should prioritize reading state first: keep create/edit forms collapsed by default and open them explicitly via actions like `New task` or `Edit`.
- For task actions, always provide both desktop and accessible paths (`right-click` context menu plus visible button trigger) so mobile and non-mouse workflows are covered.
- When exposing assignee in cards, keep API and UI aligned with both `assigneeId` (compatibility) and denormalized assignee identity (`name`, `email`) for immediate clarity.
- In kanban-style task boards, sorting cards by priority inside each status column makes urgency visible without adding another view or filter step.
- If drag-and-drop is added to a task board, keep the interaction optimistic but bounded to the status change itself; the column should remain readable even before the server round-trip completes.

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
- In grid/flex workspaces that render code or file paths, make shrinkable panes explicit with `minmax(0, 1fr)` on grid tracks and `min-width: 0` on the content panel; otherwise long `pre/code` content can expand the whole page instead of staying inside a local scroller.
- In desktop workspaces with navigation trees (`Pages`, file trees, etc.), do not rely on horizontal scrolling to survive long labels; pair a resizable sidebar with truncation and overflow containment so navigation stays stable while the main panel remains readable.
- In dense technical modules like `Code`, keep repository/access metadata in a compact cockpit and move clone/setup details into a drawer or modal so the primary workspace remains above the fold.

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
- In Monaco-controlled editors, avoid full data reloads after compile/status refresh on the same document version; resetting the controlled `value` can wipe undo/redo history and break `Ctrl/Cmd+Z`.

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
- In dense project workspaces like `Code`, split distinct repository activities (`files`, `commits`, `branches`, `merge requests`) into tabs with shared controls instead of stacking every panel vertically; this keeps navigation fast without hiding functionality.

## Project home dashboard
- The `/projects/:projectId` landing page should surface live, cross-module signals (recent documents, in-progress tasks, current-month meetings) rather than static module descriptions.
- Reuse existing module data contracts in dashboard widgets instead of introducing one-off backend endpoints until aggregation/performance needs justify it.
- When a dashboard widget links into a module with preselected state, pass explicit query params (`view`, `date`, `month`) and make the target page initialize from them defensively.
- For dense project overview pages, prefer a command-center model over a card directory: show attention, near-term work, equal module state, and provenance from one curated backend response.
- Overview aggregation should stay local-data based and avoid live external service calls; deeper freshness belongs in the owning module workspace.

## Wiki knowledge hub
- When APIs use bearer-token auth, markdown `<img src="/api/...">` links will not automatically include auth headers; render protected images through an authenticated fetch-to-blob component instead of plain image tags.
- For collaborative wiki editing, keep draft writes optimistic (`baseDraftVersion`) and expose explicit conflict actions (`reload`, `copy local`, `retry`) in UI rather than silently overwriting shared drafts.
- For markdown math in a ReactMarkdown pipeline, add `remark-math` + `rehype-katex` and load KaTeX CSS globally; `remark-gfm` alone does not render `$$...$$`.
- For wiki search at project scope, backend full-text (`websearch_to_tsquery` + `ts_rank_cd`) gives better relevance than client title/path filtering, and role checks must gate draft content visibility.
- If immutable wiki revisions already store author and timestamp, expose a dedicated revision-detail endpoint for history preview rather than overloading the revision summary list with full markdown content.

## Branding consistency
- Avoid demo-like descriptive copy in production headers; project headers should prioritize concise identity context (e.g., `KEY - Name`) over marketing text.
- Keep product naming aligned across visible UI brand labels and metadata title to avoid split identity between sidebar and browser tab.
- In project-scoped navigation, the sidebar brand can switch from global product name to operational project identifier (`project.key`) while preserving a stable fallback (`WorkMesh`) when context/token fetch fails.
- Keep deployment naming consistent end-to-end (`/opt/<brand>`, `/var/lib/<brand>/storage`, nginx site name) to avoid mixed legacy identifiers during infrastructure migration.

## Atlasium visual identity
- Treat Atlasium as a contemporary institution: sober, rigorous, editorial, and modern rather than generic SaaS, flat corporate dashboard, or old academic portal.
- Preserve the "living archive" visual metaphor: document layers, tabs, indexes, margins, annotations, versions, provenance, and traceability should guide UI/UX decisions.
- Use the graphite + amber identity as the default palette, with cool off-white backgrounds and steel blue/mineral green only as functional support colors.
- Keep `Source Serif 4` for editorial/identity moments and `Inter` for operational UI, forms, navigation, tables, and repeated controls.
- Reuse `AtlasiumMark` for compact brand expression in sidebar, auth, favicon-like, and small-space contexts; do not introduce alternate marks without explicitly revisiting the identity.
- Avoid decorative gradients, orb/bokeh backgrounds, and visual effects that weaken the living-archive identity or reduce operational clarity.
- Future redesigns should preserve these identity tokens and criteria unless the user explicitly decides to change Atlasium's visual identity.

## Monorepo Docker builds
- In multi-stage Dockerfiles for PNPM workspaces, do not assume copying only root `node_modules` is enough for build scripts; ensure filtered dependencies are installed in the build stage before running `pnpm --filter <pkg> build` to avoid missing local binaries like `tsc`.
- If a workspace package executes another workspace script at build time (e.g., `@doctoral/api` or `@doctoral/worker` calling `@doctoral/db db:generate`), include both filters in install steps (`--filter <service>... --filter @doctoral/db...`) so CLI binaries like `prisma` are available.

## CI/CD deployment model
- Prefer registry-based deploys (GHCR images + immutable `sha-*` tags) over SCP-ing source code and rebuilding on VPS; it is more deterministic and avoids server-specific build drift.
- For automatic promotion to production, trigger deploy from successful CI completion (`workflow_run`) on `main` so CD cannot bypass failed tests/builds.
- For `workflow_run` promotion checkouts, make the checkout explicit (`repository`, `ref`, `token`) and validate `HEAD` against `workflow_run.head_sha` before publishing images; implicit checkout defaults can fail authentication or fetch the wrong source.
- In containerized deploy pipelines, run migrations from a container that contains the Prisma schema/migrations artifacts, not from ad-hoc host state.
- In GitHub Actions, do not pin `pnpm/action-setup` version if `package.json` already defines `packageManager`; duplicate version sources can fail CI with `ERR_PNPM_BAD_PM_VERSION`.
- In CI, force install of dev dependencies (`pnpm install --prod=false`) before running tests to avoid hidden `NODE_ENV=production` behavior that drops tools like `jest`.
- Prefer explicit test target in monorepos (`pnpm --filter @doctoral/api test`) when only one package owns real test suites; it reduces noise and makes failures easier to diagnose.
- Avoid broad `.gitignore` folder patterns like `storage/` in monorepos; they can unintentionally ignore source folders such as `apps/api/src/storage`, causing CI-only compile failures.
- In PNPM monorepo Docker runtime images, `node-linker=isolated` plus filtered installs can leave runtime containers without resolvable top-level modules; set Docker build stages to `PNPM_NODE_LINKER=hoisted` (or use `pnpm deploy`) and verify runtime with `docker run node -e "require(...)"`.
- For CD on containerized stacks, run migrations via a dedicated one-shot compose service (`migrate`) instead of piggybacking app service commands; it keeps deploy order explicit and prevents hidden runtime coupling.
- If runtime starts from compiled files under `apps/<service>/dist`, keep module resolution anchored to package-local `apps/<service>/node_modules` (and shared `.pnpm` store) instead of flattening to `/app/dist`.
- In Debian/Node 22 containers using Prisma 5, install `openssl` in build/runtime stages so Prisma generates and runs `debian-openssl-3.0.x` engines; otherwise `migrate deploy` can fail at runtime with `libssl.so.1.1` errors.
- In runtime smoke/deploy scripts, do not hardcode Prisma at `apps/api/node_modules/.bin/prisma`; container layouts vary in monorepos, so resolve Prisma CLI dynamically from the `.pnpm` store (or run through a dedicated migrate service command).
- In CI/CD healthchecks for new VPS environments, make container-local API health mandatory (`127.0.0.1:4000/health`) and treat public HTTPS checks as a separate probe; otherwise deploys fail due to pending Nginx/TLS rather than app health.
- If worker jobs spawn system binaries (for example `pdflatex`, `biber`, `bibtex`), those tools must be installed inside the worker runtime image; do not assume host-level packages are available.
- Add runtime smoke checks for critical worker binaries in CI image validation so missing compilers fail `build-and-push` before deployment.
- For production container entrypoints, ensure TypeScript build output path is deterministic from clean checkout builds (avoid relying on stale local `dist` artifacts). Align `tsconfig` `rootDir/include` with intended runtime file path.
- In `docker-compose` command strings, escape shell variables as `$$VAR`; otherwise Compose interpolates `$VAR` at parse-time and can silently pass empty values to runtime commands.
- If migration history is incomplete (no initial migration in repo), `migrate deploy` on a fresh DB can hard-fail; deploy pipelines need a one-time bootstrap path that initializes schema (`db push`) and baselines `_prisma_migrations` (`migrate resolve`) before normal migrations.
- Treat `_prisma_migrations` rows with `finished_at IS NULL AND rolled_back_at IS NULL` as failed state, not valid baseline; resolve them (`migrate resolve --rolled-back`) before running `migrate deploy` or bootstrap logic.
- Baseline detection must require at least one successful migration row (`finished_at IS NOT NULL`), not just table existence or row count, otherwise `P3009` can recur forever on fresh environments.
- For long multi-layer deploy commands (GitHub Actions YAML -> SSH shell -> Docker shell -> SQL), avoid inline nested quoting entirely; move logic into a versioned script on the repo and invoke it from the workflow.
- In SSH-based deploys, invoke repo scripts with `sh <script>` (or enforce `chmod +x` explicitly in deploy) because executable bits can be lost or inconsistent across server checkouts and cause `Permission denied`.
- Add deploy preflight validation for critical env vars (at minimum `JWT_SECRET` length) before `docker compose up`; otherwise failures appear later as healthcheck flakiness while API is actually crashing on config parsing.
- For large runtime images pulled through `appleboy/ssh-action`, set an explicit `command_timeout`; the default `10m` can kill a healthy deploy during `docker compose pull` and layer extraction.
- Retention/cleanup scripts must not suppress `docker image rm` stderr entirely; surface Docker's real conflict message or deploy diagnostics become misleading.

## Realtime collaboration resilience
- In browser code, never call `new URL()` with potentially relative API bases (`/api`) unless you pass `window.location.origin` as the base; otherwise client render can crash with `TypeError: Invalid URL`.
- Collaboration features must degrade safely: if realtime URL resolution or websocket setup fails, keep local editor/file loading/save/compile paths operational and surface a non-blocking status message.

## Docker disk diagnostics
- When diagnosing Docker disk pressure on a VPS, do not rely on `df --total` because overlay mounts inflate the apparent total usage; inspect `docker info` for `Docker Root Dir` and use `docker system df -v` to identify reclaimable images and build cache before proposing storage expansion.

## Multi-compose VPS operations
- When introducing a second Docker Compose stack on the same VPS, always set an explicit top-level compose `name:` for each stack; otherwise `docker compose ps/logs/up` can mix unrelated services via the default project name.
- Long-running production services in compose files must declare `restart: unless-stopped` so a VPS reboot does not silently leave the primary application down while auxiliary stacks recover.
- If deploy state records the active immutable image tag, provide a versioned recovery path/script that reads that state instead of restarting production implicitly on `:main`.

## Managed GitLab sync
- For GitLab endpoints that encode the binary format in the URL (for example `/repository/archive.zip`), prefer a neutral `Accept: */*` unless the endpoint explicitly requires stricter content negotiation.
- If a production GitLab archive download keeps failing after header negotiation fixes, do not keep guessing from the UI; add API-side diagnostics with upstream request ids, resolve branch refs to commit SHAs, and provide bounded server-side fallbacks using already-working tree/raw APIs.
- In GitLab projects that inherit access from a managed parent group, do not blindly add or downgrade direct project memberships for users who already have sufficient inherited access; inspect `/members/all` and treat inherited/effective access as satisfying the desired role before issuing `POST`/`PUT`.
- When frontend API helpers surface Nest error responses, parse structured JSON `message` payloads instead of dumping the raw JSON string; otherwise operators lose the actionable GitLab error behind a generic blob.
- For Atlasium-managed GitLab, web SSO and CLI Git authentication are different surfaces: Atlasium OIDC should own GitLab web login, SSH keys remain the recommended CLI path, and HTTPS Basic Auth only works with a GitLab-local password or PAT.
- If Atlasium password login is accepted for GitLab HTTPS clone, implement it as an explicit password sync into the OIDC-linked GitLab user; OIDC web SSO alone cannot authenticate Git Smart HTTP Basic Auth prompts.
- Atlasium username is the source of truth for GitLab usernames and OIDC `preferred_username`; do not derive managed GitLab usernames from email local-parts except during one-time backfill/compatibility fallback.
- When validating GitLab Omniauth with `omniauth_auto_sign_in_with_provider`, do not require the visible provider label on `/users/sign_in`; GitLab can return a minimal auto-submit page that only references `/users/auth/openid_connect`.
- When signing RS256 OIDC tokens with Nest `JwtService` in a module that has a global `JWT_SECRET`, pass the RSA key as explicit `secret`; `privateKey` can be shadowed by the module-level secret and fail at runtime.
- For Atlasium-managed GitLab repository membership, resolve GitLab users by the Atlasium OIDC identity (`provider=openid_connect`, `extern_uid=User.id`), not by optional GitLab OAuth API connections; those connections can point to stale/admin accounts such as `root`.

## Account security
- For authenticated password changes that must preserve the current session, have `JwtAuthGuard` persist the validated bearer token onto the request and revoke all other sessions by comparing against that exact token hash; deleting sessions only by `userId` will accidentally sign out the user who initiated the password change.

## Admin destructive actions
- In systems with authored history and Prisma `onDelete: Restrict` relations, do not offer blind hard delete. Add a preflight endpoint that counts blockers and let the UI explain exactly why permanent deletion is blocked before the operator clicks.
- Keep soft delete and hard delete as separate explicit modes end-to-end (`UI`, client helper, controller, service, audit) so operators cannot confuse “revoke access” with “erase the account record”.

## Sidebar ergonomics
- For dense desktop navigation panes (`Pages`, app nav, file trees), do not force a single fixed-width strategy. Prefer an `auto-fit` width for readable labels plus a persisted manual override for users who want tighter or wider panes.
- If a desktop history/review workflow already has immutable revisions and Monaco is available, prefer a main-pane diff workspace over rendering history as a secondary panel below the primary content; the workflow stays focused and the changed lines become the primary artifact.

## Wiki publishing model
- If the wiki starts supporting draft-only pages (`currentRevisionId = null`), treat that as a first-class state across backend and frontend:
  - readers must be filtered away from unpublished pages in tree/search/path lookups
  - editors can open and edit them normally
  - UI that depends on published revisions (`History`, published metadata, revision badges) must degrade explicitly instead of assuming `published` is always present
- When that wiki contract changes, update existing specs and mocks in the same tranche:
  - tree expectations must include any new page-shape fields such as `isUnpublished`
  - read-access tests must mock whatever the current access helper now needs (`currentRevisionId`, `getProjectAccess`, etc.), not the previous helper contract

## Backend testing
- When production code starts reading additional `Response` fields, update low-level fetch mocks to satisfy the expanded response contract; otherwise tests can fail with mock-shape `TypeError`s before the intended error mapping is exercised.
- When expanding internal service return shapes that feed required Prisma fields, update integration mocks in the same change and add defensive normalization before database writes so stale partial mocks cannot create invalid required values.
- In PNPM workspace scripts, avoid relying on `pnpm run <script> -- --coverage ...` for Jest in CI; forwarded args can be treated as test patterns and produce `No tests found`. Prefer dedicated coverage scripts or `pnpm exec jest ...`.
- For Nest HTTP/controller tests that should exercise real auth/role wiring, keep the real `JwtAuthGuard` and `RolesGuard` in the module and mock `SessionAuthService.authenticateToken`; replacing the guard itself hides route metadata and role regressions.
- If Prisma migration history does not contain an initial baseline, backend integration CI on a fresh Postgres DB must bootstrap schema (`db push` + `migrate resolve`) before `migrate deploy`; otherwise e2e validation fails before the app even boots.
- When unit-testing worker jobs in a Prisma process, mock `child_process` partially with `jest.requireActual(...)` and override only `spawn`; replacing the whole module can break unrelated runtime imports that expect other `child_process` exports.
- When session JWTs are persisted via a unique `tokenHash`, include a per-session nonce such as `jti` in the signed payload; otherwise two logins within the same second can generate identical tokens and violate the unique constraint.
- Do not enable a global coverage threshold from a unit-only baseline. First measure merged unit + HTTP + integration coverage against the exact final include/exclude scope, then wire the gate only once the real aggregate numbers clear the target.
- If aggregated Jest coverage includes websocket/Yjs-heavy suites that leave open handles, make the coverage runner use `--forceExit` rather than letting CI hang after a green test pass. Fix cleanup where possible, but keep the pipeline deterministic.
- When testing retry helpers like `withUserAccessToken`, exercise the helper directly if a higher-level method maps `GitlabApiError` inside its callback; otherwise the retry branch can be hidden by the wrapper's error translation and the test will assert the wrong behavior.
- For controller branch coverage around `multer` storage callbacks, use real multipart `supertest` requests and clear the temp upload directory first; mocking decorators does not execute `destination`/`filename` branches.
- If production code checks `error instanceof GitlabApiError`, do not fake failures with plain objects in tests. Create the real error by driving `executeGitlabRequest`/`executeGitlabBinaryRequest` into failure and pass that caught error into the mapper.
- For DTO hotspots built from `class-transformer`/`class-validator`, cover them through real controller HTTP requests under the global `ValidationPipe`; direct DTO instantiation will not exercise trim/coercion/range branches that Istanbul attributes to the DTO file.
- When ranking Istanbul branch hotspots from `coverage-final.json`, remember `b` counters are arrays per branch arm; flatten them before computing percentages or files with nonzero branch coverage can be misread as `0%`.
- In websocket/Yjs-heavy collaboration tests, it is acceptable to hit private helpers through `as any` for protocol-shape branches such as query parsing, payload normalization, and queued persist states; re-implementing the full wire protocol often adds noise without increasing confidence.
- When GitHub Actions starts deprecating a JavaScript-action runtime, do not wait for every third-party action to publish a new major. Prefer replacing simple setup actions with first-party/runtime primitives (`corepack` for pnpm, shell setup, etc.) if that removes the runtime dependency cleanly.
- `actions/setup-node` with `cache: pnpm` assumes `pnpm` is already executable during that step. If pnpm is being bootstrapped later via Corepack, disable that built-in cache or move caching to a later step; otherwise CI fails before install with `Unable to locate executable file: pnpm`.
