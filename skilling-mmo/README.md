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

Or build everything via Compose (Caddy serves the client on **http://localhost** port 80):

```bash
cp .env.example .env
docker compose --profile full up --build
```

The `caddy` service builds the Vite client into the image — no host `apps/client/dist` required.

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
2. On the VM (if the repo root contains a `skilling-mmo/` subfolder, set `APP_DIR` to that path):

```bash
git clone git@github.com:<owner>/<repo>.git /opt/skilling-mmo-repo
export APP_DIR=/opt/skilling-mmo-repo/skilling-mmo
sudo APP_DIR="$APP_DIR" GHCR_USER=... GHCR_TOKEN=... bash "$APP_DIR/scripts/provision-vm.sh"
# Configure .env in APP_DIR (GHCR_OWNER, DOMAIN, secrets)
sudo APP_DIR="$APP_DIR" DEPLOY_MODE=ghcr bash "$APP_DIR/scripts/deploy.sh"
```

`deploy.sh` pulls images, runs `prisma migrate deploy`, then `docker compose -f docker-compose.prod.yml up -d`.

## Deploy path B — source build on VM (recommended first deploy)

```bash
sudo git clone https://github.com/eklopping/blard.git /opt/skilling-mmo-repo
export APP_DIR=/opt/skilling-mmo-repo/skilling-mmo

sudo APP_DIR="$APP_DIR" bash "$APP_DIR/scripts/provision-vm.sh"
sudo cp "$APP_DIR/.env.example" "$APP_DIR/.env"
# Edit JWT_SECRET, POSTGRES_PASSWORD, DATABASE_URL, DOMAIN, GHCR_OWNER=eklopping
sudo nano "$APP_DIR/.env"

sudo APP_DIR="$APP_DIR" DEPLOY_MODE=source bash "$APP_DIR/scripts/deploy.sh"
```

Open `http://YOUR_VM_IP` (Caddy on port 80). Confirm all six services are Up:

```bash
sudo docker compose -f "$APP_DIR/docker-compose.yml" --profile full ps
```

### Updating from git (source mode)

```bash
cd /opt/skilling-mmo-repo
sudo git pull --ff-only
export APP_DIR=/opt/skilling-mmo-repo/skilling-mmo
sudo APP_DIR="$APP_DIR" DEPLOY_MODE=source bash "$APP_DIR/scripts/deploy.sh"
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
