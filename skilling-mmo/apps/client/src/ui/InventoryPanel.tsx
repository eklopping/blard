import type { DragEvent as ReactDragEvent } from "react";
import type { InventorySlotDto, ItemLocation } from "@skilling-mmo/shared";
import { INVENTORY_BASE_SLOTS, INVENTORY_ROW_SIZE, ITEM_DEFS } from "@skilling-mmo/shared";
import { ITEM_DRAG_MIME, encodeItemDrag, readItemDrag } from "./itemDrag";

function padVisibleSlots(slots: InventorySlotDto[], capacity: number): InventorySlotDto[] {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  return Array.from({ length: capacity }, (_, slot) => {
    const existing = bySlot.get(slot);
    return existing
      ? { slot, itemId: existing.itemId, quantity: existing.quantity }
      : { slot, itemId: null, quantity: 0 };
  });
}

export function InventoryPanel({
  slots,
  capacity = INVENTORY_BASE_SLOTS,
  embedded,
  onItemDrag,
}: {
  slots: InventorySlotDto[];
  capacity?: number;
  embedded?: boolean;
  onItemDrag?: (from: ItemLocation, to: ItemLocation) => void;
}) {
  const visible = padVisibleSlots(slots, capacity);

  const onDragStart = (slot: number, e: ReactDragEvent) => {
    const item = visible.find((s) => s.slot === slot);
    if (!item?.itemId || item.quantity <= 0) {
      e.preventDefault();
      return;
    }
    const loc: ItemLocation = { kind: "inventory", slot };
    e.dataTransfer.setData(ITEM_DRAG_MIME, encodeItemDrag(loc));
    e.dataTransfer.setData("text/plain", encodeItemDrag(loc));
    e.dataTransfer.effectAllowed = "move";
    (e.currentTarget as HTMLElement).classList.add("dragging");
  };

  const onDragEnd = (e: ReactDragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("dragging");
  };

  const onDragOver = (e: ReactDragEvent) => {
    if (!onItemDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    (e.currentTarget as HTMLElement).classList.add("drag-over");
  };

  const onDragLeave = (e: ReactDragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("drag-over");
  };

  const onDrop = (toSlot: number, e: ReactDragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("drag-over");
    if (!onItemDrag) return;
    const from = readItemDrag(e.dataTransfer);
    if (!from) return;
    const to: ItemLocation = { kind: "inventory", slot: toSlot };
    if (from.kind === "inventory" && from.slot === toSlot) return;
    onItemDrag(from, to);
  };

  return (
    <div className={embedded ? "hud-embed hud-inv-embed" : "panel"}>
      {!embedded && <h2>Inventory</h2>}
      {embedded && <h2>Bag ({capacity} slots)</h2>}
      <p className="tiny-hint">Drag items between bag slots, Equipment, or Bank.</p>
      <div
        className="grid grid-inv"
        style={{ gridTemplateColumns: `repeat(${INVENTORY_ROW_SIZE}, 1fr)` }}
      >
        {visible.map((s) => {
          const filled = Boolean(s.itemId && s.quantity > 0);
          return (
            <div
              key={s.slot}
              className={`slot ${filled ? "" : "empty"}`}
              title={filled ? ITEM_DEFS[s.itemId!]?.name ?? s.itemId! : `Slot ${s.slot + 1}`}
              draggable={filled && Boolean(onItemDrag)}
              onDragStart={(e) => onDragStart(s.slot, e)}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(s.slot, e)}
            >
              {filled ? (
                <>
                  <span>{ITEM_DEFS[s.itemId!]?.name ?? s.itemId}</span>
                  <span>×{s.quantity}</span>
                </>
              ) : (
                <span>{s.slot + 1}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
