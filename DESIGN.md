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

- The first visible module surface should be an operational entry panel or cockpit. It should carry concise identity, live state, and the primary action. Use `.module-entry-panel` for the amber top accent and preserve `border-top-color: var(--brand)` if overriding border styles.
- `/projects` prioritizes the project directory. Project creation, invites, and admin management stay secondary and intentionally opened.
- Project Overview is a command center: attention, near-term work, equal module state, and recent provenance from live local data. Avoid static module-description cards and decorative dashboards.
- Wiki is a knowledge hub: tree/search, draft/publish state, revisions, backlinks, Docs assignment/sync, Markdown rendering, and conflict actions should remain visible and traceable.
- Documents is an editor/archive workspace: keep LaTeX tree, Monaco, PDF.js preview, compile status, logs, and collaboration controls dense but locally scrollable.
- Code is a repository cockpit: keep repository/access metadata compact, split files/commits/branches/merge requests into tabs, and keep clone/setup details in drawers or modals.
- Tasks should prioritize board readability. Create/edit forms are collapsed by default, and task actions must support both visible and pointer-based workflows.
- Meetings should support list and calendar modes, structured Markdown sections, modal editing for long-form minutes, and explicit AI automation state/retry.
- Account/Admin surfaces should be quiet operational panels, not project modules.

## Components And States

- Prefer shared primitives from `apps/web/components/ui.tsx` before adding new ad hoc controls: `Button`, `IconButton`, `Panel`, `Alert`, `LoadingState`, `SkeletonBlock`, `EmptyState`, `Badge`, `Tabs`, `Modal`, and `ConfirmDialog`.
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

- Run static audits for obsolete active branding (`WorkMesh`, `Doctoral OS`, `Academic Slate`), forbidden decorative language, dead links, missing CSS utilities, and `module-entry-panel` accent ownership.
- Run type-check/build for affected packages, at minimum `pnpm --filter @doctoral/web exec tsc -p tsconfig.json --noEmit` and `pnpm --filter @doctoral/web build` for frontend work.
- Verify desktop and mobile layouts for public/auth, `/projects`, project Overview, Wiki, Documents library/detail, Code, Tasks, Meetings, and Account.
- Check topbar sticky behavior, active navigation, truncation, local scroll, dialogs/drawers, loading/empty/error states, focus outlines, and permission-gated actions.
- Preserve behavior while redesigning. Visual changes must not alter API contracts, auth behavior, persistence, realtime collaboration, splitters, PDF.js, Monaco, or business workflows.
