# Doctoral Platform (v1 bootstrap)

Web platform for doctoral work management: projects, wiki, documents (PDF + LaTeX), tasks, meetings, notifications, and operational tooling.

## Architecture

- `apps/web`: Next.js frontend (English UI, responsive).
- `apps/api`: NestJS REST API.
- `apps/worker`: BullMQ worker for LaTeX compile, email notifications, and backups.
- `packages/db`: Prisma schema/client.
- `packages/shared`: shared types and validation schemas.

## Quick start

1. Copy env file:
   - `cp .env.example .env`
2. Start infrastructure:
   - `docker compose up -d postgres redis mailpit`
3. Install dependencies:
   - `pnpm install`
4. Generate Prisma client and migrate:
   - `pnpm db:generate`
   - `pnpm db:migrate`
5. Seed first admin user:
   - `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='change-me-now' pnpm --filter @doctoral/api seed:admin`
6. Run apps:
   - API: `pnpm dev`
   - Web: `pnpm dev:web`
   - Worker: `pnpm dev:worker`

## API surface (implemented)

- Auth:
  - `POST /auth/login`
  - `POST /auth/invite`
  - `POST /auth/accept-invite`
  - `POST /auth/password/reset`
- Projects:
  - `POST /projects`
  - `GET /projects`
  - `GET /projects/:id/members`
  - `POST /projects/:id/members`
- Documents:
  - `POST /projects/:id/documents`
  - `POST /documents/:id/versions`
  - `POST /documents/:id/branches`
  - `POST /document-versions/:id/compile`
  - `GET /document-versions/:id/compile-log`
  - `GET /document-versions/:id/pdf`
  - `GET /document-versions/:id/latex/tree`
  - `GET /document-versions/:id/latex/file?path=...`
  - `PUT /document-versions/:id/latex/file`
- Wiki:
  - `POST /projects/:id/wiki-pages`
  - `PUT /wiki-pages/:id`
  - `GET /wiki-pages/:id/revisions`
- Tasks:
  - `GET /projects/:id/tasks`
  - `POST /projects/:id/tasks`
  - `PATCH /tasks/:id`
  - `DELETE /tasks/:id`
  - `POST /tasks/:id/dependencies`
  - `POST /tasks/:id/subtasks`
- Meetings:
  - `POST /projects/:id/meetings`
  - `POST /meetings/:id/actions`
  - `POST /meetings/:id/actions/:actionId/link-task`
- Notifications:
  - `GET /users/me/notification-preferences`
  - `PUT /users/me/notification-preferences`

## Notes

- Default storage root is `./storage` in dev and `/var/lib/doctoral-platform/storage` in production.
- LaTeX compile is queued and executed asynchronously by the worker.
- Document branching in v1 is linear per branch (no merge).
- Gantt is planned for v1.1 on top of task dependencies.
- JWT auth is required in API routes except public auth routes.
- Frontend basic auth flow is available at `/login` (stores JWT in local storage).
- Frontend LaTeX editor baseline is available at `/projects/:projectId/documents/editor`.
