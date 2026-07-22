import { useEffect, useState } from "react";
import type {
  CharacterAuthResponse,
  CharacterListResponse,
  CharacterSummary,
} from "@skilling-mmo/shared";
import { PROFESSION_LABELS } from "@skilling-mmo/shared";
import { CharacterCreatePanel } from "./CharacterCreatePanel";
import { LobbyShell } from "./LobbyShell";

export function CharacterSelectPanel({
  apiBase,
  accountToken,
  username,
  onSelect,
  onLogout,
}: {
  apiBase: string;
  accountToken: string;
  username: string;
  onSelect: (res: CharacterAuthResponse) => void;
  onLogout: () => void;
}) {
  const [data, setData] = useState<CharacterListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setError(null);
    const r = await fetch(`${apiBase}/auth/characters`, {
      headers: { Authorization: `Bearer ${accountToken}` },
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? "load_failed");
    setData(body as CharacterListResponse);
  }

  useEffect(() => {
    void load().catch((e) => setError(e.message ?? String(e)));
  }, [accountToken]);

  async function selectCharacter(character: CharacterSummary) {
    setBusyId(character.id);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/auth/select`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accountToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playerId: character.id }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "select_failed");
      onSelect(body as CharacterAuthResponse);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (creating) {
    return (
      <CharacterCreatePanel
        apiBase={apiBase}
        accountToken={accountToken}
        slotsRemaining={data?.slotsRemaining ?? 1}
        onCreated={(res) => {
          setCreating(false);
          onSelect(res);
        }}
        onBack={() => setCreating(false)}
      />
    );
  }

  const slots = data?.characters ?? [];
  const max = data?.maxCharacters ?? 3;
  const canCreate = (data?.slotsRemaining ?? 0) > 0;

  return (
    <LobbyShell>
      <div className="lobby-card character-card">
        <div className="lobby-header">
          <div>
            <h1>Select character</h1>
            <p className="muted">Account: {username}</p>
          </div>
          <button type="button" className="ghost" onClick={onLogout}>
            Log out
          </button>
        </div>

        <div className="character-slots">
          {Array.from({ length: max }).map((_, i) => {
            const ch = slots[i];
            if (ch) {
              return (
                <button
                  key={ch.id}
                  type="button"
                  className={`character-slot filled profession-${ch.profession}`}
                  disabled={busyId === ch.id}
                  onClick={() => void selectCharacter(ch)}
                >
                  <span className="slot-label">{PROFESSION_LABELS[ch.profession]}</span>
                  <strong>{ch.name}</strong>
                  <span className="slot-meta">{ch.coins}c</span>
                  <span className="slot-action">
                    {busyId === ch.id ? "Entering…" : "Play"}
                  </span>
                </button>
              );
            }
            return (
              <div key={`empty-${i}`} className="character-slot empty">
                <span className="slot-label">Empty slot</span>
                {i === slots.length && canCreate ? (
                  <button type="button" className="primary" onClick={() => setCreating(true)}>
                    Create character
                  </button>
                ) : (
                  <span className="slot-meta muted">—</span>
                )}
              </div>
            );
          })}
        </div>

        {canCreate && slots.length > 0 && slots.length < max && (
          <button type="button" className="primary wide" onClick={() => setCreating(true)}>
            + New character ({data?.slotsRemaining} slot{data?.slotsRemaining === 1 ? "" : "s"} left)
          </button>
        )}

        {error && <div className="err">{error}</div>}
      </div>
    </LobbyShell>
  );
}
