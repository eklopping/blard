import type { InventorySlotDto } from "@skilling-mmo/shared";

export function BankPanel({
  inventory,
  bank,
  token,
  apiBase,
  onRefresh,
}: {
  inventory: InventorySlotDto[];
  bank: InventorySlotDto[];
  token: string;
  apiBase: string;
  onRefresh: () => Promise<void>;
}) {
  async function deposit(invSlot: number, quantity: number) {
    await fetch(`${apiBase}/player/bank/deposit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ invSlot, quantity }),
    });
    await onRefresh();
  }

  async function withdraw(bankSlot: number, quantity: number) {
    await fetch(`${apiBase}/player/bank/withdraw`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bankSlot, quantity }),
    });
    await onRefresh();
  }

  return (
    <div className="panel">
      <h2>Bank</h2>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Click inv to deposit · bank to withdraw</p>
      <h3 style={{ fontSize: "0.85rem" }}>Inventory</h3>
      <div className="grid">
        {inventory.map((s) => (
          <div
            key={`i${s.slot}`}
            className={`slot ${s.itemId ? "" : "empty"}`}
            onClick={() => s.itemId && deposit(s.slot, s.quantity)}
          >
            {s.itemId ? `${s.itemId}×${s.quantity}` : ""}
          </div>
        ))}
      </div>
      <h3 style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>Bank</h3>
      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {bank.map((s) => (
          <div
            key={`b${s.slot}`}
            className={`slot ${s.itemId ? "" : "empty"}`}
            onClick={() => s.itemId && withdraw(s.slot, s.quantity)}
          >
            {s.itemId ? `${s.itemId}×${s.quantity}` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
