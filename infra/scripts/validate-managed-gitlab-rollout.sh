#!/usr/bin/env sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage: sh infra/scripts/validate-managed-gitlab-rollout.sh <pre-main-push|post-deploy> [--env-file <path>]

Modes:
  pre-main-push  Validate that the VPS is ready for the first managed-GitLab production deploy.
  post-deploy    Validate Atlasium + GitLab integration after the main deploy has completed.
EOF
  exit 1
}

MODE="${1:-}"
[ -n "${MODE}" ] || usage
shift || true

ENV_FILE=".env"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      [ "$#" -ge 2 ] || usage
      ENV_FILE="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

case "${MODE}" in
  pre-main-push|post-deploy)
    ;;
  *)
    usage
    ;;
esac

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

if [ ! -f "${ENV_FILE}" ]; then
  fail "Missing env file: ${ENV_FILE}"
fi

value_from_env() {
  key="$1"
  awk -F= -v key="${key}" '
    $0 ~ "^[[:space:]]*"key"=" {
      v = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      print v
    }
  ' "${ENV_FILE}" | tail -n 1
}

require_env_key() {
  key="$1"
  value="$(value_from_env "${key}")"
  [ -n "${value}" ] || fail "${key} is missing in ${ENV_FILE}"
}

trim_trailing_slashes() {
  printf '%s' "$1" | sed 's:/*$::'
}

check_http_ok() {
  url="$1"
  if ! curl -fsS "${url}" >/dev/null; then
    fail "HTTP check failed: ${url}"
  fi
}

check_http_contains() {
  url="$1"
  pattern="$2"
  if ! curl -fsSL "${url}" | tr -d '\n' | grep -F "\"${pattern}\"" >/dev/null 2>&1; then
    fail "Expected response from ${url} to contain ${pattern}"
  fi
}

extract_host_from_url() {
  printf '%s' "$1" | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://([^/:]+).*$#\1#'
}

gitlab_sign_in_probe() {
  label="$1"
  url="$2"
  host_header="${3:-}"

  if [ -n "${host_header}" ]; then
    response_headers="$(curl -fsSI -H "Host: ${host_header}" "${url}/users/sign_in" 2>/dev/null || true)"
  else
    response_headers="$(curl -fsSI "${url}/users/sign_in" 2>/dev/null || true)"
  fi

  if printf '%s\n' "${response_headers}" | tr -d '\r' | grep -qi '^x-gitlab-meta:'; then
    return 0
  fi

  fail "GitLab availability probe failed for ${label}: /-/health did not pass and /users/sign_in did not return GitLab headers"
}

check_gitlab_available() {
  label="$1"
  url="$2"
  host_header="${3:-}"

  if [ -n "${host_header}" ]; then
    if curl -fsS -H "Host: ${host_header}" "${url}/-/health" >/dev/null 2>&1; then
      return 0
    fi
  else
    if curl -fsS "${url}/-/health" >/dev/null 2>&1; then
      return 0
    fi
  fi

  log "GitLab /-/health probe failed for ${label}; falling back to sign-in page probe..."
  gitlab_sign_in_probe "${label}" "${url}" "${host_header}"
}

require_command docker
require_command curl

MANDATORY_KEYS='
APP_BASE_URL
GITLAB_BASE_URL
GITLAB_EXTERNAL_URL
GITLAB_OMNIBUS_IMAGE
ATLASIUM_GITLAB_ROOT
ATLASIUM_GITLAB_HTTP_PORT
GITLAB_ROOT_EMAIL
GITLAB_INITIAL_ROOT_PASSWORD
GITLAB_MANAGED_GROUP_PATH
GITLAB_MANAGED_GROUP_NAME
GITLAB_SYSTEM_ACCESS_TOKEN
GITLAB_SYSTEM_USER_ID
ATLASIUM_OIDC_CLIENT_ID
ATLASIUM_OIDC_CLIENT_SECRET
ATLASIUM_OIDC_PRIVATE_KEY_BASE64
ATLASIUM_SESSION_COOKIE_NAME
GITLAB_OAUTH_CLIENT_ID
GITLAB_OAUTH_CLIENT_SECRET
GITLAB_OAUTH_REDIRECT_URI
'

for key in ${MANDATORY_KEYS}; do
  require_env_key "${key}"
done

APP_BASE_URL="$(trim_trailing_slashes "$(value_from_env APP_BASE_URL)")"
GITLAB_EXTERNAL_URL="$(trim_trailing_slashes "$(value_from_env GITLAB_EXTERNAL_URL)")"
GITLAB_ROOT_DIR="$(value_from_env ATLASIUM_GITLAB_ROOT)"
GITLAB_HTTP_PORT="$(value_from_env ATLASIUM_GITLAB_HTTP_PORT)"
GITLAB_HOST="$(extract_host_from_url "${GITLAB_EXTERNAL_URL}")"

if [ -z "${GITLAB_ROOT_DIR}" ]; then
  fail "ATLASIUM_GITLAB_ROOT resolved to an empty value"
fi

for path in "${GITLAB_ROOT_DIR}/config" "${GITLAB_ROOT_DIR}/logs" "${GITLAB_ROOT_DIR}/data"; do
  [ -d "${path}" ] || fail "Missing GitLab persistent directory: ${path}"
done

log "Validating docker-compose.gitlab.yml with ${ENV_FILE}..."
docker compose --env-file "${ENV_FILE}" -f docker-compose.gitlab.yml config >/dev/null

log "Checking GitLab container status..."
if ! docker compose --env-file "${ENV_FILE}" -f docker-compose.gitlab.yml ps --status running --services | grep -qx 'gitlab'; then
  fail "GitLab container is not running under docker-compose.gitlab.yml"
fi

log "Checking local GitLab health..."
check_gitlab_available "local" "http://127.0.0.1:${GITLAB_HTTP_PORT}" "${GITLAB_HOST}"

log "Checking public GitLab endpoint..."
check_gitlab_available "public" "${GITLAB_EXTERNAL_URL}"

if [ "${MODE}" = "post-deploy" ]; then
  log "Checking Atlasium API health..."
  check_http_ok "${APP_BASE_URL}/api/health"

  log "Checking Atlasium OIDC discovery..."
  check_http_contains "${APP_BASE_URL}/api/auth/oidc/.well-known/openid-configuration" "issuer\":\"${APP_BASE_URL}/api/auth/oidc"

  log "Checking GitLab sign-in page exposes Atlasium SSO..."
  if ! curl -fsSL "${GITLAB_EXTERNAL_URL}/users/sign_in" | grep -q 'Atlasium'; then
    fail "GitLab sign-in page does not expose the Atlasium OIDC label yet"
  fi
fi

log "Managed GitLab rollout validation passed for mode: ${MODE}"
