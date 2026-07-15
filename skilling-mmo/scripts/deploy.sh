#!/usr/bin/env bash
# Deploy skilling-mmo on a provisioned VM.
# Modes:
#   DEPLOY_MODE=ghcr   (default) — pull GHCR images via docker-compose.prod.yml
#   DEPLOY_MODE=source — git pull + docker compose build from source
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/skilling-mmo}"
DEPLOY_MODE="${DEPLOY_MODE:-ghcr}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $APP_DIR/.env — copy from .env.example and fill secrets." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a
export IMAGE_TAG

if [[ "$DEPLOY_MODE" == "source" ]]; then
  if [[ -d .git ]]; then
    git pull --ff-only
  fi
  docker compose -f docker-compose.yml --profile full build
  docker compose -f docker-compose.yml run --rm api \
    sh -c "cd /app && npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma" \
    || docker compose -f docker-compose.yml run --rm -w /app/packages/db api npx prisma migrate deploy
  docker compose -f docker-compose.yml --profile full up -d
else
  docker compose -f "$COMPOSE_FILE" pull
  # Run migrations using the api image
  docker compose -f "$COMPOSE_FILE" run --rm --entrypoint "" api \
    sh -c 'cd /app/packages/db && npx prisma migrate deploy'
  docker compose -f "$COMPOSE_FILE" up -d
fi

echo "Deploy finished ($DEPLOY_MODE)."
docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || docker compose ps
