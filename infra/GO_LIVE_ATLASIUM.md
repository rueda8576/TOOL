# Atlasium Go-Live Runbook (Initial Deployment)

Target:
- Domain: `atlasium.info`
- Server: `116.203.232.182`
- Mode: Direct VPS (no Cloudflare proxy)
- App path: `/opt/atlasium`
- Storage path: `/var/lib/atlasium/storage`

## 0) Preconditions

1. DNS:
   - `A atlasium.info -> 116.203.232.182`
   - `A www.atlasium.info -> 116.203.232.182`
   - `AAAA` removed unless you have real IPv6 on the VPS.
2. Server has Docker + Git installed.
3. Login as `root` (initial setup phase).

## 1) Bootstrap server

```bash
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx ufw curl git
```

Install Node 22 + pnpm (needed for Prisma migrations and seed):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

Create runtime directories:

```bash
mkdir -p /opt/atlasium
mkdir -p /var/lib/atlasium/storage
```

Enable firewall:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 2) Clone and configure app

```bash
cd /opt/atlasium
git clone <REPO_URL> .
```

Create `.env` at repo root:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/doctoral_platform?schema=public
REDIS_URL=redis://redis:6379
JWT_SECRET=<strong-secret>
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@atlasium.info
STORAGE_ROOT=/var/lib/atlasium/storage
APP_BASE_URL=https://atlasium.info
API_PORT=4000
WEB_PORT=3000
DEFAULT_TIMEZONE=Europe/Madrid
PDF_UPLOAD_LIMIT_BYTES=1073741824
LATEX_TIMEOUT_MS=120000
BACKUP_RETENTION_DAYS=30
ATLASIUM_STORAGE_HOST_PATH=/var/lib/atlasium/storage
NEXT_PUBLIC_API_BASE_URL=/api
```

## 3) Build and start containers

```bash
cd /opt/atlasium
docker login ghcr.io -u <GHCR_USERNAME>
IMAGE_TAG=main docker compose -f docker-compose.prod.yml pull
IMAGE_TAG=main docker compose -f docker-compose.prod.yml up -d --wait postgres redis
# Runs one-time bootstrap automatically on fresh DBs, then always executes migrate deploy.
sh ./infra/scripts/deploy-prisma-bootstrap.sh main
IMAGE_TAG=main docker compose -f docker-compose.prod.yml up -d --no-build api worker web
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 api web worker
```

## 4) Seed admin (first time only)

```bash
cd /opt/atlasium
pnpm install
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/doctoral_platform?schema=public \
ADMIN_EMAIL=<your-email> \
ADMIN_PASSWORD='<strong-password>' \
pnpm --filter @doctoral/api seed:admin
```

## 5) Configure Nginx reverse proxy

Use template: `infra/nginx/atlasium.conf`.

```bash
cp /opt/atlasium/infra/nginx/atlasium.conf /etc/nginx/sites-available/atlasium.conf
ln -s /etc/nginx/sites-available/atlasium.conf /etc/nginx/sites-enabled/atlasium.conf
nginx -t
systemctl reload nginx
```

## 6) Issue TLS certificates

```bash
certbot --nginx -d atlasium.info -d www.atlasium.info
systemctl status certbot.timer
certbot renew --dry-run
```

## 7) Go-live validation

```bash
curl -I https://atlasium.info
curl https://atlasium.info/api/health
```

Expected API response:
- JSON with `status: "ok"`.

Manual smoke test:
1. Login.
2. Create project.
3. Open Wiki/Documents/Tasks/Meetings.
4. In Documents: create/upload/compile/preview.

Live logs:

```bash
docker compose -f docker-compose.prod.yml logs -f api web worker
tail -f /var/log/nginx/error.log
```

## 8) Rollback

If deployment fails:

```bash
cd /opt/atlasium
git fetch --all --prune
git reset --hard origin/main
IMAGE_TAG=<previous-sha-tag> docker compose -f docker-compose.prod.yml pull
IMAGE_TAG=<previous-sha-tag> docker compose -f docker-compose.prod.yml up -d --wait postgres redis
IMAGE_TAG=<previous-sha-tag> docker compose -f docker-compose.prod.yml run --rm migrate
IMAGE_TAG=<previous-sha-tag> docker compose -f docker-compose.prod.yml up -d --no-build api worker web
```

If migration fails:

```bash
IMAGE_TAG=main docker compose -f docker-compose.prod.yml run --rm migrate
```

Fix migration state before retrying.
