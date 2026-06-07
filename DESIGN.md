# Atlasium Design Canon

## Purpose

`DESIGN.md` is the permanent source of truth for Atlasium brand, digital identity, UI/UX, visual system, and design verification. Read it before planning or making any change that touches product surfaces, navigation, copy, metadata, layout, CSS, components, visual assets, or user-facing state.

`tasks/LESSONS.md` stores implementation lessons and technical failure patterns. `tasks/TODO.md` stores active plans and review logs. Do not duplicate durable design rules there.

## Brand Identity

- Atlasium is the only active product brand. `WorkMesh`, `Doctoral OS`, and `Academic Slate` are historical names only and must not appear in active UI, metadata, deployment naming, or fallback copy.
- Treat Atlasium as a contemporary research institution: sober, rigorous, editorial, modern, and operational. It should not feel like a generic SaaS dashboard, launch landing page, old academic portal, or decorative corporate template.
- Preserve the living archive metaphor. UI decisions should reinforce document layers, tabs, indexes, margins, annotations, versions, provenance, references, Git history, publish states, and traceability.
- Product copy should be specific, operational, and grounded in live product state. Avoid generic slogans, fake testimonials, buzzword stacking, launch-copy, demo language, and invented metrics.
- In project context, the shell brand title may switch to `project.key`. The fallback outside project context, during token failure, or while loading is always `Atlasium`.

## Atlasium v2 Direction

- The next visual step is institutional editorial quality: precise, calm, archival, and premium without becoming decorative or marketing-led.
- Prefer structure over ornament. Use layered paper surfaces, index lines, small caps, restrained dividers, and provenance metadata to express the archive metaphor.
- Each screen should make its operational purpose obvious in the first viewport: current archive, current module, live state, available primary action, and the next useful surface below.
- Avoid same-looking panels. Repeated containers should still show hierarchy through density, border strength, metadata placement, and action grouping.
- A design pass is incomplete if it improves color but leaves scanning, truncation, loading states, focus, mobile layout, or action hierarchy unchanged.

## Atlasium v3 Archive Operating Workspace

- Atlasium v3 is an archive operating workspace, not a dashboard skin. Primary project surfaces should read as indexes, ledgers, work queues, document canvases, repository workbenches, and settings ledgers before they read as collections of cards.
- The default grouping tools are alignment, proximity, dividers, metadata strips, row rhythm, and local workspace headers. A bounded card or panel must earn its border by framing an actionable object, editor, modal, drawer, form, or independent repeated record.
- Public and auth pages should feel like institutional access points into a managed archive. They need a clear Atlasium mark, paper/index visual language, and direct access action; they should not become marketing pages, centered SaaS cards, or decorative hero compositions.
- `/projects` is an archive directory. It should prioritize searchable row-based project access, pinned state, role, recency, and admin actions. Creation, invitation, and user administration remain secondary surfaces opened by explicit intent.
- Project Overview is a command center. It should show attention, near-term work, equal module state, and recent provenance as operational queues and ledgers rather than a strip of static module cards.
- Dense module pages should preserve their workbench mechanics while reducing ornamental chrome. Sidebars become index rails, main panes become active work surfaces, and toolbars stay compact and local to the thing they act on.
- "Not vibe-coded" is a viewport-level quality bar: a screen should not reveal repeated card wrappers, colored icon boxes, decorative status dots, stacked pills, arbitrary side strips, glassy panels, hover lift, or generic dashboard composition when viewed at a glance.
- Drastic design work is allowed when it improves hierarchy and specificity, but it must keep product contracts stable: no backend/API/schema/auth/storage/realtime/PDF.js/Monaco/business workflow changes unless explicitly scoped.

## Visual System

- Use the existing token system in `apps/web/app/globals.css` as the source for color, spacing, radius, shadow, and semantic state styling.
- Default palette: graphite, amber, cool off-white, and warm paper surfaces.
- Use steel blue and mineral green only for functional states, previews, realtime, selected rows, information, and success indicators. Do not let blue become a competing brand palette.
- Typography:
  - `Source Serif 4` is for identity, editorial headings, and high-level section titles.
  - `Inter` is for operational UI, controls, forms, navigation, dense lists, tables, and repeated labels.
  - Monospace text is reserved for code, file paths, refs, clone URLs, IDs, logs, and technical previews.
- Radius and elevation stay restrained: prefer `--radius-sm` and `--radius-md`; avoid large rounded marketing cards. Shadows should be low and functional, not decorative.
- Motion must be short, subtle, and state-oriented. Keep `prefers-reduced-motion` support. Do not add bounce, rotation, broad glow, parallax, or attention-seeking animation.
- Forbidden decorative patterns: purple novelty gradients, sparkles, emojis-as-UI, orbs, bokeh, purely ornamental SVG art, random gradients, and page-wide visual effects.

## Anti-Vibe-Coded Canon

- Atlasium must look intentionally designed for a research archive, not statistically assembled from generic SaaS patterns. Every visible color, container, indicator, icon, and visual effect must either support the archive metaphor or communicate product state.
- Treat color as a limited shared budget. Amber is the Atlasium/archive signal; graphite and paper tones carry structure; blue, green, warning, and danger are functional states only. Do not add arbitrary accent colors to make local components look styled.
- Gradients are allowed only for paper/index texture, skeleton loading, selected/current rows, focus rings, previews, or state feedback. Do not use gradients as novelty decoration, especially purple/blue marketing gradients, broad dark glows, or page-wide effects.
- Cards and panels have different jobs. Panels group workflows; cards represent repeated actionable objects, dialogs, drawers, or framed tools. Passive information should usually be grouped with spacing, headings, dividers, and metadata rhythm instead of another box.
- Avoid cards inside cards. If a surface starts to look like nested filing containers, remove a wrapper, reduce border/elevation strength, or convert inner blocks into unframed rows.
- Status dots, side strips, badges, and pills must map to a named state, permission, role, count, priority, selection, or measurable fact. If the user cannot infer what changed or what action follows, use text or remove the indicator.
- Full-width amber top bars and local text tabs are not Atlasium archive signals. Entry surfaces should use a non-textual paper rule: a neutral divider with a short amber segment. Do not repeat the active module name as decorative local copy when the shell navigation already shows it.
- Never use emojis as interface icons, navigation, bullets, or status markers. Use the established `lucide-react` icon system and keep icon weight, size, and labels consistent.
- When auditing a design pass, check the whole viewport, not only isolated components. Repeated local accents can cancel each other out; a signal only works when the rest of the page is quiet.
- Maintain a rough 70/20/10 color balance: about 70% graphite, paper, and quiet neutral structure; about 20% supporting surface contrast; no more than about 10% amber, blue, green, warning, danger, or other attention color. Avoid "homogeneous goo" where similar tints of the same hue blur icons, cards, borders, and backgrounds together.
- Icons are not visual assets by default. Use them for actions, navigation, file type, wayfinding, state, or recognizably repeated module identity. Do not place generic informational icons inside colored rounded-square boxes just to make a card look designed.
- Keep a strict serif budget. `Source Serif 4` belongs to Atlasium identity, public/auth hero titles, and true high-level headings. Dense rows, compact panels, small cards, badges, metadata, toolbars, tabs, form labels, and operational counters should use `Inter` for scanning.
- Do not use glassmorphism as a style. Avoid frosted panels, translucent cards, noise/glass badges, and blur-led readability. `backdrop-filter` is allowed only as minimal separation behind modals or drawers, never as the main surface treatment.
- Motion should make state legible, not make components feel generated. Do not add hover lift, image zoom, slow appear animations, decorative transforms, or stacked animations. Spinner, skeleton, focus, and short hover/focus transitions are acceptable when they communicate state.
- Shadows should separate layers and overlays only. Do not use shadows to make buttons, cards, or icons look artificially premium when color, spacing, border, or typography would communicate the hierarchy more cleanly.

## Workspace Chrome

- The shell should read as product infrastructure: compact, sticky, high contrast, and durable. It must not compete with module content.
- Project context belongs in the shell brand and local module cockpit. Do not duplicate broad page headers above every route.
- Active navigation should be readable through shape, color, and position, not only text color. Horizontal overflow must remain usable on mobile.
- User/account utilities should feel persistent and quiet. Project exit stays clearly separated from account actions.
- Public and auth pages are access gates for an invited research workspace. They should show Atlasium identity and archive-document visual language without sales claims.

## Module Cockpit Anatomy

- Every module entry cockpit should contain, in order: module/archive identity, title, concise operational summary, live status/metrics, and primary or mode actions.
- Use shared cockpit primitives when possible. If a module needs custom markup, keep the same anatomy and class naming so CSS behavior stays consistent.
- Status pills and metrics must be factual. Avoid vanity counters, invented progress, or labels that cannot be derived from current state.
- Alerts belong near the action or surface they affect. Loading and empty states should reserve enough space to avoid layout jumps.
- Dense modules should keep secondary setup, clone, create, import, and long-form edit flows in drawers, modals, collapsible panels, or local sections.

## Dense Surface Rules

- Lists, trees, task cards, calendar cells, repository rows, and activity feeds should optimize scanning: title first, metadata second, state/action last.
- Use compact metadata rows for author, date, role, path, branch, status, counts, and provenance. Use monospace only for technical identifiers.
- Tables and repeated rows need stable hover/focus states, predictable hit targets, and clear selected/current states.
- Split panes, file trees, Monaco, PDF.js, Markdown previews, and calendars must keep local scroll and cannot expand the document horizontally.
- Long labels, paths, refs, emails, and titles must wrap or truncate inside their pane on desktop and mobile.

## Mobile Workspace Rules

- Mobile layouts stack by workflow priority: cockpit first, primary controls second, active content third, secondary lists/details after.
- Horizontal project navigation may scroll, but controls inside toolbars should wrap or become full-width groups rather than clipping.
- Drawers and long-form editors may become bottom sheets on small screens, with stable close and save actions.
- Splitter handles can be hidden on mobile only when panes stack and both panes remain reachable.
- Text inside buttons, badges, cards, tabs, and calendar cells must fit without overlap at common mobile widths.

## Mark And Assets

- Reuse `AtlasiumMark` for compact brand expression in shell, auth, invite, favicon-like, and small-space contexts.
- Do not introduce alternate marks, mascot-like elements, or unrelated icon sets without explicitly revisiting this design canon.
- Metadata, favicon, OpenGraph, Twitter card, manifest, and production browser titles must all identify Atlasium consistently.
- Public visual assets should use the same document/index/A motif and the same palette as `atlasium-icon.svg` and `atlasium-og.svg`.

## Shell And Navigation

- `AppShell` is a sticky horizontal topbar with brand, contextual navigation, project exit, and user utilities.
- Do not restore a global sidebar or persistent `AppShell` page headers. Each route owns its local title and entry surface.
- Top-level project navigation is: `Overview`, `Wiki`, `Documents`, `Code`, `Tasks`, `Meetings`.
- `Code` is a first-class project module with the same weight as `Wiki` and `Documents`.
- Personal account/settings surfaces stay out of project module navigation. Expose them through persistent user utilities.
- Use `fullWidth` only for dense workspaces that need local split views, file trees, or large editors.

## Workspace Patterns

- The first visible module surface should be an operational entry panel or cockpit. It should carry concise title, live state, and the primary action. Use `ArchiveEntryPanel` plus an archive-variant `WorkspaceHeader`/`ModuleCockpit` for the non-textual paper rule; do not use full-width amber top borders or duplicate module-name tabs as active styling.
- `/projects` prioritizes the project directory. Project creation, invites, and admin management stay secondary and intentionally opened.
- Project Overview is a command center: attention, near-term work, equal module state, and recent provenance from live local data. Avoid static module-description cards and decorative dashboards.
- Wiki is a knowledge hub: tree/search, draft/publish state, revisions, backlinks, Docs assignment/sync, Markdown rendering, and conflict actions should remain visible and traceable.
- Wiki reading and live-preview Markdown surfaces should read as white/paper document pages. Preformatted Markdown blocks should use light neutral surfaces with subtle borders; reserve dark code panels for dedicated code/log/editor tools, not document reading.
- Documents is an editor/archive workspace: keep LaTeX tree, Monaco, PDF.js preview, compile status, logs, and collaboration controls dense but locally scrollable.
- Code is a repository cockpit: keep repository/access metadata compact, split files/commits/branches/merge requests into tabs, and keep clone/setup details in drawers or modals.
- Code repository removal is an admin danger-zone workflow, not a primary cockpit action. It should live behind a calm `Manage repository` surface with factual preflight, explicit remote/archive effects, typed confirmation, and restrained danger styling.
- Tasks should prioritize board readability. Create/edit forms are collapsed by default, and task actions must support both visible and pointer-based workflows.
- Meetings should support list and calendar modes, structured Markdown sections, modal editing for long-form minutes, and explicit AI automation state/retry.
- Account/Admin surfaces should be quiet operational panels, not project modules.

## Repo `Docs/` Canon

- Repo `Docs/` means the `Docs/` folder inside a managed GitLab repository. It is not the Atlasium `Documents` module.
- Synchronized repo documentation uses two canonical branches:
  - `Docs/Research/` for academic, theoretical, methodological, scientific, and technical reference knowledge.
  - `Docs/Implementation/` for code architecture, implementation decisions, runtime behavior, integration notes, deployment, and engineering traceability.
- Wiki sync should expose those branches as first-class hierarchy: `Research` and `Implementation` are the primary categories, and repository identity is secondary inside each category.
- `README.md` or `index.md` inside either branch is the section overview. It should appear first and read as the branch index/overview rather than an ordinary alphabetic page.
- Legacy Markdown files directly under `Docs/` remain readable, but they are not the preferred structure. Atlasium should offer an explicit review/migration path instead of silently moving existing knowledge.
- New managed repositories should bootstrap an empty `Docs/Research/` and `Docs/Implementation/` structure plus root `AGENTS.md` guidance so Codex sessions generate documentation into the right branch by default.
- Codex-generated repo documentation should prefer concise Markdown pages with clear headings, stable filenames, relative links, citations/references where relevant, and no generated marketing copy.

## Components And States

- Prefer shared primitives from `apps/web/components/ui.tsx` before adding new ad hoc controls: `Button`, `IconButton`, `Panel`, `ArchiveEntryPanel`, `WorkspaceHeader`, `Alert`, `LoadingState`, `SkeletonBlock`, `EmptyState`, `Badge`, `Tabs`, `Modal`, and `ConfirmDialog`.
- Use `lucide-react` icons for icon buttons and familiar actions. Icon-only buttons need an accessible label and tooltip/title. Text buttons are for clear commands.
- Every async action needs visible state: disabled control, progress copy/spinner, and stable success/error feedback.
- Use `LoadingState`, `SkeletonBlock`, or reserved-size surfaces for data-heavy loading. Avoid alert-only loading that shifts layout.
- Empty states should explain the operational state and offer the next relevant action when one exists.
- Preserve keyboard and mobile access for every workflow. If an interaction has right-click, drag, hover, or split-pane behavior, provide a visible or keyboard path too.
- Inline styles are acceptable only for dynamic geometry or data-driven values such as splitter widths, tree indentation, collaborator colors, or context-menu coordinates.

## Layout And Responsiveness

- Dense workspaces must use `minmax(0, 1fr)`, `min-width: 0`, explicit local overflow, stable min heights, and mobile stacking.
- Sticky sidebars and workspaces must account for `--shell-topbar-height`.
- Long paths, names, refs, emails, and code must truncate or wrap inside their pane. They must not expand the page horizontally.
- Do not put UI cards inside UI cards. Panels can group a workflow; cards are for repeated items, dialogs, drawers, or framed tools.
- Keep text scale matched to context. Hero-scale type belongs only to public/auth identity surfaces, not dense dashboards or toolbars.

## Copy Rules

- Write concise operational copy. Prefer state and action over persuasion.
- Use `Atlasium` for product identity, `project archive` for project-scoped archival context, and `workspace` for active work surfaces.
- Avoid internal project-management terms in user-facing UI, including `tranche`, `demo`, `placeholder`, and implementation jargon.
- Use `meeting minutes` for the module and `minute` only when referring to a single record if the existing domain wording requires it. Prefer labels that read naturally: `New minutes`, `Create minutes`, `Delete minutes`.
- Button labels should be short and action-oriented. Do not include keyboard shortcuts in visible labels unless explicitly requested.

## Verification

Before shipping UI/design work:

- Run static audits for obsolete active branding (`WorkMesh`, `Doctoral OS`, `Academic Slate`), forbidden decorative language, dead links, missing CSS utilities, active full-width amber top bars, and duplicate module-name accent labels.
- Run type-check/build for affected packages, at minimum `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` and `pnpm --filter @doctoral/web build` for frontend work.
- Verify desktop and mobile layouts for public/auth, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, Meetings, and Account.
- Check topbar sticky behavior, active navigation, truncation, local scroll, dialogs/drawers, loading/empty/error states, focus outlines, and permission-gated actions.
- Preserve behavior while redesigning. Visual changes must not alter API contracts, auth behavior, persistence, realtime collaboration, splitters, PDF.js, Monaco, or business workflows.
