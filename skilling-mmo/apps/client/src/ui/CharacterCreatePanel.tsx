import { useState } from "react";
import {
  PROFESSIONS,
  PROFESSION_LABELS,
  PROFESSION_DESCRIPTIONS,
  PROFESSION_STARTING_SKILLS,
  TRAIT_DEFS,
  STARTER_TRAIT_IDS,
  DEFAULT_APPEARANCE,
  HAIR_COLORS,
  SKIN_COLORS,
  SHIRT_COLORS,
  PANTS_COLORS,
  type CharacterAuthResponse,
  type ProfessionId,
  type TraitId,
  type Appearance,
} from "@skilling-mmo/shared";
import { LobbyShell } from "./LobbyShell";
import { PixelAvatarPreview } from "./PixelAvatarPreview";

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

function ColorRow({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="color-row">
      <span className="color-row-label">{label}</span>
      <div className="color-swatches">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className={`color-swatch ${value === c ? "selected" : ""}`}
            style={{ background: c }}
            title={c}
            aria-label={`${label} ${c}`}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}

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
  const [trait, setTrait] = useState<TraitId>(STARTER_TRAIT_IDS[0]);
  const [appearance, setAppearance] = useState<Appearance>({ ...DEFAULT_APPEARANCE });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patchLook(partial: Partial<Appearance>) {
    setAppearance((a) => ({ ...a, ...partial }));
  }

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
        body: JSON.stringify({
          name: name.trim(),
          profession,
          trait,
          appearance,
        }),
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
    <LobbyShell>
      <div className="lobby-card create-card create-card-wide">
        <div className="lobby-header">
          <div>
            <h1>Create character</h1>
            <p className="muted">
              {slotsRemaining} slot{slotsRemaining === 1 ? "" : "s"} remaining · profession & trait stick
            </p>
          </div>
          <button type="button" className="ghost" onClick={onBack}>
            Back
          </button>
        </div>

        <div className="create-layout">
          <div className="create-preview-col">
            <div className="avatar-stage">
              <PixelAvatarPreview appearance={appearance} scale={7} />
            </div>
            <p className="section-label">Look</p>
            <ColorRow
              label="Hair"
              colors={HAIR_COLORS}
              value={appearance.hairColor}
              onChange={(hairColor) => patchLook({ hairColor })}
            />
            <ColorRow
              label="Skin"
              colors={SKIN_COLORS}
              value={appearance.skinColor}
              onChange={(skinColor) => patchLook({ skinColor })}
            />
            <ColorRow
              label="Shirt"
              colors={SHIRT_COLORS}
              value={appearance.shirtColor}
              onChange={(shirtColor) => patchLook({ shirtColor })}
            />
            <ColorRow
              label="Pants"
              colors={PANTS_COLORS}
              value={appearance.pantsColor}
              onChange={(pantsColor) => patchLook({ pantsColor })}
            />
          </div>

          <div className="create-form-col">
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

            <p className="section-label">Profession</p>
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

            <p className="section-label">Starting trait</p>
            <div className="trait-grid">
              {STARTER_TRAIT_IDS.map((id) => {
                const def = TRAIT_DEFS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={`trait-card ${trait === id ? "selected" : ""}`}
                    onClick={() => setTrait(id)}
                  >
                    <strong>{def.name}</strong>
                    <span className="profession-desc">{def.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
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
    </LobbyShell>
  );
}
