# Infrastructure Guide (Self-hosted VPS)

## Components
- Reverse proxy: Nginx/Caddy with TLS.
- API: NestJS (`apps/api`) on port `4000`.
- Web: Next.js (`apps/web`) on port `3000`.
- Worker: BullMQ worker (`apps/worker`).
- Data: PostgreSQL + Redis.
- Storage: local filesystem mounted at `/var/lib/atlasium/storage`.

## Production checklist
1. Create VPS user and harden SSH.
2. Install Docker Engine and Docker Compose.
3. Configure domain DNS records to VPS public IP.
4. Configure TLS certificates (Let's Encrypt).
5. Deploy stack through `docker compose`.
6. Configure SMTP credentials in `.env`.
7. Validate daily backup run and restore drill.

## Suggested directories
- App root: `/opt/atlasium`
- Runtime storage: `/var/lib/atlasium/storage`
- Backups: `/var/lib/atlasium/storage/backups`

## Atlasium go-live defaults
- Domain: `atlasium.info` (`www.atlasium.info` redirected to apex).
- Reverse proxy route:
  - `/` -> `http://127.0.0.1:3000`
  - `/api/` -> `http://127.0.0.1:4000`
- Production web build must set:
  - `NEXT_PUBLIC_API_BASE_URL=/api`
- Nginx template:
  - `infra/nginx/atlasium.conf`
- Full cutover runbook:
  - `infra/GO_LIVE_ATLASIUM.md`
