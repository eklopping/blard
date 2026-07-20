import type { FastifyInstance } from "fastify";
import { prisma } from "@skilling-mmo/db";

export async function playerRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticateCharacter] };

  app.get("/inventory", auth, async (req) => {
    const slots = await prisma.inventorySlot.findMany({
      where: { playerId: req.user.playerId! },
      orderBy: { slot: "asc" },
    });
    return { slots };
  });

  app.get("/bank", auth, async (req) => {
    const slots = await prisma.bankSlot.findMany({
      where: { playerId: req.user.playerId! },
      orderBy: { slot: "asc" },
    });
    return { slots };
  });

  app.post("/bank/deposit", auth, async (req, reply) => {
    const body = req.body as { invSlot?: number; quantity?: number };
    if (body.invSlot == null || !body.quantity || body.quantity < 1) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const playerId = req.user.playerId!;

    try {
      await prisma.$transaction(async (tx) => {
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
        let target = bankSlots.find((s) => s.itemId === itemId);
        if (!target) target = bankSlots.find((s) => !s.itemId || s.quantity === 0);
        if (!target) throw new Error("bank_full");

        await tx.inventorySlot.update({
          where: { id: inv.id },
          data: {
            quantity: inv.quantity - qty,
            itemId: inv.quantity - qty === 0 ? null : inv.itemId,
          },
        });
        await tx.bankSlot.update({
          where: { id: target.id },
          data: {
            itemId,
            quantity: (target.itemId === itemId ? target.quantity : 0) + qty,
          },
        });
      });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "deposit_failed" });
    }
  });

  app.post("/bank/withdraw", auth, async (req, reply) => {
    const body = req.body as { bankSlot?: number; quantity?: number };
    if (body.bankSlot == null || !body.quantity || body.quantity < 1) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const playerId = req.user.playerId!;

    try {
      await prisma.$transaction(async (tx) => {
        const bank = await tx.bankSlot.findUniqueOrThrow({
          where: { playerId_slot: { playerId, slot: body.bankSlot! } },
        });
        if (!bank.itemId || bank.quantity < body.quantity!) {
          throw new Error("insufficient_items");
        }
        const itemId = bank.itemId;
        const qty = body.quantity!;

        const invSlots = await tx.inventorySlot.findMany({
          where: { playerId },
          orderBy: { slot: "asc" },
        });
        let target = invSlots.find((s) => s.itemId === itemId);
        if (!target) target = invSlots.find((s) => !s.itemId || s.quantity === 0);
        if (!target) throw new Error("inventory_full");

        await tx.bankSlot.update({
          where: { id: bank.id },
          data: {
            quantity: bank.quantity - qty,
            itemId: bank.quantity - qty === 0 ? null : bank.itemId,
          },
        });
        await tx.inventorySlot.update({
          where: { id: target.id },
          data: {
            itemId,
            quantity: (target.itemId === itemId ? target.quantity : 0) + qty,
          },
        });
      });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "withdraw_failed" });
    }
  });
}
