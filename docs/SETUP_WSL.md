# WSL Development Setup

This repository expects Node.js 22 LTS, pnpm, and Docker Desktop WSL integration.

## 1. Node.js 22
Using `nvm`:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22
node -v
```

## 2. pnpm
```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm -v
```

## 3. Docker Desktop integration
- Enable WSL integration for this distro in Docker Desktop settings.
- Verify:

```bash
docker --version
docker compose version
```

## 4. Project bootstrap
```bash
cp .env.example .env
docker compose up -d postgres redis mailpit
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```
