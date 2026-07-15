# Skilling MMO

2D skilling MMO-lite monorepo: Phaser + React client, Colyseus game server, Fastify API (auth + marketplace), BullMQ worker, Postgres, Redis, Caddy.

## Quick start (local)

```bash
cp .env.example .env
npm install
npm run db:generate
# Start Postgres (and optional Redis):
docker compose up -d postgres
# Apply migrations
export DATABASE_URL=postgresql://skilling:skilling@127.0.0.1:5432/skilling_mmo?schema=public
npm run db:deploy

# Terminals:
npm run dev:api
npm run dev:game
npm run dev:client
# Optional full stack worker+redis:
docker compose --profile full up -d redis worker
npm run dev:worker
```

Or build everything via Compose (Caddy on http://localhost:8080 — build client first):

```bash
cp .env.example .env
npm install && npm run build -w @skilling-mmo/shared && npm run build -w @skilling-mmo/client
docker compose up --build
```

Use compose profile `full` for Redis + worker: `docker compose --profile full up --build`.

## Repo layout

| Path | Role |
|------|------|
| `packages/shared` | Protocol, XP tables, item defs |
| `packages/db` | Prisma schema + migrations |
| `apps/api` | Auth, REST, marketplace settlement |
| `apps/game-server` | Colyseus `WorldRoom`, 600ms tick, woodcutting |
| `apps/worker` | Stale orders / daily reset stubs |
| `apps/client` | Vite + Phaser + React overlay |
| `infra/caddy` | Reverse proxy |
| `scripts/` | VM provision + deploy |

## Auth

- `POST /api/auth/register` · `POST /api/auth/login` — argon2id + JWT
- Game join: Colyseus `onAuth` verifies JWT (`options.token`)

## Marketplace integrity

Settlement runs only inside `prisma.$transaction` in `apps/api/src/marketplace/settlement.ts`. Redis order book is a cache; never authorizes settlement alone. Tests cover happy path + mid-tx abort with no ledger/inventory/currency drift.

```bash
# Requires migrated test DB
DATABASE_URL=postgresql://skilling:skilling@127.0.0.1:5432/skilling_mmo_test?schema=public npm run test -w @skilling-mmo/api
```

## Deploy path A — GHCR + Ubuntu VM

1. Push to `main` → `.github/workflows/publish-images.yml` builds/pushes:
   - `ghcr.io/<owner>/skilling-mmo-api`
   - `ghcr.io/<owner>/skilling-mmo-game-server`
   - `ghcr.io/<owner>/skilling-mmo-worker`
   - `ghcr.io/<owner>/skilling-mmo-client` (static assets + Caddy)
2. On the VM:

```bash
sudo APP_DIR=/opt/skilling-mmo GHCR_USER=... GHCR_TOKEN=... bash scripts/provision-vm.sh
# Copy docker-compose.prod.yml + .env (set GHCR_OWNER, DOMAIN, secrets) into APP_DIR
sudo APP_DIR=/opt/skilling-mmo DEPLOY_MODE=ghcr bash scripts/deploy.sh
```

`deploy.sh` pulls images, runs `prisma migrate deploy`, then `docker compose -f docker-compose.prod.yml up -d`.

## Deploy path B — source build on VM

```bash
sudo bash scripts/provision-vm.sh
# Clone repo into APP_DIR, configure .env
sudo APP_DIR=/opt/skilling-mmo DEPLOY_MODE=source bash scripts/deploy.sh
```

## Secrets

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | API + game-server JWT signing |
| `POSTGRES_PASSWORD` | DB |
| `DATABASE_URL` | Prisma |
| `REDIS_URL` / `REDIS_ENABLED` | Order book + BullMQ (`full` / prod) |
| `GHCR_OWNER` | Prod image namespace |
| `DOMAIN` | Caddy site address |
| `GHCR_TOKEN` | `docker login ghcr.io` on VM |

## Backups

- Schedule `pg_dump` (or `pg_dump -Fc`) cron against Postgres; keep off-box copies.
- For PITR, enable Postgres WAL archiving / managed backup — dump-only restores are point-in-time coarse.

## Out of scope (this milestone)

Combat simulation, real art, email, multi-shard, Kubernetes. PvP seams are stubbed with `TODO` in `apps/game-server/src/pvp/matchmaker.ts`.
