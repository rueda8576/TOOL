FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/web... --frozen-lockfile=false

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_NODE_LINKER=hoisted
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN pnpm install --filter @doctoral/web... --frozen-lockfile=false
RUN pnpm --filter @doctoral/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/node_modules/.pnpm ./node_modules/.pnpm
EXPOSE 3000
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3000"]
