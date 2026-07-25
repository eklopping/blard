import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  EQUIPMENT_SLOT_LABELS,
  ITEM_DEFS,
  type EquipmentLoadout,
  type EquipmentSlotId,
  type ItemLocation,
} from "@skilling-mmo/shared";
import { ITEM_DRAG_MIME, encodeItemDrag, readItemDrag } from "./itemDrag";

const LAYOUT: { id: EquipmentSlotId; area: string }[] = [
  { id: "helmet", area: "helm" },
  { id: "back", area: "back" },
  { id: "chestplate", area: "chest" },
  { id: "cape", area: "cape" },
  { id: "leggings", area: "legs" },
  { id: "boots", area: "boots" },
  { id: "accessory_1", area: "a1" },
  { id: "accessory_2", area: "a2" },
  { id: "accessory_3", area: "a3" },
  { id: "accessory_4", area: "a4" },
  { id: "accessory_5", area: "a5" },
  { id: "primary", area: "weapon" },
];

export function EquipmentWindow({
  open,
  onClose,
  loadout,
  onItemDrag,
}: {
  open: boolean;
  onClose: () => void;
  loadout: EquipmentLoadout;
  onItemDrag?: (from: ItemLocation, to: ItemLocation) => void;
}) {
  const winRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [pos, setPos] = useState({ x: 48, y: 72 });

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

  const onTitleDown = useCallback((e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    drag.current = {
      ox: e.clientX - pos.x,
      oy: e.clientY - pos.y,
      x: pos.x,
      y: pos.y,
    };
  }, [pos.x, pos.y]);

  const onSlotDragStart = (slot: EquipmentSlotId, e: ReactDragEvent) => {
    const item = loadout[slot];
    if (!item?.itemId || item.quantity <= 0) {
      e.preventDefault();
      return;
    }
    const loc: ItemLocation = { kind: "equipment", slot };
    e.dataTransfer.setData(ITEM_DRAG_MIME, encodeItemDrag(loc));
    e.dataTransfer.setData("text/plain", encodeItemDrag(loc));
    e.dataTransfer.effectAllowed = "move";
    (e.currentTarget as HTMLElement).classList.add("dragging");
  };

  const onSlotDragEnd = (e: ReactDragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("dragging");
  };

  const onSlotDragOver = (e: ReactDragEvent) => {
    if (!onItemDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    (e.currentTarget as HTMLElement).classList.add("drag-over");
  };

  const onSlotDragLeave = (e: ReactDragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("drag-over");
  };

  const onSlotDrop = (slot: EquipmentSlotId, e: ReactDragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("drag-over");
    if (!onItemDrag) return;
    const from = readItemDrag(e.dataTransfer);
    if (!from) return;
    const to: ItemLocation = { kind: "equipment", slot };
    if (from.kind === "equipment" && from.slot === slot) return;
    onItemDrag(from, to);
  };

  if (!open) return null;

  return (
    <div
      ref={winRef}
      className="equip-window"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Equipment"
    >
      <div className="equip-window-title" onPointerDown={onTitleDown}>
        <span>Equipment</span>
        <button type="button" className="equip-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="equip-hint">Drag gear here from your bag, or back to unequip.</p>
      <div className="equip-doll">
        {LAYOUT.map(({ id, area }) => {
          const item = loadout[id];
          const filled = Boolean(item?.itemId && item.quantity > 0);
          return (
            <div
              key={id}
              className={`equip-slot ${filled ? "" : "empty"}`}
              style={{ gridArea: area }}
              title={EQUIPMENT_SLOT_LABELS[id]}
              draggable={filled && Boolean(onItemDrag)}
              onDragStart={(e) => onSlotDragStart(id, e)}
              onDragEnd={onSlotDragEnd}
              onDragOver={onSlotDragOver}
              onDragLeave={onSlotDragLeave}
              onDrop={(e) => onSlotDrop(id, e)}
            >
              <span className="equip-slot-label">{EQUIPMENT_SLOT_LABELS[id]}</span>
              {filled ? (
                <span className="equip-slot-item">
                  {ITEM_DEFS[item!.itemId]?.name ?? item!.itemId}
                  {item!.quantity > 1 ? ` ×${item!.quantity}` : ""}
                </span>
              ) : (
                <span className="equip-slot-empty">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
