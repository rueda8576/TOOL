#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <db-dump.sql> <storage-archive.tar.gz>"
  exit 1
fi

DB_DUMP="$1"
STORAGE_ARCHIVE="$2"

if [ ! -f "$DB_DUMP" ]; then
  echo "Missing DB dump: $DB_DUMP"
  exit 1
fi

if [ ! -f "$STORAGE_ARCHIVE" ]; then
  echo "Missing storage archive: $STORAGE_ARCHIVE"
  exit 1
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${STORAGE_ROOT:?STORAGE_ROOT is required}"

psql "$DATABASE_URL" -f "$DB_DUMP"
mkdir -p "$STORAGE_ROOT"
tar -xzf "$STORAGE_ARCHIVE" -C "$STORAGE_ROOT"

echo "Restore completed."
