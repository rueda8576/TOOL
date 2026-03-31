# Atlasium Go-Live Runbook (Initial Deployment)

Target:
- Domain: `atlasium.info`
- Git domain: `git.atlasium.info`
- Server: `116.203.232.182`
- Mode: Direct VPS (no Cloudflare proxy)
- App path: `/opt/atlasium`
- Storage path: `/var/lib/atlasium/storage`

## 0) Preconditions

1. DNS:
   - `A atlasium.info -> 116.203.232.182`
   - `A www.atlasium.info -> 116.203.232.182`
   - `A git.atlasium.info -> 116.203.232.182`
   - `AAAA` removed unless you have real IPv6 on the VPS.
2. Server has Docker + Git installed.
3. Login as `root` (initial setup phase).
4. Validate RAM and disk headroom before running GitLab Omnibus on the same VPS.

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
mkdir -p /var/lib/atlasium/gitlab/{config,logs,data}
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
GITLAB_BASE_URL=https://git.atlasium.info
GITLAB_EXTERNAL_URL=https://git.atlasium.info
GITLAB_OMNIBUS_IMAGE=gitlab/gitlab-ce:latest
ATLASIUM_GITLAB_ROOT=/var/lib/atlasium/gitlab
ATLASIUM_GITLAB_HTTP_PORT=8081
GITLAB_ROOT_EMAIL=root@git.atlasium.info
GITLAB_INITIAL_ROOT_PASSWORD=<strong-root-password>
GITLAB_MANAGED_GROUP_PATH=atlasium
GITLAB_MANAGED_GROUP_NAME=Atlasium
GITLAB_SYSTEM_ACCESS_TOKEN=<gitlab-system-pat>
GITLAB_SYSTEM_USER_ID=<gitlab-system-user-id>
ATLASIUM_OIDC_CLIENT_ID=atlasium-gitlab
ATLASIUM_OIDC_CLIENT_SECRET=<atlasium-oidc-secret-for-gitlab>
ATLASIUM_OIDC_PRIVATE_KEY_BASE64=<base64-rsa-private-key>
ATLASIUM_SESSION_COOKIE_NAME=atlasium_session
GITLAB_OAUTH_CLIENT_ID=<gitlab-oauth-app-client-id>
GITLAB_OAUTH_CLIENT_SECRET=<gitlab-oauth-app-client-secret>
GITLAB_OAUTH_REDIRECT_URI=https://atlasium.info/api/auth/gitlab/callback
```

Generate the Atlasium OIDC signing key once:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0
```

## 2.1) Managed GitLab safe rollout before pushing to `main`

If the commit introducing managed GitLab is not on `main` yet, do **not** merge/push it to `main` first. The production workflow deploys `main` automatically, but it does not bootstrap GitLab for you.

Use a feature branch to pre-stage only the infrastructure files you need on the VPS:

```bash
cd /opt/atlasium
git fetch origin <feature-branch>
git checkout origin/<feature-branch> -- \
  docker-compose.gitlab.yml \
  infra/nginx/atlasium.conf \
  infra/scripts/validate-managed-gitlab-rollout.sh \
  infra/GO_LIVE_ATLASIUM.md
```

Before you merge/push that feature to `main`, finish these steps on the VPS:
1. Fill the managed-GitLab variables in `/opt/atlasium/.env`.
2. Create `/var/lib/atlasium/gitlab/{config,logs,data}`.
3. Start GitLab from `docker-compose.gitlab.yml`.
4. Apply the updated Nginx config and issue/reissue the certificate for `git.atlasium.info`.
5. Create the GitLab managed group, system PAT, and GitLab OAuth application.
6. Run:

```bash
cd /opt/atlasium
sh ./infra/scripts/validate-managed-gitlab-rollout.sh pre-main-push --env-file .env
```

Only after that preflight passes should you merge/push the feature to `main`.

## 3) Build and start containers

```bash
cd /opt/atlasium
docker login ghcr.io -u <GHCR_USERNAME>
sh ./infra/scripts/validate-prod-env.sh .env
IMAGE_TAG=main docker compose -f docker-compose.prod.yml pull
IMAGE_TAG=main docker compose -f docker-compose.prod.yml up -d --wait postgres redis
# Runs one-time bootstrap automatically on fresh DBs, auto-recovers failed migration records, then executes migrate deploy.
sh ./infra/scripts/deploy-prisma-bootstrap.sh main
IMAGE_TAG=main docker compose -f docker-compose.prod.yml up -d --no-build api worker web
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200 api web worker
```

## 3.1) Start GitLab Omnibus

GitLab runs from `docker-compose.gitlab.yml`, separate from the main Atlasium stack.

```bash
cd /opt/atlasium
docker compose -f docker-compose.gitlab.yml up -d
docker compose -f docker-compose.gitlab.yml ps
docker compose -f docker-compose.gitlab.yml logs --tail=200 gitlab
curl -fsS http://127.0.0.1:${ATLASIUM_GITLAB_HTTP_PORT:-8081}/-/health
```

First bootstrap can take several minutes.

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
certbot --nginx -d atlasium.info -d www.atlasium.info -d git.atlasium.info
systemctl status certbot.timer
certbot renew --dry-run
```

## 6.1) Bootstrap GitLab managed access before the first `main` deploy

1. Log in to `https://git.atlasium.info` as root.
2. Create or confirm the single managed group that Atlasium should own.
3. Create a personal access token for the Atlasium system user/root with scope to manage groups, projects, and memberships. Store it in `GITLAB_SYSTEM_ACCESS_TOKEN`.
4. Record that GitLab user id in `GITLAB_SYSTEM_USER_ID` so Atlasium never revokes the system account from managed repos.
5. Create a GitLab OAuth application for Atlasium API access:
   - redirect URI: `https://atlasium.info/api/auth/gitlab/callback`
   - scopes: `api`, `read_user`
6. Put the resulting client id/secret into `GITLAB_OAUTH_CLIENT_ID` and `GITLAB_OAUTH_CLIENT_SECRET`.
7. Update `/opt/atlasium/.env` with the final PAT/OAuth values.
8. Run:

```bash
cd /opt/atlasium
sh ./infra/scripts/validate-managed-gitlab-rollout.sh pre-main-push --env-file .env
```

At this point GitLab itself should be ready. Atlasium OIDC login flow and per-user `/account` connection are validated **after** the Atlasium `main` deploy, because the new OIDC endpoints do not exist on the currently deployed app yet.

## 7) Go-live validation

```bash
curl -I https://atlasium.info
curl https://atlasium.info/api/health
```

Expected API response:
- JSON with `status: "ok"`.

Post-deploy preflight:

```bash
cd /opt/atlasium
sh ./infra/scripts/validate-managed-gitlab-rollout.sh post-deploy --env-file .env
```

Manual smoke test:
1. Login.
2. Open `https://git.atlasium.info/users/sign_in` and confirm the `Atlasium` SSO option is visible.
3. Sign in once through GitLab SSO with an Atlasium admin account to trigger JIT provisioning.
4. Create project.
5. Verify that a managed GitLab repository was provisioned for the project.
6. Open `Account` and connect GitLab API access.
7. Open `Code` and browse branches/files, then create a branch or MR as an editor/admin.
8. Open Wiki/Documents/Tasks/Meetings.
9. In Documents: create/upload/compile/preview.

Note:
- LaTeX compilation runs inside the `worker` container image.
- The VPS host does not need a local TeX installation (`pdflatex`, `biber`, etc.).
- Production deploys keep only the active Atlasium image tag plus one previous tag locally on the VPS; full history remains in GHCR.
- The deploy workflow stores retention state in `/opt/atlasium/.deploy-image-state.env`.

Live logs:

```bash
docker compose -f docker-compose.prod.yml logs -f api web worker
docker compose -f docker-compose.gitlab.yml logs -f gitlab
tail -f /var/log/nginx/error.log
```

GitLab backup:

```bash
docker compose -f docker-compose.gitlab.yml exec gitlab gitlab-backup create
```

GitLab restore:

```bash
docker compose -f docker-compose.gitlab.yml stop gitlab
docker compose -f docker-compose.gitlab.yml run --rm gitlab gitlab-backup restore BACKUP=<timestamp>
docker compose -f docker-compose.gitlab.yml up -d gitlab
```

Docker image retention diagnostics:

```bash
cd /opt/atlasium
sh ./infra/scripts/manage-docker-retention.sh diagnose \
  --state-file /opt/atlasium/.deploy-image-state.env

sh ./infra/scripts/manage-docker-retention.sh pre-deploy \
  --state-file /opt/atlasium/.deploy-image-state.env \
  --target-tag <sha-tag> \
  --min-free-gb 12 \
  --dry-run
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
curl -fsS http://127.0.0.1:4000/health
sh ./infra/scripts/manage-docker-retention.sh finalize-success \
  --state-file /opt/atlasium/.deploy-image-state.env \
  --target-tag <previous-sha-tag>
```

Always set `IMAGE_TAG=<sha-tag>` for manual `docker compose` operations. If omitted, Compose falls back to `:main`.

If migration fails:

```bash
IMAGE_TAG=main docker compose -f docker-compose.prod.yml run --rm migrate
```

Fix migration state before retrying.
