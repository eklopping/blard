import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { prisma } from "@skilling-mmo/db";
import { authRoutes } from "./auth/routes.js";
import { marketRoutes } from "./marketplace/routes.js";
import { playerRoutes } from "./routes/player.js";
import { getRedis, isRedisEnabled } from "./redis.js";
import { OrderBook } from "./marketplace/orderBook.js";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "0.0.0.0";
const jwtSecret = process.env.JWT_SECRET ?? "dev-secret-change-me";

async function seedItems() {
  const items = [
    { id: "logs", name: "Logs", stackable: true, maxStack: 1000 },
    { id: "oak_logs", name: "Oak logs", stackable: true, maxStack: 1000 },
    { id: "coins", name: "Coins", stackable: true, maxStack: 2147483647 },
  ];
  for (const item of items) {
    await prisma.itemDefinition.upsert({
      where: { id: item.id },
      create: item,
      update: { name: item.name, stackable: item.stackable, maxStack: item.maxStack },
    });
  }
}

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? true });
  await app.register(jwt, { secret: jwtSecret });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.decorate("authenticateCharacter", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
      if (!request.user?.playerId) {
        return reply.code(403).send({ error: "character_required" });
      }
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "api",
    redis: isRedisEnabled() ? "enabled" : "disabled",
  }));

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(playerRoutes, { prefix: "/player" });
  await app.register(marketRoutes, { prefix: "/market" });

  try {
    await prisma.$connect();
    await seedItems();
    if (isRedisEnabled()) {
      const redis = getRedis();
      if (redis) {
        const book = new OrderBook(redis);
        await book.rebuildFromDb();
        app.log.info("Order book reconstructed from Postgres");
      }
    }
  } catch (err) {
    app.log.warn({ err }, "DB/Redis init deferred — will retry on first request");
  }

  await app.listen({ port, host });
  app.log.info(`API listening on ${host}:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
    authenticateCharacter: (request: any, reply: any) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; username: string; playerId?: string; profession?: string };
    user: { sub: string; username: string; playerId?: string; profession?: string };
  }
}
