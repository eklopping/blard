import { useEffect, useState } from "react";
import type {
  CharacterAuthResponse,
  CharacterListResponse,
  CharacterSummary,
} from "@skilling-mmo/shared";
import { PROFESSION_LABELS, DEFAULT_APPEARANCE, TRAIT_DEFS } from "@skilling-mmo/shared";
import { CharacterCreatePanel } from "./CharacterCreatePanel";
import { LobbyShell } from "./LobbyShell";
import { PixelAvatarPreview } from "./PixelAvatarPreview";

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  async function saveRename(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    setError(null);
    try {
      const r = await fetch(`${apiBase}/auth/characters/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accountToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "rename_failed");
      setRenamingId(null);
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  async function moveCharacter(id: string, direction: -1 | 1) {
    if (!data) return;
    const list = [...data.characters];
    const idx = list.findIndex((c) => c.id === id);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= list.length) return;

    const ordered = [...list];
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    const orderedIds = ordered.map((c) => c.id);

    setData({
      ...data,
      characters: ordered.map((c, i) => ({ ...c, sortOrder: i })),
    });

    try {
      const r = await fetch(`${apiBase}/auth/characters/reorder`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accountToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderedIds }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "reorder_failed");
      setData(body as CharacterListResponse);
    } catch (e: any) {
      setError(e.message ?? String(e));
      await load().catch(() => undefined);
    }
  }

  async function deleteCharacter(character: CharacterSummary) {
    const ok = window.confirm(
      `Delete profile “${character.name}”? This frees a slot and cannot be undone.`,
    );
    if (!ok) return;
    setError(null);
    try {
      const r = await fetch(`${apiBase}/auth/characters/${character.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accountToken}` },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "delete_failed");
      if (renamingId === character.id) setRenamingId(null);
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
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
            <h1>Profiles</h1>
            <p className="muted">Account: {username} · rename, reorder, then play</p>
          </div>
          <button type="button" className="ghost" onClick={onLogout}>
            Log out
          </button>
        </div>

        <div className="character-slots">
          {Array.from({ length: max }).map((_, i) => {
            const ch = slots[i];
            if (ch) {
              const isRenaming = renamingId === ch.id;
              return (
                <div key={ch.id} className={`character-slot filled profession-${ch.profession}`}>
                  <PixelAvatarPreview
                    appearance={ch.appearance ?? DEFAULT_APPEARANCE}
                    scale={3}
                  />
                  <span className="slot-label">{PROFESSION_LABELS[ch.profession]}</span>

                  {isRenaming ? (
                    <input
                      className="rename-input"
                      value={renameValue}
                      maxLength={24}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(ch.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <strong>{ch.name}</strong>
                  )}

                  <span className="slot-meta">
                    {ch.coins}c
                    {ch.traits?.[0] && TRAIT_DEFS[ch.traits[0]]
                      ? ` · ${TRAIT_DEFS[ch.traits[0]].name}`
                      : ""}
                  </span>

                  <div className="slot-manage" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="ghost tiny"
                      disabled={i === 0}
                      title="Move left"
                      onClick={() => void moveCharacter(ch.id, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="ghost tiny"
                      disabled={i >= slots.length - 1}
                      title="Move right"
                      onClick={() => void moveCharacter(ch.id, 1)}
                    >
                      →
                    </button>
                    {isRenaming ? (
                      <>
                        <button
                          type="button"
                          className="ghost tiny"
                          onClick={() => void saveRename(ch.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="ghost tiny"
                          onClick={() => setRenamingId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="ghost tiny"
                          onClick={() => {
                            setRenamingId(ch.id);
                            setRenameValue(ch.name);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="ghost tiny danger-text"
                          onClick={() => void deleteCharacter(ch)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    className="primary slot-play"
                    disabled={busyId === ch.id || isRenaming}
                    onClick={() => void selectCharacter(ch)}
                  >
                    {busyId === ch.id ? "Entering…" : "Play"}
                  </button>
                </div>
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
