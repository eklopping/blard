import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@skilling-mmo/db";
import {
  BANK_SIZE,
  inventoryCapacity,
  maxStackFor,
  parseEquipmentJson,
} from "@skilling-mmo/shared";

type SlotLoc = { kind: "inventory" | "bank"; slot: number };
type Tx = Prisma.TransactionClient;

function isSlotLoc(v: unknown): v is SlotLoc {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.kind === "inventory" || o.kind === "bank") &&
    typeof o.slot === "number" &&
    Number.isInteger(o.slot) &&
    o.slot >= 0
  );
}

type TxSlot = { id: string; slot: number; itemId: string | null; quantity: number };

async function loadInvSlots(tx: Tx, playerId: string, capacity: number): Promise<TxSlot[]> {
  return tx.inventorySlot.findMany({
    where: { playerId, slot: { lt: capacity } },
    orderBy: { slot: "asc" },
  });
}

async function loadBankSlots(tx: Tx, playerId: string): Promise<TxSlot[]> {
  return tx.bankSlot.findMany({
    where: { playerId },
    orderBy: { slot: "asc" },
  });
}

function findSlot(slots: TxSlot[], slot: number): TxSlot | undefined {
  return slots.find((s) => s.slot === slot);
}

/** Move / swap / merge between inventory and bank (or within bank). */
async function applyBankMove(
  tx: Tx,
  playerId: string,
  from: SlotLoc,
  to: SlotLoc,
  quantity: number | undefined,
) {
  if (from.kind === to.kind && from.slot === to.slot) return;

  const player = await tx.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { equipmentJson: true },
  });
  const capacity = inventoryCapacity(parseEquipmentJson(player.equipmentJson));

  if (from.kind === "inventory" && from.slot >= capacity) throw new Error("invalid_slot");
  if (to.kind === "inventory" && to.slot >= capacity) throw new Error("invalid_slot");
  if (from.kind === "bank" && from.slot >= BANK_SIZE) throw new Error("invalid_slot");
  if (to.kind === "bank" && to.slot >= BANK_SIZE) throw new Error("invalid_slot");

  // Inventory ↔ inventory stays on the live WorldRoom path
  if (from.kind === "inventory" && to.kind === "inventory") {
    throw new Error("use_live_inventory");
  }

  const inv = await loadInvSlots(tx, playerId, capacity);
  const bank = await loadBankSlots(tx, playerId);

  const fromRow =
    from.kind === "inventory" ? findSlot(inv, from.slot) : findSlot(bank, from.slot);
  const toRow = to.kind === "inventory" ? findSlot(inv, to.slot) : findSlot(bank, to.slot);
  if (!fromRow || !toRow) throw new Error("invalid_slot");
  if (!fromRow.itemId || fromRow.quantity <= 0) throw new Error("empty");

  const moveQty = quantity == null ? fromRow.quantity : Math.min(quantity, fromRow.quantity);
  if (moveQty < 1) throw new Error("empty");

  const itemId = fromRow.itemId;
  const maxStack = maxStackFor(itemId);

  const updateRow = async (
    row: TxSlot,
    kind: "inventory" | "bank",
    nextItemId: string | null,
    nextQty: number,
  ) => {
    const data = { itemId: nextItemId, quantity: nextQty };
    if (kind === "inventory") {
      await tx.inventorySlot.update({ where: { id: row.id }, data });
    } else {
      await tx.bankSlot.update({ where: { id: row.id }, data });
    }
  };

  // Empty target — move (partial or full)
  if (!toRow.itemId || toRow.quantity <= 0) {
    if (moveQty === fromRow.quantity) {
      await updateRow(toRow, to.kind, itemId, moveQty);
      await updateRow(fromRow, from.kind, null, 0);
    } else {
      await updateRow(toRow, to.kind, itemId, moveQty);
      await updateRow(fromRow, from.kind, itemId, fromRow.quantity - moveQty);
    }
    return;
  }

  // Same item — merge stacks
  if (toRow.itemId === itemId) {
    const space = maxStack - toRow.quantity;
    if (space <= 0) throw new Error("stack_full");
    const add = Math.min(space, moveQty);
    await updateRow(toRow, to.kind, itemId, toRow.quantity + add);
    const left = fromRow.quantity - add;
    await updateRow(fromRow, from.kind, left > 0 ? itemId : null, left);
    return;
  }

  // Different items — only full-stack swap
  if (moveQty !== fromRow.quantity) throw new Error("cannot_partial_swap");
  const fromItem = { itemId: fromRow.itemId, quantity: fromRow.quantity };
  const toItem = { itemId: toRow.itemId, quantity: toRow.quantity };
  await updateRow(fromRow, from.kind, toItem.itemId, toItem.quantity);
  await updateRow(toRow, to.kind, fromItem.itemId, fromItem.quantity);
}

export async function playerRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticateCharacter] };

  app.get("/inventory", auth, async (req) => {
    const playerId = req.user.playerId!;
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { equipmentJson: true },
    });
    const capacity = inventoryCapacity(parseEquipmentJson(player.equipmentJson));
    const slots = await prisma.inventorySlot.findMany({
      where: { playerId, slot: { lt: capacity } },
      orderBy: { slot: "asc" },
    });
    return { slots, capacity };
  });

  app.get("/bank", auth, async (req) => {
    const slots = await prisma.bankSlot.findMany({
      where: { playerId: req.user.playerId! },
      orderBy: { slot: "asc" },
    });
    return { slots };
  });

  /** Drag-drop move between bag and bank (or rearrange bank slots). */
  app.post("/bank/move", auth, async (req, reply) => {
    const body = req.body as {
      from?: unknown;
      to?: unknown;
      quantity?: number;
    };
    if (!isSlotLoc(body.from) || !isSlotLoc(body.to)) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const playerId = req.user.playerId!;
    try {
      await prisma.$transaction(async (tx) => {
        await applyBankMove(tx, playerId, body.from as SlotLoc, body.to as SlotLoc, body.quantity);
      });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "move_failed" });
    }
  });

  app.post("/bank/deposit", auth, async (req, reply) => {
    const body = req.body as { invSlot?: number; quantity?: number; bankSlot?: number };
    if (body.invSlot == null || !body.quantity || body.quantity < 1) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const playerId = req.user.playerId!;

    try {
      await prisma.$transaction(async (tx) => {
        if (body.bankSlot != null) {
          await applyBankMove(
            tx,
            playerId,
            { kind: "inventory", slot: body.invSlot! },
            { kind: "bank", slot: body.bankSlot },
            body.quantity,
          );
          return;
        }

        const player = await tx.player.findUniqueOrThrow({
          where: { id: playerId },
          select: { equipmentJson: true },
        });
        const capacity = inventoryCapacity(parseEquipmentJson(player.equipmentJson));
        if (body.invSlot! >= capacity) throw new Error("invalid_slot");

        const inv = await tx.inventorySlot.findUniqueOrThrow({
          where: { playerId_slot: { playerId, slot: body.invSlot! } },
        });
        if (!inv.itemId || inv.quantity < body.quantity!) {
          throw new Error("insufficient_items");
        }
        const itemId = inv.itemId;
        const qty = body.quantity!;

        const bankSlots = await tx.bankSlot.findMany({
          where: { playerId },
          orderBy: { slot: "asc" },
        });
        let target = bankSlots.find((s) => s.itemId === itemId && s.quantity < maxStackFor(itemId));
        if (!target) target = bankSlots.find((s) => !s.itemId || s.quantity === 0);
        if (!target) throw new Error("bank_full");

        await applyBankMove(
          tx,
          playerId,
          { kind: "inventory", slot: body.invSlot! },
          { kind: "bank", slot: target.slot },
          qty,
        );
      });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "deposit_failed" });
    }
  });

  app.post("/bank/withdraw", auth, async (req, reply) => {
    const body = req.body as { bankSlot?: number; quantity?: number; invSlot?: number };
    if (body.bankSlot == null || !body.quantity || body.quantity < 1) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const playerId = req.user.playerId!;

    try {
      await prisma.$transaction(async (tx) => {
        if (body.invSlot != null) {
          await applyBankMove(
            tx,
            playerId,
            { kind: "bank", slot: body.bankSlot! },
            { kind: "inventory", slot: body.invSlot },
            body.quantity,
          );
          return;
        }

        const player = await tx.player.findUniqueOrThrow({
          where: { id: playerId },
          select: { equipmentJson: true },
        });
        const capacity = inventoryCapacity(parseEquipmentJson(player.equipmentJson));

        const bank = await tx.bankSlot.findUniqueOrThrow({
          where: { playerId_slot: { playerId, slot: body.bankSlot! } },
        });
        if (!bank.itemId || bank.quantity < body.quantity!) {
          throw new Error("insufficient_items");
        }
        const itemId = bank.itemId;
        const qty = body.quantity!;
        const maxStack = maxStackFor(itemId);

        const invSlots = await tx.inventorySlot.findMany({
          where: { playerId, slot: { lt: capacity } },
          orderBy: { slot: "asc" },
        });
        let target = invSlots.find(
          (s) => s.itemId === itemId && s.quantity > 0 && s.quantity < maxStack,
        );
        if (!target) target = invSlots.find((s) => !s.itemId || s.quantity === 0);
        if (!target) throw new Error("inventory_full");

        await applyBankMove(
          tx,
          playerId,
          { kind: "bank", slot: body.bankSlot! },
          { kind: "inventory", slot: target.slot },
          qty,
        );
      });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "withdraw_failed" });
    }
  });
}
