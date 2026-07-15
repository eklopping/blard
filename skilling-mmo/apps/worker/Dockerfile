# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/game-server/package.json apps/game-server/
COPY apps/worker/package.json apps/worker/
COPY apps/client/package.json apps/client/
RUN npm install --workspace=@skilling-mmo/worker --workspace=@skilling-mmo/shared --workspace=@skilling-mmo/db --include-workspace-root=false

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/worker apps/worker
COPY tsconfig.base.json ./
RUN npm run build -w @skilling-mmo/shared && npm run build -w @skilling-mmo/db && npm run build -w @skilling-mmo/worker

FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/package.json ./
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
