import {
  SHOP_BUY,
  SHOP_SELL,
  ITEM_DEFS,
  type InventorySlotDto,
} from "@skilling-mmo/shared";

export function ShopPanel({
  coins,
  inventory,
  onBuy,
  onSell,
  onClose,
}: {
  coins: number;
  inventory: InventorySlotDto[];
  onBuy: (itemId: string, quantity?: number) => void;
  onSell: (itemId: string, quantity: number) => void;
  onClose: () => void;
}) {
  function ownedQty(itemId: string): number {
    return inventory
      .filter((s) => s.itemId === itemId)
      .reduce((sum, s) => sum + s.quantity, 0);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card shop-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Shopkeeper</h2>
        <p className="muted tiny-hint">Coins: {coins}</p>

        <h3>Buy</h3>
        <div className="shop-list">
          {SHOP_BUY.map((entry) => {
            const name = ITEM_DEFS[entry.itemId]?.name ?? entry.itemId;
            return (
              <div key={entry.itemId} className="shop-row">
                <span>
                  {name} — {entry.price}c
                </span>
                <button
                  type="button"
                  disabled={coins < entry.price}
                  onClick={() => onBuy(entry.itemId, 1)}
                >
                  Buy
                </button>
              </div>
            );
          })}
        </div>

        <h3>Sell</h3>
        <div className="shop-list">
          {SHOP_SELL.map((entry) => {
            const name = ITEM_DEFS[entry.itemId]?.name ?? entry.itemId;
            const qty = ownedQty(entry.itemId);
            return (
              <div key={entry.itemId} className="shop-row">
                <span>
                  {name} — {entry.price}c each ({qty})
                </span>
                <button
                  type="button"
                  disabled={qty < 1}
                  onClick={() => onSell(entry.itemId, 1)}
                >
                  Sell 1
                </button>
                <button
                  type="button"
                  disabled={qty < 1}
                  onClick={() => onSell(entry.itemId, qty)}
                >
                  Sell all
                </button>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
