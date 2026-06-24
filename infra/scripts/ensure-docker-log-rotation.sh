#!/usr/bin/env sh
set -eu

MODE="${1:-}"
CONTAINER_NAME=""
SERVICE_NAME="gitlab"
COMPOSE_FILE="docker-compose.gitlab.yml"
ENV_FILE=".env"
DAEMON_CONFIG="${DOCKER_DAEMON_CONFIG:-/etc/docker/daemon.json}"
LOG_MAX_SIZE="${ATLASIUM_DOCKER_LOG_MAX_SIZE:-100m}"
LOG_MAX_FILE="${ATLASIUM_DOCKER_LOG_MAX_FILE:-5}"
RESTART_IF_CHANGED=0
WAIT_SECONDS="${ATLASIUM_GITLAB_LOG_ROTATION_WAIT_SECONDS:-900}"

usage() {
  status="${1:-1}"
  cat >&2 <<'EOF'
Usage:
  sh infra/scripts/ensure-docker-log-rotation.sh truncate-container --container <name>
  sh infra/scripts/ensure-docker-log-rotation.sh apply-daemon [--restart-if-changed] [--daemon-config <path>]
  sh infra/scripts/ensure-docker-log-rotation.sh ensure-container --container <name> [--compose-file <path>] [--env-file <path>] [--service <name>]

Ensures Docker json-file log rotation for Atlasium production hosts without pruning images,
volumes, or GitLab data.
EOF
  exit "$status"
}

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_arg() {
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    die "Missing value for $1"
  fi
}

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  command -v sudo >/dev/null 2>&1 || die "root or passwordless sudo is required for: $*"
  sudo -n "$@"
}

daemon_config_needs_privilege() {
  case "$DAEMON_CONFIG" in
    /etc/*) [ "$(id -u)" -ne 0 ] ;;
    *) return 1 ;;
  esac
}

run_for_daemon_config() {
  if daemon_config_needs_privilege; then
    run_privileged "$@"
  else
    "$@"
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

docker_root_dir() {
  docker info --format '{{.DockerRootDir}}'
}

container_exists() {
  docker inspect "$1" >/dev/null 2>&1
}

parse_common_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --container)
        require_arg "$@"
        CONTAINER_NAME="$2"
        shift 2
        ;;
      --compose-file)
        require_arg "$@"
        COMPOSE_FILE="$2"
        shift 2
        ;;
      --env-file)
        require_arg "$@"
        ENV_FILE="$2"
        shift 2
        ;;
      --service)
        require_arg "$@"
        SERVICE_NAME="$2"
        shift 2
        ;;
      --daemon-config)
        require_arg "$@"
        DAEMON_CONFIG="$2"
        shift 2
        ;;
      --restart-if-changed)
        RESTART_IF_CHANGED=1
        shift 1
        ;;
      --wait-seconds)
        require_arg "$@"
        WAIT_SECONDS="$2"
        shift 2
        ;;
      -h|--help)
        usage 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

path_is_under_root() {
  root="$1"
  candidate="$2"
  python3 - "$root" "$candidate" <<'PY'
import os
import sys

root = os.path.realpath(sys.argv[1])
candidate = os.path.realpath(sys.argv[2])
try:
    ok = os.path.commonpath([root, candidate]) == root and candidate != root
except ValueError:
    ok = False
sys.exit(0 if ok else 1)
PY
}

truncate_container_log() {
  [ -n "$CONTAINER_NAME" ] || die "--container is required"
  require_command docker
  require_command python3

  if ! container_exists "$CONTAINER_NAME"; then
    log "Container ${CONTAINER_NAME} does not exist; skipping Docker log truncation."
    return 0
  fi

  docker_root="$(docker_root_dir)"
  log_path="$(docker inspect -f '{{.LogPath}}' "$CONTAINER_NAME")"
  case "$log_path" in
    ""|"<no value>")
      log "Container ${CONTAINER_NAME} does not expose a json log path; skipping truncation."
      return 0
      ;;
  esac

  if ! path_is_under_root "$docker_root" "$log_path"; then
    die "Refusing to truncate ${log_path}; it is not under Docker root ${docker_root}"
  fi

  if ! run_privileged test -f "$log_path"; then
    log "Docker log path ${log_path} is not a file; skipping truncation."
    return 0
  fi

  log "Truncating Docker json log for ${CONTAINER_NAME}: ${log_path}"
  run_privileged truncate -s 0 "$log_path"
}

restore_daemon_backup() {
  backup_path="${DAEMON_CONFIG}.atlasium-log-rotation.bak"
  if [ "$1" = "1" ] && run_for_daemon_config test -f "$backup_path"; then
    log "Restoring previous Docker daemon config from ${backup_path}"
    run_for_daemon_config cp "$backup_path" "$DAEMON_CONFIG"
  else
    log "Removing Docker daemon config written by failed rotation update: ${DAEMON_CONFIG}"
    run_for_daemon_config rm -f "$DAEMON_CONFIG"
  fi
}

validate_daemon_config() {
  if ! command -v dockerd >/dev/null 2>&1; then
    log "dockerd is not available; skipping daemon config validation."
    return 0
  fi

  log "Validating Docker daemon config: ${DAEMON_CONFIG}"
  run_for_daemon_config dockerd --validate --config-file "$DAEMON_CONFIG"
}

restart_docker() {
  log "Restarting Docker so daemon log defaults apply to newly created containers..."
  if command -v systemctl >/dev/null 2>&1; then
    run_privileged systemctl restart docker || return 1
  elif command -v service >/dev/null 2>&1; then
    run_privileged service docker restart || return 1
  else
    log "Neither systemctl nor service is available to restart Docker"
    return 1
  fi

  for _ in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
      log "Docker is ready after restart."
      return 0
    fi
    sleep 2
  done

  log "Docker did not become ready after restart"
  return 1
}

apply_daemon_config() {
  require_command python3

  original_exists=0
  if run_for_daemon_config test -f "$DAEMON_CONFIG"; then
    original_exists=1
  fi

  backup_path="${DAEMON_CONFIG}.atlasium-log-rotation.bak"
  merge_result="$(
    run_for_daemon_config python3 - "$DAEMON_CONFIG" "$backup_path" "$LOG_MAX_SIZE" "$LOG_MAX_FILE" <<'PY'
import json
import os
import shutil
import sys

path, backup_path, max_size, max_file = sys.argv[1:5]
config = {}

if os.path.exists(path) and os.path.getsize(path) > 0:
    with open(path, "r", encoding="utf-8") as handle:
        config = json.load(handle)

if not isinstance(config, dict):
    raise SystemExit(f"{path} must contain a JSON object")

before = json.dumps(config, sort_keys=True, separators=(",", ":"))
config["log-driver"] = "json-file"
config["log-opts"] = {
    "max-size": str(max_size),
    "max-file": str(max_file),
}
after = json.dumps(config, sort_keys=True, separators=(",", ":"))

if before == after:
    print("UNCHANGED")
    raise SystemExit(0)

parent = os.path.dirname(path) or "."
os.makedirs(parent, exist_ok=True)
if os.path.exists(path):
    shutil.copy2(path, backup_path)

tmp_path = f"{path}.tmp"
with open(tmp_path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2, sort_keys=True)
    handle.write("\n")
os.replace(tmp_path, path)
print("CHANGED")
PY
  )"

  case "$merge_result" in
    UNCHANGED)
      log "Docker daemon config already has json-file rotation (${LOG_MAX_SIZE}, ${LOG_MAX_FILE})."
      return 0
      ;;
    CHANGED)
      log "Docker daemon config updated with json-file rotation (${LOG_MAX_SIZE}, ${LOG_MAX_FILE})."
      ;;
    *)
      die "Unexpected daemon config merge result: ${merge_result}"
      ;;
  esac

  if ! validate_daemon_config; then
    restore_daemon_backup "$original_exists"
    die "Docker daemon config validation failed"
  fi

  if [ "$RESTART_IF_CHANGED" -eq 1 ]; then
    if [ "$DAEMON_CONFIG" != "/etc/docker/daemon.json" ]; then
      log "Custom daemon config ${DAEMON_CONFIG} changed; skipping Docker restart."
      return 0
    fi

    if ! restart_docker; then
      restore_daemon_backup "$original_exists"
      restart_docker || true
      die "Docker restart failed after log rotation config update"
    fi
  else
    log "Docker restart not requested; daemon defaults apply after the next Docker restart."
  fi
}

current_log_type() {
  docker inspect -f '{{.HostConfig.LogConfig.Type}}' "$CONTAINER_NAME"
}

current_log_option() {
  key="$1"
  docker inspect -f "{{with index .HostConfig.LogConfig.Config \"${key}\"}}{{.}}{{end}}" "$CONTAINER_NAME"
}

container_log_config_is_current() {
  [ "$(current_log_type)" = "json-file" ] \
    && [ "$(current_log_option max-size)" = "$LOG_MAX_SIZE" ] \
    && [ "$(current_log_option max-file)" = "$LOG_MAX_FILE" ]
}

wait_for_container_health() {
  deadline=$(( $(date +%s) + WAIT_SECONDS ))
  while [ "$(date +%s)" -le "$deadline" ]; do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    case "$state" in
      healthy|running)
        log "Container ${CONTAINER_NAME} is ${state}."
        return 0
        ;;
    esac
    log "Waiting for ${CONTAINER_NAME} health; current state: ${state:-unknown}"
    sleep 15
  done

  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 "$SERVICE_NAME" || true
  die "Container ${CONTAINER_NAME} did not become healthy within ${WAIT_SECONDS}s"
}

ensure_container_config() {
  [ -n "$CONTAINER_NAME" ] || die "--container is required"
  require_command docker

  if ! container_exists "$CONTAINER_NAME"; then
    log "Container ${CONTAINER_NAME} does not exist; skipping GitLab log config reconciliation."
    return 0
  fi

  if container_log_config_is_current; then
    log "Container ${CONTAINER_NAME} already has Docker log rotation (${LOG_MAX_SIZE}, ${LOG_MAX_FILE})."
    return 0
  fi

  log "Recreating ${CONTAINER_NAME} so Docker log rotation applies."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate "$SERVICE_NAME"
  wait_for_container_health

  if ! container_log_config_is_current; then
    actual_type="$(current_log_type)"
    actual_size="$(current_log_option max-size)"
    actual_file="$(current_log_option max-file)"
    die "Container ${CONTAINER_NAME} LogConfig is still ${actual_type} max-size=${actual_size:-<unset>} max-file=${actual_file:-<unset>}"
  fi

  log "Container ${CONTAINER_NAME} LogConfig verified."
}

[ -n "$MODE" ] || usage
shift

case "$MODE" in
  truncate-container)
    parse_common_options "$@"
    truncate_container_log
    ;;
  apply-daemon)
    parse_common_options "$@"
    apply_daemon_config
    ;;
  ensure-container)
    parse_common_options "$@"
    ensure_container_config
    ;;
  -h|--help)
    usage 0
    ;;
  *)
    usage
    ;;
esac
