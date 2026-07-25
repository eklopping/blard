import {
  canEquipInSlot,
  hasItemsBeyondCapacity,
  inventoryCapacity,
  maxStackFor,
  type EquipmentLoadout,
  type EquipmentSlotId,
  type ItemLocation,
} from "@skilling-mmo/shared";

export type InvSlot = { slot: number; itemId: string | null; quantity: number };

export type ItemDragResult =
  | { ok: true; inventory: InvSlot[]; equipment: EquipmentLoadout }
  | { ok: false; reason: string };

function cloneInv(inv: InvSlot[]): InvSlot[] {
  return inv.map((s) => ({ ...s }));
}

function cloneEquip(eq: EquipmentLoadout): EquipmentLoadout {
  const out: EquipmentLoadout = {};
  for (const [k, v] of Object.entries(eq)) {
    out[k as EquipmentSlotId] = v ? { ...v } : null;
  }
  return out;
}

function getInv(inv: InvSlot[], slot: number): InvSlot | undefined {
  return inv.find((s) => s.slot === slot);
}

function setEquip(
  equipment: EquipmentLoadout,
  slot: EquipmentSlotId,
  item: { itemId: string; quantity: number } | null,
) {
  if (!item || item.quantity <= 0) {
    delete equipment[slot];
  } else {
    equipment[slot] = { itemId: item.itemId, quantity: item.quantity };
  }
}

function getEquip(
  equipment: EquipmentLoadout,
  slot: EquipmentSlotId,
): { itemId: string; quantity: number } | null {
  const v = equipment[slot];
  if (!v?.itemId || v.quantity <= 0) return null;
  return { itemId: v.itemId, quantity: v.quantity };
}

function clearInvSlot(slot: InvSlot) {
  slot.itemId = null;
  slot.quantity = 0;
}

function writeInvSlot(slot: InvSlot, itemId: string, quantity: number) {
  if (quantity <= 0) {
    clearInvSlot(slot);
  } else {
    slot.itemId = itemId;
    slot.quantity = quantity;
  }
}

function validateCapacity(inv: InvSlot[], equipment: EquipmentLoadout): string | null {
  const cap = inventoryCapacity(equipment);
  if (hasItemsBeyondCapacity(inv, cap)) {
    return "clear_backpack_slots";
  }
  return null;
}

function moveInvToInv(
  inv: InvSlot[],
  fromSlot: number,
  toSlot: number,
  capacity: number,
): ItemDragResult {
  if (fromSlot === toSlot) return { ok: false, reason: "same_slot" };
  if (fromSlot < 0 || toSlot < 0 || fromSlot >= capacity || toSlot >= capacity) {
    return { ok: false, reason: "invalid_slot" };
  }
  const from = getInv(inv, fromSlot);
  const to = getInv(inv, toSlot);
  if (!from || !to) return { ok: false, reason: "invalid_slot" };
  if (!from.itemId || from.quantity <= 0) return { ok: false, reason: "empty" };

  // Merge stacks when possible
  if (to.itemId === from.itemId) {
    const max = maxStackFor(from.itemId);
    if (to.quantity < max) {
      const space = max - to.quantity;
      const moved = Math.min(space, from.quantity);
      to.quantity += moved;
      from.quantity -= moved;
      if (from.quantity <= 0) clearInvSlot(from);
      return { ok: true, inventory: inv, equipment: {} }; // equipment filled by caller
    }
  }

  // Swap
  const tmpFrom = { itemId: from.itemId, quantity: from.quantity };
  const tmpTo = { itemId: to.itemId, quantity: to.quantity };
  if (tmpTo.itemId && tmpTo.quantity > 0) {
    writeInvSlot(from, tmpTo.itemId, tmpTo.quantity);
  } else {
    clearInvSlot(from);
  }
  writeInvSlot(to, tmpFrom.itemId, tmpFrom.quantity);
  return { ok: true, inventory: inv, equipment: {} };
}

function moveInvToEquip(
  inv: InvSlot[],
  equipment: EquipmentLoadout,
  fromSlot: number,
  equipSlot: EquipmentSlotId,
  capacity: number,
): ItemDragResult {
  if (fromSlot < 0 || fromSlot >= capacity) return { ok: false, reason: "invalid_slot" };
  const from = getInv(inv, fromSlot);
  if (!from?.itemId || from.quantity <= 0) return { ok: false, reason: "empty" };
  if (!canEquipInSlot(from.itemId, equipSlot)) return { ok: false, reason: "wrong_slot" };

  // Equip one unit (tools/backpacks are non-stackable)
  const moving = { itemId: from.itemId, quantity: 1 };
  const existing = getEquip(equipment, equipSlot);

  if (from.quantity > 1 && existing) {
    return { ok: false, reason: "cannot_swap_stack" };
  }

  if (existing) {
    // Swap into the inventory slot
    writeInvSlot(from, existing.itemId, existing.quantity);
  } else {
    from.quantity -= 1;
    if (from.quantity <= 0) clearInvSlot(from);
  }
  setEquip(equipment, equipSlot, moving);

  const capErr = validateCapacity(inv, equipment);
  if (capErr) return { ok: false, reason: capErr };

  return { ok: true, inventory: inv, equipment };
}

function moveEquipToInv(
  inv: InvSlot[],
  equipment: EquipmentLoadout,
  equipSlot: EquipmentSlotId,
  toSlot: number,
  capacity: number,
): ItemDragResult {
  if (toSlot < 0 || toSlot >= capacity) return { ok: false, reason: "invalid_slot" };
  const equipped = getEquip(equipment, equipSlot);
  if (!equipped) return { ok: false, reason: "empty" };
  const to = getInv(inv, toSlot);
  if (!to) return { ok: false, reason: "invalid_slot" };

  if (!to.itemId || to.quantity <= 0) {
    writeInvSlot(to, equipped.itemId, equipped.quantity);
    setEquip(equipment, equipSlot, null);
  } else if (canEquipInSlot(to.itemId, equipSlot)) {
    // Swap
    setEquip(equipment, equipSlot, { itemId: to.itemId, quantity: 1 });
    if (to.quantity > 1) {
      return { ok: false, reason: "cannot_swap_stack" };
    }
    writeInvSlot(to, equipped.itemId, equipped.quantity);
  } else {
    return { ok: false, reason: "occupied" };
  }

  const capErr = validateCapacity(inv, equipment);
  if (capErr) return { ok: false, reason: capErr };

  return { ok: true, inventory: inv, equipment };
}

function moveEquipToEquip(
  equipment: EquipmentLoadout,
  fromSlot: EquipmentSlotId,
  toSlot: EquipmentSlotId,
): ItemDragResult {
  if (fromSlot === toSlot) return { ok: false, reason: "same_slot" };
  const from = getEquip(equipment, fromSlot);
  if (!from) return { ok: false, reason: "empty" };
  if (!canEquipInSlot(from.itemId, toSlot)) return { ok: false, reason: "wrong_slot" };

  const to = getEquip(equipment, toSlot);
  if (to && !canEquipInSlot(to.itemId, fromSlot)) {
    return { ok: false, reason: "wrong_slot" };
  }

  setEquip(equipment, toSlot, from);
  setEquip(equipment, fromSlot, to);

  return { ok: true, inventory: [], equipment };
}

/**
 * Apply a drag between inventory and/or equipment locations.
 * Mutates clones; caller should replace stored state on success.
 */
export function applyItemDrag(
  inventory: InvSlot[],
  equipment: EquipmentLoadout,
  from: ItemLocation,
  to: ItemLocation,
): ItemDragResult {
  const inv = cloneInv(inventory);
  const eq = cloneEquip(equipment);
  const capacity = inventoryCapacity(eq);

  if (from.kind === "inventory" && to.kind === "inventory") {
    const result = moveInvToInv(inv, from.slot, to.slot, capacity);
    if (!result.ok) return result;
    return { ok: true, inventory: inv, equipment: eq };
  }

  if (from.kind === "inventory" && to.kind === "equipment") {
    return moveInvToEquip(inv, eq, from.slot, to.slot, capacity);
  }

  if (from.kind === "equipment" && to.kind === "inventory") {
    // Capacity for target slot uses current (pre-unequip) capacity so backpack
    // items can land in bonus slots before the backpack is removed — then we
    // validate the post-move capacity.
    return moveEquipToInv(inv, eq, from.slot, to.slot, capacity);
  }

  if (from.kind === "equipment" && to.kind === "equipment") {
    const result = moveEquipToEquip(eq, from.slot, to.slot);
    if (!result.ok) return result;
    const capErr = validateCapacity(inv, eq);
    if (capErr) return { ok: false, reason: capErr };
    return { ok: true, inventory: inv, equipment: eq };
  }

  return { ok: false, reason: "invalid" };
}
