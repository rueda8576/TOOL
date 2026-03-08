FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/api... --filter @doctoral/db... --frozen-lockfile=false

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/api... --filter @doctoral/db... --frozen-lockfile=false
RUN pnpm --filter @doctoral/db db:generate
RUN pnpm --filter @doctoral/api build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/db/prisma ./packages/db/prisma
COPY --from=build /app/node_modules/.pnpm ./node_modules/.pnpm
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
