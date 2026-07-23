import { useEffect, useState } from "react";
import type { MarketOrderDto, OrderSide } from "@skilling-mmo/shared";

export function MarketPanel({
  token,
  apiBase,
  coins,
  embedded,
}: {
  token: string;
  apiBase: string;
  coins: number;
  embedded?: boolean;
}) {
  const [orders, setOrders] = useState<MarketOrderDto[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [side, setSide] = useState<OrderSide>("SELL");
  const [price, setPrice] = useState(10);
  const [qty, setQty] = useState(1);
  const [itemId, setItemId] = useState("logs");
  const [msg, setMsg] = useState("");

  async function refresh() {
    const [o, h] = await Promise.all([
      fetch(`${apiBase}/market/orders?itemId=logs`),
      fetch(`${apiBase}/market/history`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    if (o.ok) setOrders((await o.json()).orders);
    if (h.ok) setHistory((await h.json()).entries);
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  async function place() {
    setMsg("");
    const r = await fetch(`${apiBase}/market/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ side, itemId, price, quantity: qty }),
    });
    const data = await r.json();
    if (!r.ok) {
      setMsg(data.error ?? "failed");
      return;
    }
    setMsg(`Order ${data.order.status}`);
    await refresh();
  }

  return (
    <div className={embedded ? "hud-embed" : "panel"}>
      <h2>Marketplace</h2>
      <p className="muted tiny-hint">{coins}c available</p>
      <div className="market-row">
        <select value={side} onChange={(e) => setSide(e.target.value as OrderSide)}>
          <option value="SELL">Sell</option>
          <option value="BUY">Buy</option>
        </select>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="logs">logs</option>
          <option value="oak_logs">oak_logs</option>
        </select>
        <input
          type="number"
          min={1}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          style={{ width: 64 }}
          title="price"
        />
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          style={{ width: 64 }}
          title="qty"
        />
        <button type="button" onClick={place}>
          Place
        </button>
      </div>
      {msg && <div style={{ fontSize: "0.8rem", color: "var(--accent)" }}>{msg}</div>}
      <h3 style={{ fontSize: "0.85rem" }}>Open orders</h3>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.75rem" }}>
        {orders.map((o) => (
          <li key={o.id}>
            {o.side} {o.quantity - o.filledQty} {o.itemId} @ {o.price} ({o.status})
          </li>
        ))}
        {orders.length === 0 && <li>None</li>}
      </ul>
      <h3 style={{ fontSize: "0.85rem" }}>Your trade history</h3>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.75rem" }}>
        {history.map((e) => (
          <li key={e.id}>
            {e.itemId} Δ{e.deltaQty} / coins Δ{e.deltaCoins}
          </li>
        ))}
        {history.length === 0 && <li>None yet</li>}
      </ul>
    </div>
  );
}
