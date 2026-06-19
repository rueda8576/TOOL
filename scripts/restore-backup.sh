#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/restore-backup.sh validate <db.dump> <storage.tar.gz>
  scripts/restore-backup.sh drill <db.dump> <storage.tar.gz>
  scripts/restore-backup.sh restore <db.dump> <storage.tar.gz>

Environment:
  ATLASIUM_DRILL_DATABASE_URL       Required for drill.
  ATLASIUM_RESTORE_DATABASE_URL     Required for restore.
  ATLASIUM_RESTORE_STORAGE_ROOT     Required for restore.
  ATLASIUM_RESTORE_CONFIRM=restore  Required for restore.

Notes:
  validate is non-destructive.
  drill restores into ATLASIUM_DRILL_DATABASE_URL and extracts storage into a temporary directory.
  restore refuses to run against DATABASE_URL and swaps storage only after pg_restore succeeds.
USAGE
}

fail() {
  printf 'restore-backup: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

redact_url() {
  printf '%s' "$1" | sed -E 's#(postgres(ql)?://)[^/@]+@#\1[credentials]@#'
}

ensure_backup_inputs() {
  local db_dump="$1"
  local storage_archive="$2"

  [ -f "$db_dump" ] || fail "database dump not found: $db_dump"
  [ -f "$storage_archive" ] || fail "storage archive not found: $storage_archive"
}

validate_backup() {
  local db_dump="$1"
  local storage_archive="$2"

  ensure_backup_inputs "$db_dump" "$storage_archive"
  require_command pg_restore
  require_command tar
  require_command sha256sum

  printf 'Validating database dump: %s\n' "$db_dump"
  pg_restore --list "$db_dump" >/dev/null

  printf 'Validating storage archive: %s\n' "$storage_archive"
  tar -tzf "$storage_archive" >/dev/null

  printf 'Database dump SHA-256: '
  sha256sum "$db_dump" | awk '{ print $1 }'
  printf 'Storage archive SHA-256: '
  sha256sum "$storage_archive" | awk '{ print $1 }'
  printf 'Backup validation complete.\n'
}

ensure_not_primary_database() {
  local target_url="$1"

  [ -n "$target_url" ] || fail "target database URL is required"
  if [ -n "${DATABASE_URL:-}" ] && [ "$target_url" = "$DATABASE_URL" ]; then
    fail "target database URL matches DATABASE_URL; refusing to restore over the configured primary database"
  fi
}

restore_database() {
  local db_dump="$1"
  local target_url="$2"

  require_command pg_restore
  ensure_not_primary_database "$target_url"
  printf 'Restoring database into %s\n' "$(redact_url "$target_url")"
  pg_restore --clean --if-exists --no-owner --no-acl --dbname="$target_url" "$db_dump"
}

drill_backup() {
  local db_dump="$1"
  local storage_archive="$2"
  local target_url="${ATLASIUM_DRILL_DATABASE_URL:-}"
  local temp_storage

  [ -n "$target_url" ] || fail "ATLASIUM_DRILL_DATABASE_URL is required for drill"
  ensure_not_primary_database "$target_url"
  validate_backup "$db_dump" "$storage_archive"

  temp_storage="$(mktemp -d "${TMPDIR:-/tmp}/atlasium-restore-drill.XXXXXX")"
  trap 'rm -rf "$temp_storage"' EXIT

  restore_database "$db_dump" "$target_url"
  tar -xzf "$storage_archive" -C "$temp_storage"
  printf 'Storage drill extracted into temporary directory with %s entries.\n' "$(find "$temp_storage" -mindepth 1 | wc -l | awk '{ print $1 }')"
  printf 'Restore drill complete.\n'
}

restore_backup() {
  local db_dump="$1"
  local storage_archive="$2"
  local target_url="${ATLASIUM_RESTORE_DATABASE_URL:-}"
  local storage_root="${ATLASIUM_RESTORE_STORAGE_ROOT:-}"
  local temp_storage
  local previous_storage
  local stamp

  [ "${ATLASIUM_RESTORE_CONFIRM:-}" = "restore" ] || fail "set ATLASIUM_RESTORE_CONFIRM=restore before running restore"
  [ -n "$target_url" ] || fail "ATLASIUM_RESTORE_DATABASE_URL is required for restore"
  [ -n "$storage_root" ] || fail "ATLASIUM_RESTORE_STORAGE_ROOT is required for restore"
  ensure_not_primary_database "$target_url"
  validate_backup "$db_dump" "$storage_archive"

  temp_storage="$(mktemp -d "${TMPDIR:-/tmp}/atlasium-storage-restore.XXXXXX")"
  trap 'rm -rf "$temp_storage"' EXIT
  tar -xzf "$storage_archive" -C "$temp_storage"

  restore_database "$db_dump" "$target_url"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  previous_storage="${storage_root}.before-restore-${stamp}"
  mkdir -p "$(dirname "$storage_root")"

  if [ -e "$storage_root" ]; then
    mv "$storage_root" "$previous_storage"
    printf 'Previous storage moved to %s\n' "$previous_storage"
  fi

  mv "$temp_storage" "$storage_root"
  trap - EXIT
  printf 'Storage restored to %s\n' "$storage_root"
  printf 'Restore complete.\n'
}

main() {
  local command="${1:-}"
  local db_dump="${2:-}"
  local storage_archive="${3:-}"

  case "$command" in
    validate)
      [ -n "$db_dump" ] && [ -n "$storage_archive" ] || { usage; exit 2; }
      validate_backup "$db_dump" "$storage_archive"
      ;;
    drill)
      [ -n "$db_dump" ] && [ -n "$storage_archive" ] || { usage; exit 2; }
      drill_backup "$db_dump" "$storage_archive"
      ;;
    restore)
      [ -n "$db_dump" ] && [ -n "$storage_archive" ] || { usage; exit 2; }
      restore_backup "$db_dump" "$storage_archive"
      ;;
    -h|--help|help|"")
      usage
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
