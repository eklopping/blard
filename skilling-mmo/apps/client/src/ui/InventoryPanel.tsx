import type { InventorySlotDto } from "@skilling-mmo/shared";

export function InventoryPanel({
  slots,
  embedded,
}: {
  slots: InventorySlotDto[];
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "hud-embed" : "panel"}>
      {!embedded && <h2>Inventory</h2>}
      {embedded && <h2>Bag</h2>}
      <div className="grid grid-inv">
        {slots.map((s) => (
          <div key={s.slot} className={`slot ${s.itemId ? "" : "empty"}`} title={s.itemId ?? ""}>
            {s.itemId ? (
              <>
                <span>{s.itemId}</span>
                <span>×{s.quantity}</span>
              </>
            ) : (
              <span>{s.slot}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
