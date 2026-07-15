import {
  prisma,
  Prisma,
  OrderSide,
  OrderStatus,
  LedgerType,
  type PrismaClient,
} from "@skilling-mmo/db";

type Tx = Prisma.TransactionClient;

export interface SettlementInput {
  buyOrderId: string;
  sellOrderId: string;
  itemId: string;
  price: number;
  quantity: number;
  /** For tests: throw mid-transaction after locking */
  injectFailure?: "after_lock" | "after_debit";
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

async function lockPlayer(tx: Tx, playerId: string) {
  await tx.$queryRaw`SELECT id FROM "Player" WHERE id = ${playerId} FOR UPDATE`;
}

async function removeInvItems(tx: Tx, playerId: string, itemId: string, qty: number) {
  const slots = await tx.inventorySlot.findMany({
    where: { playerId, itemId },
    orderBy: { slot: "asc" },
  });
  let left = qty;
  for (const slot of slots) {
    if (left <= 0) break;
    const take = Math.min(slot.quantity, left);
    const newQty = slot.quantity - take;
    await tx.inventorySlot.update({
      where: { id: slot.id },
      data: { quantity: newQty, itemId: newQty === 0 ? null : itemId },
    });
    left -= take;
  }
  if (left > 0) throw new SettlementError("seller_missing_items");
}

async function addInvItems(tx: Tx, playerId: string, itemId: string, qty: number) {
  const slots = await tx.inventorySlot.findMany({
    where: { playerId },
    orderBy: { slot: "asc" },
  });
  let left = qty;
  // fill existing stacks first
  for (const slot of slots) {
    if (left <= 0) break;
    if (slot.itemId === itemId) {
      const add = left;
      await tx.inventorySlot.update({
        where: { id: slot.id },
        data: { quantity: slot.quantity + add },
      });
      left = 0;
    }
  }
  for (const slot of slots) {
    if (left <= 0) break;
    if (!slot.itemId || slot.quantity === 0) {
      await tx.inventorySlot.update({
        where: { id: slot.id },
        data: { itemId, quantity: left },
      });
      left = 0;
    }
  }
  if (left > 0) throw new SettlementError("buyer_inventory_full");
}

/**
 * Atomic settlement: lock rows, move items/coins, ledger, update orders.
 * Redis must never authorize settlement alone — call this first, then update book.
 */
export async function settleTrade(
  input: SettlementInput,
  client: PrismaClient = prisma,
): Promise<{ tradeId: string }> {
  const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await client.$transaction(async (tx) => {
    const buy = await tx.marketOrder.findUniqueOrThrow({ where: { id: input.buyOrderId } });
    const sell = await tx.marketOrder.findUniqueOrThrow({ where: { id: input.sellOrderId } });

    if (buy.side !== OrderSide.BUY || sell.side !== OrderSide.SELL) {
      throw new SettlementError("invalid_sides");
    }
    if (buy.itemId !== input.itemId || sell.itemId !== input.itemId) {
      throw new SettlementError("item_mismatch");
    }
    if (![OrderStatus.OPEN, OrderStatus.PARTIAL].includes(buy.status as any)) {
      throw new SettlementError("buy_not_open");
    }
    if (![OrderStatus.OPEN, OrderStatus.PARTIAL].includes(sell.status as any)) {
      throw new SettlementError("sell_not_open");
    }

    const buyRem = buy.quantity - buy.filledQty;
    const sellRem = sell.quantity - sell.filledQty;
    const qty = Math.min(input.quantity, buyRem, sellRem);
    if (qty <= 0) throw new SettlementError("nothing_to_fill");

    const price = input.price;
    const totalCoins = price * qty;

    await lockPlayer(tx, buy.playerId);
    await lockPlayer(tx, sell.playerId);

    if (input.injectFailure === "after_lock") {
      throw new SettlementError("injected_failure_after_lock");
    }

    const buyer = await tx.player.findUniqueOrThrow({ where: { id: buy.playerId } });
    if (buyer.coins < totalCoins) throw new SettlementError("buyer_insufficient_coins");

    // Debit seller items, credit buyer items
    await removeInvItems(tx, sell.playerId, input.itemId, qty);
    await addInvItems(tx, buy.playerId, input.itemId, qty);

    if (input.injectFailure === "after_debit") {
      throw new SettlementError("injected_failure_after_debit");
    }

    await tx.player.update({
      where: { id: buy.playerId },
      data: { coins: { decrement: totalCoins } },
    });
    await tx.player.update({
      where: { id: sell.playerId },
      data: { coins: { increment: totalCoins } },
    });

    const buyFilled = buy.filledQty + qty;
    const sellFilled = sell.filledQty + qty;
    await tx.marketOrder.update({
      where: { id: buy.id },
      data: {
        filledQty: buyFilled,
        status: buyFilled >= buy.quantity ? OrderStatus.FILLED : OrderStatus.PARTIAL,
      },
    });
    await tx.marketOrder.update({
      where: { id: sell.id },
      data: {
        filledQty: sellFilled,
        status: sellFilled >= sell.quantity ? OrderStatus.FILLED : OrderStatus.PARTIAL,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        playerId: buy.playerId,
        type: LedgerType.TRADE,
        itemId: input.itemId,
        deltaQty: qty,
        deltaCoins: -totalCoins,
        refType: "trade",
        refId: tradeId,
        meta: { role: "buyer", counterparty: sell.playerId, price },
      },
    });
    await tx.ledgerEntry.create({
      data: {
        playerId: sell.playerId,
        type: LedgerType.TRADE,
        itemId: input.itemId,
        deltaQty: -qty,
        deltaCoins: totalCoins,
        refType: "trade",
        refId: tradeId,
        meta: { role: "seller", counterparty: buy.playerId, price },
      },
    });
  });

  return { tradeId };
}

/** Match incoming order against resting opposite side in DB (source of truth). */
export async function matchOrder(orderId: string): Promise<number> {
  let fills = 0;
  // Loop until no more crosses
  for (;;) {
    const order = await prisma.marketOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (![OrderStatus.OPEN, OrderStatus.PARTIAL].includes(order.status as any)) break;
    const remaining = order.quantity - order.filledQty;
    if (remaining <= 0) break;

    const opposite = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    const candidates = await prisma.marketOrder.findMany({
      where: {
        itemId: order.itemId,
        side: opposite,
        status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] },
        playerId: { not: order.playerId },
        ...(order.side === OrderSide.BUY
          ? { price: { lte: order.price } }
          : { price: { gte: order.price } }),
      },
      orderBy:
        opposite === OrderSide.SELL
          ? [{ price: "asc" }, { createdAt: "asc" }]
          : [{ price: "desc" }, { createdAt: "asc" }],
      take: 1,
    });

    const match = candidates[0];
    if (!match) break;

    const matchRem = match.quantity - match.filledQty;
    const qty = Math.min(remaining, matchRem);
    const price = match.price; // resting price

    const buyOrderId = order.side === OrderSide.BUY ? order.id : match.id;
    const sellOrderId = order.side === OrderSide.SELL ? order.id : match.id;

    try {
      await settleTrade({
        buyOrderId,
        sellOrderId,
        itemId: order.itemId,
        price,
        quantity: qty,
      });
      fills += 1;
    } catch (e) {
      // If settlement fails (inventory/coins), stop matching this order
      break;
    }
  }
  return fills;
}
