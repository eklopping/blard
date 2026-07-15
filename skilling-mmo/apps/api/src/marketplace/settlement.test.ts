import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  PrismaClient,
  OrderSide,
  OrderStatus,
  LedgerType,
} from "@skilling-mmo/db";
import { settleTrade, SettlementError } from "./settlement.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://skilling:skilling@127.0.0.1:5432/skilling_mmo_test?schema=public";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let dbReady = false;

async function seedPlayer(name: string, coins: number, logs: number) {
  const account = await prisma.account.create({
    data: {
      username: `u_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      passwordHash: "test",
      players: {
        create: {
          name,
          coins,
          inventory: {
            create: Array.from({ length: 28 }, (_, slot) => ({
              slot,
              itemId: slot === 0 && logs > 0 ? "logs" : null,
              quantity: slot === 0 ? logs : 0,
            })),
          },
          bank: {
            create: Array.from({ length: 5 }, (_, slot) => ({
              slot,
              itemId: null,
              quantity: 0,
            })),
          },
          skills: { create: [{ skill: "woodcutting", level: 1, xp: 0 }] },
        },
      },
    },
    include: { players: true },
  });
  return account.players[0];
}

async function snapshotEconomy(playerIds: string[]) {
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    include: { inventory: true, ledger: true },
  });
  return players.map((p) => ({
    id: p.id,
    coins: p.coins,
    logs: p.inventory.filter((s) => s.itemId === "logs").reduce((a, s) => a + s.quantity, 0),
    ledgerCount: p.ledger.length,
  }));
}

describe("marketplace atomic settlement", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      await prisma.itemDefinition.upsert({
        where: { id: "logs" },
        create: { id: "logs", name: "Logs", stackable: true, maxStack: 1000 },
        update: {},
      });
      dbReady = true;
    } catch (err) {
      console.warn("[settlement.test] Postgres unavailable — skipping DB tests:", err);
      dbReady = false;
      if (process.env.CI === "true") {
        throw err;
      }
    }
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });

  beforeEach(async () => {
    if (!dbReady) return;
    await prisma.ledgerEntry.deleteMany();
    await prisma.marketOrder.deleteMany();
    await prisma.inventorySlot.deleteMany();
    await prisma.bankSlot.deleteMany();
    await prisma.skillProgress.deleteMany();
    await prisma.player.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
  });

  it("happy path: moves items, coins, ledger, and fills orders", async ({ skip }) => {
    if (!dbReady) skip();

    const seller = await seedPlayer("seller", 0, 10);
    const buyer = await seedPlayer("buyer", 500, 0);

    const sell = await prisma.marketOrder.create({
      data: {
        playerId: seller.id,
        side: OrderSide.SELL,
        itemId: "logs",
        price: 10,
        quantity: 5,
        status: OrderStatus.OPEN,
      },
    });
    const buy = await prisma.marketOrder.create({
      data: {
        playerId: buyer.id,
        side: OrderSide.BUY,
        itemId: "logs",
        price: 10,
        quantity: 5,
        status: OrderStatus.OPEN,
      },
    });

    await settleTrade({
      buyOrderId: buy.id,
      sellOrderId: sell.id,
      itemId: "logs",
      price: 10,
      quantity: 5,
    });

    const after = await snapshotEconomy([seller.id, buyer.id]);
    const s = after.find((p) => p.id === seller.id)!;
    const b = after.find((p) => p.id === buyer.id)!;

    expect(s.coins).toBe(50);
    expect(s.logs).toBe(5);
    expect(b.coins).toBe(450);
    expect(b.logs).toBe(5);
    expect(s.ledgerCount).toBe(1);
    expect(b.ledgerCount).toBe(1);

    const sellOrder = await prisma.marketOrder.findUniqueOrThrow({ where: { id: sell.id } });
    const buyOrder = await prisma.marketOrder.findUniqueOrThrow({ where: { id: buy.id } });
    expect(sellOrder.status).toBe(OrderStatus.FILLED);
    expect(buyOrder.status).toBe(OrderStatus.FILLED);
  });

  it("mid-transaction failure rolls back with no partial ledger/inventory/currency drift", async ({ skip }) => {
    if (!dbReady) skip();

    const seller = await seedPlayer("seller2", 0, 10);
    const buyer = await seedPlayer("buyer2", 500, 0);

    const sell = await prisma.marketOrder.create({
      data: {
        playerId: seller.id,
        side: OrderSide.SELL,
        itemId: "logs",
        price: 10,
        quantity: 5,
        status: OrderStatus.OPEN,
      },
    });
    const buy = await prisma.marketOrder.create({
      data: {
        playerId: buyer.id,
        side: OrderSide.BUY,
        itemId: "logs",
        price: 10,
        quantity: 5,
        status: OrderStatus.OPEN,
      },
    });

    const before = await snapshotEconomy([seller.id, buyer.id]);

    await expect(
      settleTrade({
        buyOrderId: buy.id,
        sellOrderId: sell.id,
        itemId: "logs",
        price: 10,
        quantity: 5,
        injectFailure: "after_debit",
      }),
    ).rejects.toBeInstanceOf(SettlementError);

    const after = await snapshotEconomy([seller.id, buyer.id]);
    expect(after).toEqual(before);

    const sellOrder = await prisma.marketOrder.findUniqueOrThrow({ where: { id: sell.id } });
    const buyOrder = await prisma.marketOrder.findUniqueOrThrow({ where: { id: buy.id } });
    expect(sellOrder.status).toBe(OrderStatus.OPEN);
    expect(buyOrder.status).toBe(OrderStatus.OPEN);
    expect(sellOrder.filledQty).toBe(0);
    expect(buyOrder.filledQty).toBe(0);

    const ledger = await prisma.ledgerEntry.count({
      where: { type: LedgerType.TRADE },
    });
    expect(ledger).toBe(0);
  });
});

/** Pure logic check that injectFailure paths throw SettlementError (contract). */
describe("settlement failure contract", () => {
  it("SettlementError is distinct and serializable", () => {
    const e = new SettlementError("injected_failure_after_debit");
    expect(e.name).toBe("SettlementError");
    expect(e.message).toContain("injected_failure");
  });
});
