#!/bin/sh
set -eu

STATE_FILE="/opt/atlasium/.deploy-image-state.env"
MIN_FREE_GB=12
TARGET_TAG=""
DRY_RUN=0
MODE="${1:-}"

if [ -z "${MODE}" ]; then
  echo "Usage: sh infra/scripts/manage-docker-retention.sh <diagnose|pre-deploy|finalize-success> [options]" >&2
  exit 1
fi
shift

log() {
  printf '%s\n' "$*"
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_arg() {
  if [ "$#" -lt 2 ] || [ -z "${2}" ]; then
    die "Missing value for $1"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --state-file)
      require_arg "$@"
      STATE_FILE="$2"
      shift 2
      ;;
    --target-tag)
      require_arg "$@"
      TARGET_TAG="$2"
      shift 2
      ;;
    --min-free-gb)
      require_arg "$@"
      MIN_FREE_GB="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift 1
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "docker is required"
command -v awk >/dev/null 2>&1 || die "awk is required"
command -v df >/dev/null 2>&1 || die "df is required"

CURRENT_IMAGE_TAG=""
PREVIOUS_IMAGE_TAG=""
if [ -f "${STATE_FILE}" ]; then
  # shellcheck disable=SC1090
  . "${STATE_FILE}"
fi

PRESERVE_TAGS=""

append_preserve_tag() {
  tag="$1"
  if [ -z "${tag}" ]; then
    return 0
  fi

  case "
${PRESERVE_TAGS}
" in
    *"
${tag}
"*)
      ;;
    *)
      if [ -n "${PRESERVE_TAGS}" ]; then
        PRESERVE_TAGS="${PRESERVE_TAGS}
${tag}"
      else
        PRESERVE_TAGS="${tag}"
      fi
      ;;
  esac
}

is_preserved_tag() {
  tag="$1"
  case "
${PRESERVE_TAGS}
" in
    *"
${tag}
"*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

docker_root_dir() {
  docker info --format '{{ .DockerRootDir }}'
}

available_kb() {
  df -Pk "$(docker_root_dir)" | awk 'NR == 2 { print $4 }'
}

required_kb() {
  awk "BEGIN { print int(${MIN_FREE_GB} * 1024 * 1024) }"
}

human_available() {
  df -h "$(docker_root_dir)" | awk 'NR == 2 { print $4 " free of " $2 " on " $6 }'
}

list_running_atlasium_tags() {
  docker ps --format '{{.Image}}' | awk '
    $0 ~ /(^|\/)atlasium-(api|web|worker):/ {
      split($0, parts, ":");
      print parts[length(parts)];
    }
  ' | sort -u
}

list_atlasium_images() {
  docker image ls --format '{{.Repository}} {{.Tag}}' | awk '
    $1 ~ /(^|\/)atlasium-(api|web|worker)$/ {
      print $1 " " $2
    }
  '
}

run_mutation() {
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] $*"
    return 0
  fi
  "$@"
}

populate_preserve_tags() {
  PRESERVE_TAGS=""
  append_preserve_tag "${CURRENT_IMAGE_TAG}"
  append_preserve_tag "${PREVIOUS_IMAGE_TAG}"
  append_preserve_tag "${TARGET_TAG}"

  running_tags="$(list_running_atlasium_tags || true)"
  if [ -n "${running_tags}" ]; then
    old_ifs="${IFS}"
    IFS='
'
    for running_tag in ${running_tags}; do
      append_preserve_tag "${running_tag}"
    done
    IFS="${old_ifs}"
  fi
}

print_preserve_summary() {
  if [ -z "${PRESERVE_TAGS}" ]; then
    log "Preserved tags: (none)"
    return 0
  fi

  log "Preserved tags:"
  printf '%s\n' "${PRESERVE_TAGS}" | sed '/^$/d' | sed 's/^/  - /'
}

prune_atlasium_images() {
  populate_preserve_tags
  print_preserve_summary

  image_lines="$(list_atlasium_images || true)"
  if [ -z "${image_lines}" ]; then
    log "No non-retained Atlasium images found."
  else
    old_ifs="${IFS}"
    IFS='
'
    for image_line in ${image_lines}; do
      repository="$(printf '%s\n' "${image_line}" | awk '{print $1}')"
      tag="$(printf '%s\n' "${image_line}" | awk '{print $2}')"

      if [ -z "${repository}" ] || [ -z "${tag}" ] || [ "${tag}" = "<none>" ]; then
        continue
      fi

      if is_preserved_tag "${tag}"; then
        continue
      fi

      if [ "${DRY_RUN}" -eq 1 ]; then
        log "[dry-run] docker image rm ${repository}:${tag}"
      elif ! docker image rm "${repository}:${tag}" >/dev/null 2>&1; then
        log "Skipping ${repository}:${tag}; image is still referenced."
      fi
    done
    IFS="${old_ifs}"
  fi

  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] docker image prune -f"
    log "[dry-run] docker builder prune -af"
  else
    docker image prune -f >/dev/null
    docker builder prune -af >/dev/null
  fi
}

write_state_file() {
  state_dir="$(dirname "${STATE_FILE}")"
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] write ${STATE_FILE} with CURRENT_IMAGE_TAG=${CURRENT_IMAGE_TAG} PREVIOUS_IMAGE_TAG=${PREVIOUS_IMAGE_TAG}"
    return 0
  fi

  mkdir -p "${state_dir}"
  cat > "${STATE_FILE}" <<EOF
CURRENT_IMAGE_TAG=${CURRENT_IMAGE_TAG}
PREVIOUS_IMAGE_TAG=${PREVIOUS_IMAGE_TAG}
EOF
}

check_min_free_space() {
  free_kb="$(available_kb)"
  needed_kb="$(required_kb)"
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "[dry-run] free space check skipped; current availability is $(human_available)"
    return 0
  fi

  if [ "${free_kb}" -lt "${needed_kb}" ]; then
    die "Docker root dir has insufficient free space after cleanup: $(human_available). Required minimum: ${MIN_FREE_GB}GB."
  fi

  log "Docker root dir free space OK: $(human_available)"
}

diagnose() {
  populate_preserve_tags
  log "Docker root dir: $(docker_root_dir)"
  log "Current free space: $(human_available)"
  log "State file: ${STATE_FILE}"
  log "State current tag: ${CURRENT_IMAGE_TAG:-<unset>}"
  log "State previous tag: ${PREVIOUS_IMAGE_TAG:-<unset>}"
  print_preserve_summary
  log "Atlasium images detected locally:"
  list_atlasium_images | sed 's/^/  - /'
  log "Docker space summary:"
  docker system df
}

pre_deploy() {
  log "Running Docker retention cleanup before deploy..."
  prune_atlasium_images
  check_min_free_space
}

finalize_success() {
  if [ -z "${TARGET_TAG}" ]; then
    die "--target-tag is required for finalize-success"
  fi

  old_current="${CURRENT_IMAGE_TAG}"
  CURRENT_IMAGE_TAG="${TARGET_TAG}"
  if [ -n "${old_current}" ] && [ "${old_current}" != "${CURRENT_IMAGE_TAG}" ]; then
    PREVIOUS_IMAGE_TAG="${old_current}"
  fi

  log "Recording deploy success state..."
  write_state_file
  prune_atlasium_images
}

case "${MODE}" in
  diagnose)
    diagnose
    ;;
  pre-deploy)
    pre_deploy
    ;;
  finalize-success)
    finalize_success
    ;;
  *)
    die "Unknown mode: ${MODE}"
    ;;
esac
