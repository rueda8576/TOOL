#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "Usage: $0 <image_tag>" >&2
  exit 1
fi

IMAGE_TAG="$1"
COMPOSE="docker compose -f docker-compose.prod.yml"
SQL="SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations') AND EXISTS (SELECT 1 FROM public._prisma_migrations LIMIT 1);"

echo "Checking Prisma baseline state..."
HAS_BASELINE="$(
  IMAGE_TAG="${IMAGE_TAG}" ${COMPOSE} exec -T postgres \
    psql -U postgres -d doctoral_platform -tA -c "${SQL}" \
    | tr -d '[:space:]'
)"

if [ "${HAS_BASELINE}" != "t" ]; then
  echo "Fresh DB detected (missing/empty _prisma_migrations). Running one-time Prisma bootstrap..."
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
