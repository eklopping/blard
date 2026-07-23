import type { InventorySlotDto } from "@skilling-mmo/shared";

export function BankPanel({
  inventory,
  bank,
  token,
  apiBase,
  onRefresh,
  embedded,
}: {
  inventory: InventorySlotDto[];
  bank: InventorySlotDto[];
  token: string;
  apiBase: string;
  onRefresh: () => Promise<void>;
  embedded?: boolean;
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
    <div className={embedded ? "hud-embed" : "panel"}>
      <h2>Bank</h2>
      <p className="muted tiny-hint">Click inv to deposit · bank to withdraw</p>
      <h3>Carried</h3>
      <div className="grid grid-inv">
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
      <h3>Stored</h3>
      <div className="grid grid-bank">
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
