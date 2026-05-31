# Atlasium

Atlasium is a doctoral research workspace for project knowledge, documents, managed code, meetings, tasks, and traceable collaboration. It combines a Next.js workbench, a NestJS API, a Prisma/PostgreSQL data model, BullMQ workers, GitLab integration, realtime editing, LaTeX/PDF tooling, and optional AI automation for extracting tasks from meeting minutes.

## Architecture

| Workspace | Responsibility | Local command |
| --- | --- | --- |
| `apps/web` | Next.js frontend for login, projects, wiki, documents, code, tasks, meetings, account settings, and admin surfaces. | `pnpm dev:web` |
| `apps/api` | NestJS REST API, auth/session handling, project access, realtime collaboration server, queues, storage, and GitLab/OIDC integration. | `pnpm dev` |
| `apps/worker` | BullMQ worker for LaTeX compilation, email notifications, reminders, backups, and AI meeting automation. | `pnpm dev:worker` |
| `packages/db` | Prisma schema, migrations, and generated client entrypoints. | `pnpm db:generate` |
| `packages/shared` | Shared TypeScript types and validation primitives. | `pnpm --filter @doctoral/shared build` |

Core runtime services are PostgreSQL, Redis, filesystem storage shared by the API and worker, and Mailpit for local email testing. Production runs container images from GHCR through Docker Compose.

## Features

- Project workspaces with members, roles, pinning, overview signals, soft deletion, and access checks.
- Wiki knowledge hub with drafts, publish workflow, Markdown import, full-text search, backlinks, assets, math rendering, internal `[[wiki-link]]` navigation, revisions, and realtime editing.
- Documents module for PDF/LaTeX archives, file tree editing, Monaco, PDF.js preview, compile logs, asynchronous LaTeX compilation, and realtime collaboration.
- Code module backed by managed GitLab repositories, including repository creation/linking, access sync, branches, commits, tree/file browsing, raw/image previews, ZIP downloads, and merge requests.
- Task board with priorities, dependencies, subtasks, assignees, completion tracking, and meeting provenance.
- Meeting minutes with structured sections, calendar/list views, actions, task linking, and optional OpenAI-powered task extraction.
- Account, admin, security, notification, GitLab SSH key, HTTPS clone password, and OIDC support.
- CI/CD pipeline with coverage gates, production image validation, Prisma migration deployment, and VPS health checks.

## Local Setup

Prerequisites:

- Node.js 22 LTS.
- Corepack with pnpm `9.15.4`.
- Docker Desktop or Docker Engine with Docker Compose.

Bootstrap:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate

cp .env.example .env
docker compose up -d postgres redis mailpit

pnpm install
pnpm db:generate
pnpm db:migrate

ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='change-me-now' pnpm --filter @doctoral/api seed:admin
```

Run the app in three terminals:

```bash
pnpm dev
pnpm dev:web
pnpm dev:worker
```

Local URLs:

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/health`
- Mailpit: `http://localhost:8025`

`pnpm dev` starts only the API. Keep the web and worker processes running separately when validating full workflows such as document compilation, email, reminders, backups, and AI meeting automation.

## Environment

Start from `.env.example`.

- Core local runtime: `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `APP_BASE_URL`, `API_PORT`, `WEB_PORT`, `NEXT_PUBLIC_API_BASE_URL`.
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- Storage: `STORAGE_ROOT`, `ATLASIUM_STORAGE_HOST_PATH`, `PDF_UPLOAD_LIMIT_BYTES`, `LATEX_TIMEOUT_MS`, `BACKUP_RETENTION_DAYS`.
- GitLab and OIDC: `GITLAB_BASE_URL`, `GITLAB_EXTERNAL_URL`, OAuth client settings, system access token/user id, managed group settings, Omnibus image/root paths, and Atlasium OIDC key material.
- AI meeting automation: `AI_MEETING_AUTOMATION_ENABLED`, `AI_MAX_INPUT_CHARS`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_MS`.
- Production: use strong secrets, production URLs, persistent storage under `/var/lib/atlasium/storage`, and the deployment docs in `infra/`.

## API Overview

Most API routes require JWT authentication except public auth and OIDC discovery/token routes.

- Health: `GET /health`.
- Auth and account: login, invites, password reset/change, current profile, username sync, sessions, GitLab OAuth connection, HTTPS clone password, SSH keys, and OIDC endpoints for managed GitLab SSO.
- Admin: user listing, status/role updates, destructive-action preflight, and hard delete.
- Projects: create/list/delete projects, access summaries, overview aggregation, member management, and per-user project pins.
- Wiki: page create/import/tree/path/search, draft save, realtime flush, publish, delete, backlinks, assets, revision list, and revision detail.
- Documents: project document list/detail/create/delete, branches, version uploads, compile requests, compile logs, PDF download, and LaTeX tree/file operations.
- GitLab Code: project repository status/list/create/link/delete, access ensure, branches, commits, tree, files, raw content, archives, and merge requests.
- Tasks: project task list/create, update/delete, dependencies, and subtasks.
- Meetings: list/create/update/delete meeting minutes, retry AI automation, actions, and task linking.
- Notifications: current-user notification preferences.

Controller implementations live under `apps/api/src/*/*.controller.ts`.

## Testing And Verification

Common local checks:

```bash
pnpm lint
pnpm build
pnpm test
```

CI-equivalent checks:

```bash
pnpm --filter @doctoral/db db:test:prepare
pnpm --filter @doctoral/api test:coverage
pnpm --filter @doctoral/worker test:coverage:gate
pnpm build
```

The GitHub Actions CI workflow runs Prisma generation, lint, test database preparation, API aggregated coverage, worker coverage gate, and the monorepo build on every push to `main` and pull request.

## Deployment

Production deployment is container based:

- CI builds API, web, and worker images and publishes them to GHCR as immutable `sha-<commit>` tags plus `main`.
- `docker-compose.prod.yml` runs PostgreSQL, Redis, API, web, worker, and a one-shot `migrate` service.
- The deploy workflow promotes only successful CI runs from `main`, validates the checked-out SHA, pushes images, smoke-tests runtime images, deploys to the VPS, runs Prisma bootstrap/migrations, applies Nginx config, and checks `/health`.
- Manual promotion/rollback uses the workflow dispatch `image_tag` input, for example `sha-0a80b92745c9`.

Operational docs:

- `docs/SETUP_WSL.md` for WSL development setup.
- `infra/README.md` for VPS infrastructure notes.
- `infra/GO_LIVE_ATLASIUM.md` for cutover/runbook details.
- `docker-compose.gitlab.yml` for the managed GitLab stack.

## Project Conventions

- Product releases are versioned with annotated Git tags and GitHub Releases, for example `v0.3.0`; package versions currently remain `0.1.0`.
- Implementation notes and completed verification logs are tracked in `tasks/TODO.md`.
- Durable coding and operational lessons are tracked in `tasks/LESSONS.md`.
- Keep changes minimal, verify before marking work complete, and preserve the Atlasium visual identity and operational clarity documented in the lessons file.
