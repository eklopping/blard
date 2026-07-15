import type { InventorySlotDto } from "@skilling-mmo/shared";

export function InventoryPanel({ slots }: { slots: InventorySlotDto[] }) {
  return (
    <div className="panel">
      <h2>Inventory</h2>
      <div className="grid">
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
