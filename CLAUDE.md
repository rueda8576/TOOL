# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Files to Read First

Always consult these files when working on this project:
- `tasks/LESSONS.md` — accumulated coding conventions and hard-won lessons; read and respect all of them
- `tasks/TODO.md` — pending tasks; plan changes there and mark items complete as you go

## Commands

### Development

```bash
# Start infrastructure
docker compose up -d postgres redis mailpit

# Install dependencies and generate Prisma client
pnpm install
pnpm db:generate
pnpm db:migrate

# Seed first admin (one-time)
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='change-me-now' pnpm --filter @doctoral/api seed:admin

# Run services individually
pnpm dev          # API (port 4000)
pnpm dev:web      # Frontend (port 3000)
pnpm dev:worker   # Async worker
```

### Testing

```bash
pnpm --filter @doctoral/api test         # Run API tests (the only package with real tests)
pnpm --filter @doctoral/api test:watch   # Watch mode
```

### Build & Database

```bash
pnpm build                # Build all packages
pnpm db:generate          # Regenerate Prisma client after schema changes
pnpm db:migrate           # Apply migrations in dev
```

> `pnpm lint` and `pnpm format` are currently no-ops (echo stubs).

### Debugging Ports

If an endpoint returns `Cannot <METHOD> /...` after adding a route, check for stale Node processes before changing backend code:
```bash
ss -ltnp | rg :4000
```
Then verify route registration in Nest startup logs and confirm with `curl` (a `401` means the route exists but requires auth; `404` means missing route or wrong process).

## Architecture

### Monorepo Structure

```
apps/api/       NestJS REST API (port 4000), JWT auth, Prisma ORM
apps/web/       Next.js 14 frontend (port 3000), Monaco editor, PDF.js
apps/worker/    BullMQ async job processor — no HTTP server
packages/db/    Prisma schema + generated client (shared between api and worker)
packages/shared/ Zod schemas and shared TypeScript types
infra/          Nginx config, VPS deployment/maintenance scripts
```

### Service Communication

- **Web → API**: HTTP REST + WebSocket (Yjs CRDT for realtime collaboration)
- **API → Worker**: BullMQ job queue backed by Redis
- **API + Worker → DB**: Shared Prisma client from `packages/db`
- **Storage**: `./storage` in dev, `/var/lib/atlasium/storage` in prod — paths are normalized to absolute at env-load time

### Key Domain Modules (API)

Auth, Projects, Documents (LaTeX, PDF), Wiki, Tasks, Meetings, Notifications, GitLab integration, Audit logs.

**Document flow**: upload LaTeX bundle → API queues a compile job → Worker runs `pdflatex`/`biber` → stores PDF in `STORAGE_ROOT` → API updates `CompileStatus` (PENDING → RUNNING → SUCCEEDED/FAILED/TIMEOUT).

**Realtime**: Yjs CRDT via `y-websocket` connects Monaco editor in the browser to the API WebSocket endpoint. Always degrade gracefully if WebSocket setup fails — keep local save/compile paths operational.

### Auth & Roles

- JWT tokens (LocalStorage); global roles: `ADMIN | EDITOR | READER`; project-scoped roles: `EDITOR | READER`
- GitLab OAuth + OIDC for SSO. Web SSO and `git clone` are different surfaces: OIDC owns web login; CLI Git uses SSH keys (HTTPS via PAT is the documented fallback).

### Database (Prisma)

Core models: `User`, `Project`, `Document`, `DocumentVersion`, `WikiPage`, `Task`, `Meeting`, `Notification`, `Invite`, `AuditLog`.

Key enums: `CompileStatus` (PENDING/RUNNING/SUCCEEDED/FAILED/TIMEOUT), `TaskStatus` (TODO/IN_PROGRESS/BLOCKED/DONE), `NotificationEventType`.

After any schema change run `pnpm db:generate` before building dependent packages.

### CI/CD

GitHub Actions (`push` to `main` and PRs): install deps → generate Prisma client → test → build. Deploy triggers from successful CI completion on `main` using GHCR images with immutable `sha-*` tags. Migrations run via a dedicated `migrate` compose service before app startup.

## Critical Conventions (from LESSONS.md)

**Environment**: Load `.env` programmatically at process startup — do not assume shell sourcing. Normalize relative `STORAGE_ROOT` to absolute using the `.env` directory as anchor.

**Monorepo Docker**: Set `PNPM_NODE_LINKER=hoisted` in Docker build stages. Install `openssl` in Node 22 / Debian containers for Prisma engines. Include both `--filter <service>` and `--filter @doctoral/db` in install steps so `prisma` CLI is available.

**CI**: Force dev dependency install (`pnpm install --prod=false`). Use explicit test target `pnpm --filter @doctoral/api test`. Avoid broad `.gitignore` patterns like `storage/` that can shadow source folders.

**Compose**: Use `$$VAR` (double-dollar) inside `docker-compose` command strings — single `$VAR` is interpolated at parse time. Every long-running service must have `restart: unless-stopped`. Each Compose stack must declare a top-level `name:`.

**GitLab sync**: Before adding/downgrading project members, check `/members/all` for inherited group access — do not add direct memberships for users who already have sufficient inherited access.

**Monaco**: Never reset the controlled `value` after a compile status refresh on the same document version — it wipes undo/redo history. Wire business shortcuts via editor actions, not global `keydown` listeners.

**Date handling**: Normalize day-only meeting dates to UTC noon before persistence to avoid timezone drift. Expose `scheduledDate` (`YYYY-MM-DD`) in API responses.

**PDF/iframe**: Use self-hosted PDF.js for deterministic zoom control. Implement `Ctrl/Cmd+wheel` zoom interception inside the iframe itself, not in the parent page. Use `postMessage` with explicit `type` payloads and strict origin checks for parent↔iframe communication.

## Workflow

- Enter plan mode for any non-trivial task (3+ steps or architectural decisions). Stop and re-plan if something goes sideways.
- After every correction: update `tasks/LESSONS.md` with the pattern.
- After every implemented change: provide the exact commit message.
- Never mark a task complete without proving it works.
