import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { InventorySlotDto, ItemLocation } from "@skilling-mmo/shared";
import { BANK_SIZE, INVENTORY_ROW_SIZE, ITEM_DEFS } from "@skilling-mmo/shared";
import { ITEM_DRAG_MIME, encodeItemDrag, readItemDrag } from "./itemDrag";

function padBankSlots(slots: InventorySlotDto[]): InventorySlotDto[] {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  return Array.from({ length: BANK_SIZE }, (_, slot) => {
    const existing = bySlot.get(slot);
    return existing
      ? { slot, itemId: existing.itemId, quantity: existing.quantity }
      : { slot, itemId: null, quantity: 0 };
  });
}

export function BankWindow({
  open,
  onClose,
  bank,
  onItemDrag,
}: {
  open: boolean;
  onClose: () => void;
  bank: InventorySlotDto[];
  onItemDrag?: (from: ItemLocation, to: ItemLocation) => void;
}) {
  const drag = useRef<{ ox: number; oy: number } | null>(null);
  const [pos, setPos] = useState({ x: 380, y: 72 });
  const slots = padBankSlots(bank);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      setPos({
        x: e.clientX - drag.current.ox,
        y: e.clientY - drag.current.oy,
      });
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [open]);

  const onTitleDown = useCallback(
    (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      drag.current = {
        ox: e.clientX - pos.x,
        oy: e.clientY - pos.y,
      };
    },
    [pos.x, pos.y],
  );

  const onDragStart = (slot: number, e: ReactDragEvent) => {
    const item = slots.find((s) => s.slot === slot);
    if (!item?.itemId || item.quantity <= 0) {
      e.preventDefault();
      return;
    }
    const loc: ItemLocation = { kind: "bank", slot };
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
    if (from.kind === "equipment") return;
    const to: ItemLocation = { kind: "bank", slot: toSlot };
    if (from.kind === "bank" && from.slot === toSlot) return;
    onItemDrag(from, to);
  };

  if (!open) return null;

  return (
    <div
      className="bank-window"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Bank"
    >
      <div className="bank-window-title" onPointerDown={onTitleDown}>
        <span>Bank</span>
        <button type="button" className="equip-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="equip-hint">Drag items from your bag to deposit, or rearrange slots here.</p>
      <div
        className="grid grid-bank bank-window-grid"
        style={{ gridTemplateColumns: `repeat(${INVENTORY_ROW_SIZE}, 1fr)` }}
      >
        {slots.map((s) => {
          const filled = Boolean(s.itemId && s.quantity > 0);
          return (
            <div
              key={s.slot}
              className={`slot ${filled ? "" : "empty"}`}
              title={filled ? ITEM_DEFS[s.itemId!]?.name ?? s.itemId! : `Bank ${s.slot + 1}`}
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
