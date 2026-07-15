#!/usr/bin/env bash
# Provision an Ubuntu VM for skilling-mmo (Docker Engine + Compose plugin + app dir + GHCR login).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/skilling-mmo}"
GHCR_USER="${GHCR_USER:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

mkdir -p "$APP_DIR"
echo "App directory: $APP_DIR"

if [[ -n "$GHCR_USER" && -n "$GHCR_TOKEN" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
  echo "Logged into ghcr.io as $GHCR_USER"
else
  echo "Skip GHCR login (set GHCR_USER and GHCR_TOKEN to login now)."
  echo "Later: echo \$GHCR_TOKEN | docker login ghcr.io -u \$GHCR_USER --password-stdin"
fi

echo "Provision complete. Copy compose/env into $APP_DIR and run scripts/deploy.sh"
