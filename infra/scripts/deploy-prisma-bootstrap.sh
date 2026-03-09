#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <image_tag>" >&2
  exit 1
fi

IMAGE_TAG="$1"
COMPOSE="docker compose -f docker-compose.prod.yml"
echo "Checking Prisma migration state..."
HAS_TABLE="$(
  IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} exec -T postgres \
    psql -U postgres -d doctoral_platform -tA -c "SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN 0 ELSE 1 END;" \
    | tr -d '[:space:]'
)"

FINISHED_COUNT=0
FAILED_COUNT=0
if [ "${HAS_TABLE}" = "1" ]; then
  COUNTS="$(
    IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} exec -T postgres \
      psql -U postgres -d doctoral_platform -tA -F '|' -c "SELECT COUNT(*) FILTER (WHERE finished_at IS NOT NULL), COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) FROM public._prisma_migrations;" \
      | tr -d '[:space:]'
  )"
  IFS='|' read -r FINISHED_COUNT FAILED_COUNT <<EOF
${COUNTS}
EOF
fi

if [ "${FAILED_COUNT}" -gt 0 ]; then
  echo "Detected ${FAILED_COUNT} failed Prisma migration record(s). Marking as rolled back..."
  FAILED_NAMES="$(
    IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} exec -T postgres \
      psql -U postgres -d doctoral_platform -tA -c "SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at;" \
      | tr -d '\r'
  )"
  echo "${FAILED_NAMES}" | while IFS= read -r name; do
    [ -n "${name}" ] || continue
    echo "Resolving failed migration as rolled back: ${name}"
    IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} run --rm -e FAILED_NAME="${name}" api sh -lc '
      set -eu
      PRISMA_CLI="$(find /app/node_modules/.pnpm -path "*/node_modules/prisma/build/index.js" | head -n 1)"
      test -n "${PRISMA_CLI}"
      node "${PRISMA_CLI}" migrate resolve --rolled-back "${FAILED_NAME}" --schema packages/db/prisma/schema.prisma
    '
  done
fi

if [ "${HAS_TABLE}" != "1" ] || [ "${FINISHED_COUNT}" -eq 0 ]; then
  echo "Fresh DB detected (missing/empty _prisma_migrations). Running one-time Prisma bootstrap..."
  if [ "${HAS_TABLE}" = "1" ]; then
    echo "Prisma migrations table exists but has no successful baseline. Clearing stale rows..."
    IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} exec -T postgres \
      psql -U postgres -d doctoral_platform -c "TRUNCATE TABLE public._prisma_migrations;" >/dev/null
  fi
  IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} run --rm api sh -lc '
    set -eu
    PRISMA_CLI="$(find /app/node_modules/.pnpm -path "*/node_modules/prisma/build/index.js" | head -n 1)"
    test -n "${PRISMA_CLI}"
    node "${PRISMA_CLI}" db push --schema packages/db/prisma/schema.prisma --skip-generate
    for d in packages/db/prisma/migrations/*; do
      [ -d "${d}" ] || continue
      name="$(basename "${d}")"
      node "${PRISMA_CLI}" migrate resolve --applied "${name}" --schema packages/db/prisma/schema.prisma
    done
  '
else
  echo "Prisma baseline already present; skipping bootstrap."
fi

echo "Running migrate deploy..."
IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} run --rm migrate
echo "Prisma migration step completed."
