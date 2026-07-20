import { useState } from "react";
import {
  PROFESSIONS,
  PROFESSION_LABELS,
  PROFESSION_DESCRIPTIONS,
  PROFESSION_STARTING_SKILLS,
  type CharacterAuthResponse,
  type ProfessionId,
} from "@skilling-mmo/shared";

const PROFESSION_LIST: ProfessionId[] = [
  PROFESSIONS.WOODSMAN,
  PROFESSIONS.FARMER,
  PROFESSIONS.MINER,
];

const PROFESSION_ICONS: Record<ProfessionId, string> = {
  [PROFESSIONS.WOODSMAN]: "🪓",
  [PROFESSIONS.FARMER]: "🌾",
  [PROFESSIONS.MINER]: "⛏️",
};

export function CharacterCreatePanel({
  apiBase,
  accountToken,
  slotsRemaining,
  onCreated,
  onBack,
}: {
  apiBase: string;
  accountToken: string;
  slotsRemaining: number;
  onCreated: (res: CharacterAuthResponse) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [profession, setProfession] = useState<ProfessionId>(PROFESSIONS.WOODSMAN);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/auth/characters`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accountToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name.trim(), profession }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "create_failed");
      onCreated(body as CharacterAuthResponse);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lobby-screen">
      <div className="lobby-card create-card">
        <div className="lobby-header">
          <div>
            <h1>Create character</h1>
            <p className="muted">
              {slotsRemaining} slot{slotsRemaining === 1 ? "" : "s"} remaining · profession is permanent
            </p>
          </div>
          <button type="button" className="ghost" onClick={onBack}>
            Back
          </button>
        </div>

        <label>
          Character name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="Aldric"
            autoFocus
          />
        </label>

        <p className="section-label">Choose your profession</p>
        <div className="profession-grid">
          {PROFESSION_LIST.map((p) => (
            <button
              key={p}
              type="button"
              className={`profession-card profession-${p} ${profession === p ? "selected" : ""}`}
              onClick={() => setProfession(p)}
            >
              <span className="profession-icon">{PROFESSION_ICONS[p]}</span>
              <strong>{PROFESSION_LABELS[p]}</strong>
              <span className="profession-desc">{PROFESSION_DESCRIPTIONS[p]}</span>
              <span className="profession-skills">
                Starts with: {PROFESSION_STARTING_SKILLS[p].join(", ") || "—"}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="primary wide"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
        >
          {busy ? "Creating…" : "Begin adventure"}
        </button>

        {error && <div className="err">{error}</div>}
      </div>
    </div>
  );
}
