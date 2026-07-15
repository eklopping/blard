import type { FastifyInstance } from "fastify";
import { prisma, OrderSide, OrderStatus } from "@skilling-mmo/db";
import { z } from "zod";
import { getRedis } from "../redis.js";
import { OrderBook } from "./orderBook.js";
import { matchOrder } from "./settlement.js";

const placeSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  itemId: z.string().min(1),
  price: z.number().int().positive(),
  quantity: z.number().int().positive().max(10000),
});

export async function marketRoutes(app: FastifyInstance) {
  app.get("/orders", async (req) => {
    const q = req.query as { itemId?: string };
    const where = q.itemId
      ? { itemId: q.itemId, status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] } }
      : { status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] } };
    const orders = await prisma.marketOrder.findMany({
      where,
      orderBy: [{ price: "asc" }, { createdAt: "asc" }],
      take: 100,
    });
    return { orders };
  });

  app.get("/book/:itemId", async (req) => {
    const { itemId } = req.params as { itemId: string };
    const redis = getRedis();
    if (redis) {
      const book = new OrderBook(redis);
      const [bids, asks] = await Promise.all([
        book.list(itemId, OrderSide.BUY),
        book.list(itemId, OrderSide.SELL),
      ]);
      return { bids, asks };
    }
    const [buys, sells] = await Promise.all([
      prisma.marketOrder.findMany({
        where: { itemId, side: OrderSide.BUY, status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] } },
        orderBy: [{ price: "desc" }, { createdAt: "asc" }],
        take: 50,
      }),
      prisma.marketOrder.findMany({
        where: { itemId, side: OrderSide.SELL, status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] } },
        orderBy: [{ price: "asc" }, { createdAt: "asc" }],
        take: 50,
      }),
    ]);
    return {
      bids: buys.map((o) => ({ orderId: o.id, price: o.price, remaining: o.quantity - o.filledQty })),
      asks: sells.map((o) => ({ orderId: o.id, price: o.price, remaining: o.quantity - o.filledQty })),
    };
  });

  app.get("/history", { preHandler: [app.authenticate] }, async (req) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { playerId: req.user.playerId, type: "TRADE" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { entries };
  });

  app.get("/mine", { preHandler: [app.authenticate] }, async (req) => {
    const orders = await prisma.marketOrder.findMany({
      where: { playerId: req.user.playerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { orders };
  });

  app.post("/orders", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = placeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const { side, itemId, price, quantity } = parsed.data;
    const playerId = req.user.playerId;

    const item = await prisma.itemDefinition.findUnique({ where: { id: itemId } });
    if (!item) return reply.code(400).send({ error: "unknown_item" });

    // For SELL: reserve items stay in inventory until fill (validated at match time)
    // For BUY: coins checked at match time
    if (side === "SELL") {
      const slots = await prisma.inventorySlot.findMany({ where: { playerId, itemId } });
      const total = slots.reduce((s, x) => s + x.quantity, 0);
      if (total < quantity) return reply.code(400).send({ error: "insufficient_items" });
    } else {
      const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
      if (player.coins < price * quantity) {
        return reply.code(400).send({ error: "insufficient_coins" });
      }
    }

    const order = await prisma.marketOrder.create({
      data: {
        playerId,
        side: side as OrderSide,
        itemId,
        price,
        quantity,
        status: OrderStatus.OPEN,
      },
    });

    const redis = getRedis();
    if (redis) {
      const book = new OrderBook(redis);
      await book.add({ id: order.id, itemId, side: order.side, price, remaining: quantity });
    }

    await matchOrder(order.id);

    // Sync Redis book with committed state
    if (redis) {
      const book = new OrderBook(redis);
      await book.rebuildFromDb();
    }

    const updated = await prisma.marketOrder.findUniqueOrThrow({ where: { id: order.id } });
    return { order: updated };
  });

  app.post("/orders/:id/cancel", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await prisma.marketOrder.findUnique({ where: { id } });
    if (!order || order.playerId !== req.user.playerId) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (![OrderStatus.OPEN, OrderStatus.PARTIAL].includes(order.status as any)) {
      return reply.code(400).send({ error: "not_cancellable" });
    }
    const updated = await prisma.marketOrder.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED },
    });
    const redis = getRedis();
    if (redis) {
      const book = new OrderBook(redis);
      await book.remove(order.itemId, order.side, order.id);
    }
    return { order: updated };
  });
}
