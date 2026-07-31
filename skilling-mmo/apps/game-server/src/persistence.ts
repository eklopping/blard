import { prisma, LedgerType } from "@skilling-mmo/db";

interface DirtyPayload {
  x?: number;
  y?: number;
  coins?: number;
  equipmentJson?: string;
  activeClassId?: string;
  inventory?: { slot: number; itemId: string | null; quantity: number }[];
  skills?: Map<string, { level: number; xp: number }>;
  classes?: Map<string, { level: number; xp: number; unlocked: boolean }>;
  ledger?: {
    type: (typeof LedgerType)[keyof typeof LedgerType];
    itemId?: string;
    deltaQty?: number;
    meta?: object;
  };
}

const dirty = new Map<string, DirtyPayload>();

export function enqueueDirtyPlayer(playerId: string, patch: DirtyPayload) {
  const cur = dirty.get(playerId) ?? {};
  dirty.set(playerId, {
    ...cur,
    ...patch,
    inventory: patch.inventory ?? cur.inventory,
    skills: patch.skills ?? cur.skills,
    classes: patch.classes ?? cur.classes,
    ledger: patch.ledger ?? cur.ledger,
    equipmentJson: patch.equipmentJson ?? cur.equipmentJson,
    activeClassId: patch.activeClassId ?? cur.activeClassId,
  });
}

export async function flushDirtyPlayers() {
  if (dirty.size === 0) return;
  const entries = [...dirty.entries()];
  dirty.clear();

  for (const [playerId, data] of entries) {
    try {
      await prisma.$transaction(async (tx) => {
        if (data.x != null || data.y != null || data.coins != null || data.equipmentJson != null || data.activeClassId != null) {
          await tx.player.update({
            where: { id: playerId },
            data: {
              ...(data.x != null ? { x: data.x } : {}),
              ...(data.y != null ? { y: data.y } : {}),
              ...(data.coins != null ? { coins: data.coins } : {}),
              ...(data.equipmentJson != null ? { equipmentJson: data.equipmentJson } : {}),
              ...(data.activeClassId != null ? { activeClassId: data.activeClassId } : {}),
            },
          });
        }
        if (data.inventory) {
          for (const slot of data.inventory) {
            await tx.inventorySlot.upsert({
              where: { playerId_slot: { playerId, slot: slot.slot } },
              create: {
                playerId,
                slot: slot.slot,
                itemId: slot.itemId,
                quantity: slot.quantity,
              },
              update: { itemId: slot.itemId, quantity: slot.quantity },
            });
          }
        }
        if (data.skills) {
          for (const [skill, v] of data.skills) {
            await tx.skillProgress.upsert({
              where: { playerId_skill: { playerId, skill } },
              create: { playerId, skill, level: v.level, xp: v.xp },
              update: { level: v.level, xp: v.xp },
            });
          }
        }
        if (data.classes) {
          for (const [classId, v] of data.classes) {
            await tx.classProgress.upsert({
              where: { playerId_classId: { playerId, classId } },
              create: {
                playerId,
                classId,
                level: v.level,
                xp: v.xp,
                unlocked: v.unlocked,
              },
              update: { level: v.level, xp: v.xp, unlocked: v.unlocked },
            });
          }
        }
        if (data.ledger) {
          await tx.ledgerEntry.create({
            data: {
              playerId,
              type: data.ledger.type,
              itemId: data.ledger.itemId,
              deltaQty: data.ledger.deltaQty,
              meta: data.ledger.meta as any,
              refType: "skill",
              refId: playerId,
            },
          });
        }
      });
    } catch (err) {
      console.error(`[persistence] failed to flush ${playerId}`, err);
      // re-queue on failure
      const existing = dirty.get(playerId) ?? {};
      dirty.set(playerId, { ...data, ...existing });
    }
  }
}
