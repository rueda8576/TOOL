#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine before running this script."
  exit 1
fi

mkdir -p /opt/doctoral-platform
mkdir -p /var/lib/doctoral-platform/storage

cat <<'MSG'
VPS bootstrap complete.
Next steps:
1) Copy repository to /opt/doctoral-platform
2) Configure .env with production values
3) Run: docker compose up -d --build
4) Configure reverse proxy and TLS
MSG
