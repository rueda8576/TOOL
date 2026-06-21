FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/api... --filter @doctoral/db... --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/api... --filter @doctoral/db... --frozen-lockfile
RUN pnpm --filter @doctoral/db db:generate
RUN pnpm --filter @doctoral/shared build
RUN pnpm --filter @doctoral/api build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 atlasium \
  && useradd --system --uid 10001 --gid atlasium --home-dir /tmp --no-create-home atlasium \
  && mkdir -p /var/lib/atlasium/storage \
  && chown -R atlasium:atlasium /app /var/lib/atlasium /tmp
COPY --from=build --chown=atlasium:atlasium /app/apps/api ./apps/api
COPY --from=build --chown=atlasium:atlasium /app/packages/db/prisma ./packages/db/prisma
COPY --from=build --chown=atlasium:atlasium /app/packages/shared ./packages/shared
COPY --from=build --chown=atlasium:atlasium /app/node_modules ./node_modules
EXPOSE 4000
USER atlasium
CMD ["node", "apps/api/dist/main.js"]
