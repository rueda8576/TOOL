#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root."
  exit 1
fi

apt update
apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx ufw curl git

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine before running this script."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi

corepack enable
corepack prepare pnpm@9.15.4 --activate

mkdir -p /opt/atlasium
mkdir -p /var/lib/atlasium/storage

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat <<'MSG'
VPS bootstrap complete.
Next steps:
1) Copy repository to /opt/atlasium
2) Configure .env with production values
3) Run: docker compose up -d --build
4) Configure reverse proxy and TLS using infra/nginx/atlasium.conf
MSG
