# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/client/package.json apps/client/
COPY apps/api/package.json apps/api/
COPY apps/game-server/package.json apps/game-server/
COPY apps/worker/package.json apps/worker/
RUN npm install --workspace=@skilling-mmo/client --workspace=@skilling-mmo/shared --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/client apps/client
COPY tsconfig.base.json ./
ARG VITE_API_URL=/api
# Leave empty so the browser uses same-origin (Caddy proxies /matchmake + WebSocket).
# Do NOT set to /ws — Colyseus.js needs a full host URL, not a path.
ARG VITE_WS_URL=
ENV VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL
RUN npm run build -w @skilling-mmo/shared && npm run build -w @skilling-mmo/client

FROM caddy:2-alpine AS runner
COPY --from=build /app/apps/client/dist /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
