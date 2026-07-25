import { TRAVEL_ZONES, ZONE_LABELS, type ZoneId } from "@skilling-mmo/shared";

export function TravelMap({
  onTravel,
  onClose,
}: {
  onTravel: (zone: ZoneId) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Travel</h2>
        <p className="muted tiny-hint">Choose a gather area</p>
        <div className="travel-destinations">
          {TRAVEL_ZONES.map((zone) => (
            <button
              key={zone}
              type="button"
              className="primary"
              onClick={() => onTravel(zone)}
            >
              {ZONE_LABELS[zone]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose}>
          Stay in town
        </button>
      </div>
    </div>
  );
}
