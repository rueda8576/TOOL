FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/web... --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/web... --frozen-lockfile
RUN pnpm --filter @doctoral/shared build
RUN pnpm --filter @doctoral/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 10001 atlasium \
  && useradd --system --uid 10001 --gid atlasium --home-dir /tmp --no-create-home atlasium \
  && chown -R atlasium:atlasium /app /tmp
COPY --from=build --chown=atlasium:atlasium /app/apps/web ./apps/web
COPY --from=build --chown=atlasium:atlasium /app/packages/shared ./packages/shared
COPY --from=build --chown=atlasium:atlasium /app/node_modules ./node_modules
EXPOSE 3000
USER atlasium
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3000"]
