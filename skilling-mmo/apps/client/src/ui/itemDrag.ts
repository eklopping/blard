import type { ItemLocation } from "@skilling-mmo/shared";
import { isEquipmentSlotId } from "@skilling-mmo/shared";

export const ITEM_DRAG_MIME = "application/x-skilling-item";

export function encodeItemDrag(loc: ItemLocation): string {
  return JSON.stringify(loc);
}

export function decodeItemDrag(raw: string): ItemLocation | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ItemLocation>;
    if (parsed?.kind === "inventory" && typeof parsed.slot === "number") {
      return { kind: "inventory", slot: parsed.slot };
    }
    if (parsed?.kind === "equipment" && typeof parsed.slot === "string" && isEquipmentSlotId(parsed.slot)) {
      return { kind: "equipment", slot: parsed.slot };
    }
    return null;
  } catch {
    return null;
  }
}

export function readItemDrag(dt: DataTransfer | null): ItemLocation | null {
  if (!dt) return null;
  const raw = dt.getData(ITEM_DRAG_MIME) || dt.getData("text/plain");
  if (!raw) return null;
  return decodeItemDrag(raw);
}
