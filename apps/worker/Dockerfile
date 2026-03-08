FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/worker... --filter @doctoral/db... --frozen-lockfile=false

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/worker... --filter @doctoral/db... --frozen-lockfile=false
RUN pnpm --filter @doctoral/db db:generate
RUN pnpm --filter @doctoral/worker build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]
