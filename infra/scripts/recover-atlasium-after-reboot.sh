#!/bin/sh
set -eu

STATE_FILE="/opt/atlasium/.deploy-image-state.env"
ENV_FILE=".env"
COMPOSE_FILE="docker-compose.prod.yml"

usage() {
  cat >&2 <<'EOF'
Usage: sh infra/scripts/recover-atlasium-after-reboot.sh [--state-file <path>] [--env-file <path>] [--compose-file <path>]

Recovers the Atlasium production stack after a VPS reboot using the currently deployed image tag
recorded in the deploy retention state file.
EOF
  exit 1
}

require_arg() {
  if [ "$#" -lt 2 ] || [ -z "${2}" ]; then
    printf 'Missing value for %s\n' "$1" >&2
    usage
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --state-file)
      require_arg "$@"
      STATE_FILE="$2"
      shift 2
      ;;
    --env-file)
      require_arg "$@"
      ENV_FILE="$2"
      shift 2
      ;;
    --compose-file)
      require_arg "$@"
      COMPOSE_FILE="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "docker is required"
command -v curl >/dev/null 2>&1 || die "curl is required"

[ -f "${ENV_FILE}" ] || die "Missing env file: ${ENV_FILE}"
[ -f "${STATE_FILE}" ] || die "Missing state file: ${STATE_FILE}"
[ -f "${COMPOSE_FILE}" ] || die "Missing compose file: ${COMPOSE_FILE}"

CURRENT_IMAGE_TAG=""
PREVIOUS_IMAGE_TAG=""
# shellcheck disable=SC1090
. "${STATE_FILE}"

[ -n "${CURRENT_IMAGE_TAG}" ] || die "CURRENT_IMAGE_TAG is missing in ${STATE_FILE}"

log "Validating production env file..."
sh ./infra/scripts/validate-prod-env.sh "${ENV_FILE}"

log "Recovering Atlasium stack with IMAGE_TAG=${CURRENT_IMAGE_TAG}"
IMAGE_TAG="${CURRENT_IMAGE_TAG}" docker compose -f "${COMPOSE_FILE}" up -d --wait postgres redis
IMAGE_TAG="${CURRENT_IMAGE_TAG}" docker compose -f "${COMPOSE_FILE}" up -d --no-build api web worker mailpit

log "Waiting for local API health..."
local_ok=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null; then
    local_ok=1
    break
  fi
  sleep 2
done

IMAGE_TAG="${CURRENT_IMAGE_TAG}" docker compose -f "${COMPOSE_FILE}" ps

if [ "${local_ok}" -ne 1 ]; then
  IMAGE_TAG="${CURRENT_IMAGE_TAG}" docker compose -f "${COMPOSE_FILE}" logs --tail=200 api web worker postgres redis mailpit || true
  die "Atlasium local API healthcheck failed after reboot recovery"
fi

log "Atlasium stack recovered successfully with IMAGE_TAG=${CURRENT_IMAGE_TAG}"
