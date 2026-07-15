import type { Redis } from "ioredis";
import { prisma, OrderSide, OrderStatus } from "@skilling-mmo/db";

/** Redis sorted-set order book. Score = price (buys desc via negative? We use members + filter). */
export class OrderBook {
  constructor(private redis: Redis) {}

  private key(itemId: string, side: OrderSide): string {
    return `book:${itemId}:${side}`;
  }

  async add(order: {
    id: string;
    itemId: string;
    side: OrderSide;
    price: number;
    remaining: number;
  }): Promise<void> {
    // member: orderId:remaining — score is price
    await this.redis.zadd(this.key(order.itemId, order.side), order.price, `${order.id}:${order.remaining}`);
  }

  async remove(itemId: string, side: OrderSide, orderId: string): Promise<void> {
    const key = this.key(itemId, side);
    const members = await this.redis.zrange(key, 0, -1);
    for (const m of members) {
      if (m.startsWith(`${orderId}:`)) {
        await this.redis.zrem(key, m);
      }
    }
  }

  async list(itemId: string, side: OrderSide, limit = 50): Promise<{ orderId: string; price: number; remaining: number }[]> {
    const key = this.key(itemId, side);
    // SELLs ascending (cheap first), BUYs descending (expensive first)
    const rows =
      side === OrderSide.SELL
        ? await this.redis.zrange(key, 0, limit - 1, "WITHSCORES")
        : await this.redis.zrevrange(key, 0, limit - 1, "WITHSCORES");
    const out: { orderId: string; price: number; remaining: number }[] = [];
    for (let i = 0; i < rows.length; i += 2) {
      const [orderId, rem] = rows[i].split(":");
      out.push({ orderId, price: Number(rows[i + 1]), remaining: Number(rem) });
    }
    return out;
  }

  async rebuildFromDb(): Promise<void> {
    const open = await prisma.marketOrder.findMany({
      where: { status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] } },
    });
    const pipe = this.redis.pipeline();
    // wipe known keys by scanning item defs
    const items = await prisma.itemDefinition.findMany();
    for (const item of items) {
      pipe.del(this.key(item.id, OrderSide.BUY));
      pipe.del(this.key(item.id, OrderSide.SELL));
    }
    await pipe.exec();

    for (const o of open) {
      const remaining = o.quantity - o.filledQty;
      if (remaining > 0) {
        await this.add({
          id: o.id,
          itemId: o.itemId,
          side: o.side,
          price: o.price,
          remaining,
        });
      }
    }
  }
}
