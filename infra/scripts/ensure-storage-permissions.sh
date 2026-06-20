#!/bin/sh
set -eu

ENV_FILE=".env"
STORAGE_PATH="${ATLASIUM_STORAGE_HOST_PATH:-}"
RUNTIME_UID="${ATLASIUM_RUNTIME_UID:-10001}"
RUNTIME_GID="${ATLASIUM_RUNTIME_GID:-10001}"
SMOKE_IMAGE=""

usage() {
  cat >&2 <<'EOF'
Usage: sh infra/scripts/ensure-storage-permissions.sh [--env-file <path>] [--path <storage-path>] [--uid <uid>] [--gid <gid>] [--image <docker-image>]

Ensures the Atlasium storage bind mount is writable by the non-root runtime user.
When --image is provided, a container write smoke runs as the runtime UID/GID.
EOF
  exit 1
}

require_arg() {
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    printf 'Missing value for %s\n' "$1" >&2
    usage
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      require_arg "$@"
      ENV_FILE="$2"
      shift 2
      ;;
    --path)
      require_arg "$@"
      STORAGE_PATH="$2"
      shift 2
      ;;
    --uid)
      require_arg "$@"
      RUNTIME_UID="$2"
      shift 2
      ;;
    --gid)
      require_arg "$@"
      RUNTIME_GID="$2"
      shift 2
      ;;
    --image)
      require_arg "$@"
      SMOKE_IMAGE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  command -v sudo >/dev/null 2>&1 || die "root or passwordless sudo is required to prepare storage permissions"
  sudo -n "$@"
}

ensure_storage_path() {
  if [ "$(id -u)" -eq 0 ]; then
    install -d -m 775 -o "$RUNTIME_UID" -g "$RUNTIME_GID" "$STORAGE_PATH"
    chown -R "$RUNTIME_UID:$RUNTIME_GID" "$STORAGE_PATH"
    chmod 775 "$STORAGE_PATH"
    return
  fi

  if [ "$RUNTIME_UID" = "$(id -u)" ] && [ "$RUNTIME_GID" = "$(id -g)" ]; then
    mkdir -p "$STORAGE_PATH"
    chmod 775 "$STORAGE_PATH"
    return
  fi

  run_privileged install -d -m 775 -o "$RUNTIME_UID" -g "$RUNTIME_GID" "$STORAGE_PATH"
  run_privileged chown -R "$RUNTIME_UID:$RUNTIME_GID" "$STORAGE_PATH"
  run_privileged chmod 775 "$STORAGE_PATH"
}

read_env_value() {
  key="$1"
  file="$2"

  awk -v key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line=$0
      sub(/^[[:space:]]*/, "", line)
      prefix=key "="
      if (index(line, prefix) == 1) {
        value=substr(line, length(prefix) + 1)
        sub(/\r$/, "", value)
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
            (substr(value, 1, 1) == "'\''" && substr(value, length(value), 1) == "'\''")) {
          value=substr(value, 2, length(value) - 2)
        }
        print value
        exit
      }
    }
  ' "$file"
}

case "$RUNTIME_UID:$RUNTIME_GID" in
  *[!0-9:]*|":"|*:|:*) die "runtime uid/gid must be numeric" ;;
esac

if [ -z "$STORAGE_PATH" ] && [ -f "$ENV_FILE" ]; then
  STORAGE_PATH="$(read_env_value ATLASIUM_STORAGE_HOST_PATH "$ENV_FILE" || true)"
fi

STORAGE_PATH="${STORAGE_PATH:-/var/lib/atlasium/storage}"

case "$STORAGE_PATH" in
  ""|"/"|"/var"|"/var/"|"/var/lib"|"/var/lib/"|"/var/lib/atlasium"|"/var/lib/atlasium/")
    die "refusing unsafe storage path: ${STORAGE_PATH}"
    ;;
esac

printf 'Ensuring Atlasium storage path %s is owned by %s:%s\n' "$STORAGE_PATH" "$RUNTIME_UID" "$RUNTIME_GID"
ensure_storage_path

if [ -n "$SMOKE_IMAGE" ]; then
  command -v docker >/dev/null 2>&1 || die "docker is required for storage mount smoke"
  printf 'Running storage bind-mount smoke with image %s\n' "$SMOKE_IMAGE"
  docker run --rm \
    --user "$RUNTIME_UID:$RUNTIME_GID" \
    --entrypoint sh \
    -v "$STORAGE_PATH:/storage" \
    "$SMOKE_IMAGE" \
    -lc 'set -eu; touch /storage/.atlasium-write-test; rm -f /storage/.atlasium-write-test'
fi

printf 'Atlasium storage permissions verified.\n'
