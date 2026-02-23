# Infrastructure Guide (Self-hosted VPS)

## Components
- Reverse proxy: Nginx/Caddy with TLS.
- API: NestJS (`apps/api`) on port `4000`.
- Web: Next.js (`apps/web`) on port `3000`.
- Worker: BullMQ worker (`apps/worker`).
- Data: PostgreSQL + Redis.
- Storage: local filesystem mounted at `/var/lib/doctoral-platform/storage`.

## Production checklist
1. Create VPS user and harden SSH.
2. Install Docker Engine and Docker Compose.
3. Configure domain DNS records to VPS public IP.
4. Configure TLS certificates (Let's Encrypt).
5. Deploy stack through `docker compose`.
6. Configure SMTP credentials in `.env`.
7. Validate daily backup run and restore drill.

## Suggested directories
- App root: `/opt/doctoral-platform`
- Runtime storage: `/var/lib/doctoral-platform/storage`
- Backups: `/var/lib/doctoral-platform/storage/backups`
