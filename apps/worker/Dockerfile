FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/worker... --filter @doctoral/db... --frozen-lockfile=false

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/worker... --filter @doctoral/db... --frozen-lockfile=false
RUN pnpm --filter @doctoral/db db:generate
RUN pnpm --filter @doctoral/worker build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/node_modules/.pnpm ./node_modules/.pnpm
CMD ["node", "apps/worker/dist/main.js"]
