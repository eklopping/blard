import type { InventorySlotDto } from "@skilling-mmo/shared";
import { INVENTORY_BASE_SLOTS, INVENTORY_ROW_SIZE, ITEM_DEFS } from "@skilling-mmo/shared";

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
}: {
  slots: InventorySlotDto[];
  capacity?: number;
  embedded?: boolean;
}) {
  const visible = padVisibleSlots(slots, capacity);

  return (
    <div className={embedded ? "hud-embed hud-inv-embed" : "panel"}>
      {!embedded && <h2>Inventory</h2>}
      {embedded && <h2>Bag ({capacity} slots)</h2>}
      <div
        className="grid grid-inv"
        style={{ gridTemplateColumns: `repeat(${INVENTORY_ROW_SIZE}, 1fr)` }}
      >
        {visible.map((s) => (
          <div
            key={s.slot}
            className={`slot ${s.itemId ? "" : "empty"}`}
            title={s.itemId ? ITEM_DEFS[s.itemId]?.name ?? s.itemId : ""}
          >
            {s.itemId ? (
              <>
                <span>{ITEM_DEFS[s.itemId]?.name ?? s.itemId}</span>
                <span>×{s.quantity}</span>
              </>
            ) : (
              <span>{s.slot + 1}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
