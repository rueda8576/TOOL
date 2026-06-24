# Infrastructure Guide (Self-hosted VPS)

## Components
- Reverse proxy: Nginx/Caddy with TLS.
- API: NestJS (`apps/api`) on port `4000`.
- Web: Next.js (`apps/web`) on port `3000`.
- Worker: BullMQ worker (`apps/worker`).
- Data: PostgreSQL + Redis.
- Storage: local filesystem mounted at `/var/lib/atlasium/storage`.
- Production orchestration: `docker-compose.prod.yml` with GHCR images.

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
- Runtime storage: `/var/lib/atlasium/storage` owned by runtime UID/GID `10001:10001`
- Backups: `/var/lib/atlasium/storage/backups`

## CI/CD deployment model
- CI runs on GitHub Actions (`.github/workflows/ci.yml`).
- CD publishes images to GHCR and deploys to VPS (`.github/workflows/deploy.yml`).
- CD enforces Docker `json-file` log rotation on the VPS before image retention runs:
  - `/etc/docker/daemon.json` keeps the existing Docker `data-root` and adds `max-size=100m` / `max-file=5`.
  - `atlasium-gitlab` is recreated automatically when its container `LogConfig` does not include those limits.
  - Oversized GitLab Docker json logs are truncated only through the path returned by `docker inspect atlasium-gitlab --format '{{.LogPath}}'`.
- VPS deploy command shape:
  - `IMAGE_TAG=sha-<commit> docker compose -f docker-compose.prod.yml pull`
  - `sh infra/scripts/ensure-storage-permissions.sh --env-file .env --image ghcr.io/rueda8576/atlasium-api:sha-<commit>`
  - `IMAGE_TAG=sha-<commit> docker compose -f docker-compose.prod.yml up -d --no-build`

## VPS disk pressure policy
- Docker image retention and Docker json log rotation are separate controls. Do not use broad `docker system prune -a --volumes` or `docker volume prune` as the primary response to GitLab json log growth.
- Do not delete `/var/lib/atlasium/gitlab/data`; GitLab repository and Prometheus data under that tree must be handled through GitLab-specific retention/configuration.
- Docker daemon logging defaults only apply to newly created containers. Existing containers must be recreated before `docker inspect <container> --format '{{json .HostConfig.LogConfig}}'` shows the new limits.
- If systemd journal usage is also high, check it separately with `journalctl --disk-usage`; a conservative manual cleanup is `journalctl --vacuum-size=512M`.

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
