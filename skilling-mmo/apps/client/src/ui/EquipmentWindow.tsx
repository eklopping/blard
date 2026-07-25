import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  EQUIPMENT_SLOT_LABELS,
  type EquipmentLoadout,
  type EquipmentSlotId,
} from "@skilling-mmo/shared";

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
}: {
  open: boolean;
  onClose: () => void;
  loadout: EquipmentLoadout;
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
      <div className="equip-doll">
        {LAYOUT.map(({ id, area }) => {
          const item = loadout[id];
          return (
            <div
              key={id}
              className={`equip-slot ${item ? "" : "empty"}`}
              style={{ gridArea: area }}
              title={EQUIPMENT_SLOT_LABELS[id]}
            >
              <span className="equip-slot-label">{EQUIPMENT_SLOT_LABELS[id]}</span>
              {item ? (
                <span className="equip-slot-item">
                  {item.itemId}
                  {item.quantity > 1 ? ` ×${item.quantity}` : ""}
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
