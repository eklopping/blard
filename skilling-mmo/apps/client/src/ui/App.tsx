import { useEffect, useRef, useState, useCallback } from "react";
import { createGame } from "../phaser/createGame";
import type { GameBridge } from "../phaser/createGame";
import { AuthPanel } from "./AuthPanel";
import { CharacterSelectPanel } from "./CharacterSelectPanel";
import { LobbyShell } from "./LobbyShell";
import { InventoryPanel } from "./InventoryPanel";
import { BankPanel } from "./BankPanel";
import { MarketPanel } from "./MarketPanel";
import { connectGame, type GameConnection } from "../net/colyseusClient";
import type { InventorySlotDto, SkillProgressDto, CharacterAuthResponse } from "@skilling-mmo/shared";
import { PROFESSION_LABELS } from "@skilling-mmo/shared";
import {
  type GameSession,
  loadSession,
  saveSession,
  applyAccountAuth,
  applyCharacterAuth,
  clearCharacter,
  migrateLegacyAuth,
  activeGameToken,
} from "../session";

type Panel = "inventory" | "bank" | "market" | null;

const API = import.meta.env.VITE_API_URL ?? "/api";

export function App() {
  const gameHost = useRef<HTMLDivElement>(null);
  const bridge = useRef<GameBridge | null>(null);
  const conn = useRef<GameConnection | null>(null);

  const [session, setSession] = useState<GameSession | null>(
    () => loadSession() ?? migrateLegacyAuth(),
  );
  const [panel, setPanel] = useState<Panel>("inventory");
  const [inventory, setInventory] = useState<InventorySlotDto[]>([]);
  const [skills, setSkills] = useState<SkillProgressDto[]>([]);
  const [coins, setCoins] = useState(0);
  const [status, setStatus] = useState("idle");
  const [bank, setBank] = useState<InventorySlotDto[]>([]);

  const character = session?.character ?? null;
  const gameToken = session ? activeGameToken(session) : null;

  const onAccountAuth = useCallback((res: Parameters<typeof applyAccountAuth>[0]) => {
    setSession(applyAccountAuth(res));
  }, []);

  const onCharacterAuth = useCallback(
    (res: CharacterAuthResponse) => {
      setSession((prev) => (prev ? applyCharacterAuth(prev, res) : null));
    },
    [],
  );

  const logoutAccount = useCallback(() => {
    saveSession(null);
    setSession(null);
    conn.current?.leave();
    conn.current = null;
    setStatus("logged out");
  }, []);

  const switchCharacter = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null;
      conn.current?.leave();
      conn.current = null;
      setStatus("idle");
      return clearCharacter(prev);
    });
  }, []);

  const refreshBank = useCallback(async () => {
    if (!gameToken) return;
    const r = await fetch(`${API}/player/bank`, {
      headers: { Authorization: `Bearer ${gameToken}` },
    });
    if (r.ok) {
      const data = await r.json();
      setBank(data.slots);
    }
  }, [gameToken]);

  useEffect(() => {
    if (!gameHost.current || bridge.current) return;
    bridge.current = createGame(gameHost.current, {
      onMove: (x, y) => conn.current?.sendIntent({ type: "Move", x, y }),
      onInteractTree: (resourceId) =>
        conn.current?.sendIntent({ type: "InteractResource", resourceId }),
    });
    return () => {
      bridge.current?.destroy();
      bridge.current = null;
    };
  }, []);

  useEffect(() => {
    if (!gameToken) return;
    let cancelled = false;

    (async () => {
      setStatus("connecting…");
      try {
        const c = await connectGame(gameToken, {
          onSnapshot: (snap) => {
            if (cancelled) return;
            setInventory(snap.you.inventory);
            setSkills(snap.you.skills);
            setCoins(snap.you.coins);
            bridge.current?.applySnapshot(snap);
            setStatus("connected");
          },
          onInventory: (slots) => {
            if (!cancelled) setInventory(slots);
          },
          onSkill: (s) => {
            if (cancelled) return;
            setSkills((prev) => {
              const rest = prev.filter((x) => x.skill !== s.skill);
              return [...rest, s];
            });
          },
          onAction: (msg) => {
            if (msg.ok && msg.action === "woodcutting") {
              bridge.current?.predictChopStart();
            }
            if (msg.ok && msg.action === "woodcutting_complete") {
              bridge.current?.predictChopEnd();
            }
          },
          onStatus: (s) => {
            if (!cancelled) setStatus(s);
          },
          getPredictedPos: () => bridge.current?.getLocalPos() ?? { x: 160, y: 160 },
          reconcilePlayer: (id, x, y) => bridge.current?.reconcilePlayer(id, x, y),
        });
        if (cancelled) {
          c.leave();
          return;
        }
        conn.current = c;
      } catch (e: any) {
        const msg =
          e?.message ||
          (e?.type ? `network ${e.type}` : null) ||
          String(e);
        setStatus(`connect failed: ${msg}`);
      }
    })();

    return () => {
      cancelled = true;
      conn.current?.leave();
      conn.current = null;
    };
  }, [gameToken]);

  useEffect(() => {
    if (panel === "bank") void refreshBank();
  }, [panel, refreshBank]);

  const inLobby = !session || !character;
  const connectFailed = !!character && status.startsWith("connect failed");
  const connecting =
    !!character && status !== "connected" && !connectFailed;

  return (
    <>
      <div
        id="game-root"
        ref={gameHost}
        className={inLobby || connecting || connectFailed ? "lobby-backdrop" : ""}
      />
      <div id="ui-root">
        {!session ? (
          <AuthPanel apiBase={API} onAccountAuth={onAccountAuth} />
        ) : !character ? (
          <CharacterSelectPanel
            apiBase={API}
            accountToken={session.accountToken}
            username={session.username}
            onSelect={onCharacterAuth}
            onLogout={logoutAccount}
          />
        ) : connecting || connectFailed ? (
          <LobbyShell loadingLabel={connectFailed ? status : status === "idle" ? "Entering world…" : status}>
            {connectFailed ? (
              <div className="lobby-card auth-card" style={{ width: "min(360px, 92vw)" }}>
                <p className="err" style={{ marginTop: 0 }}>
                  {status}
                </p>
                <button type="button" className="primary" onClick={switchCharacter}>
                  Back to characters
                </button>
              </div>
            ) : null}
          </LobbyShell>
        ) : (
          <>
            <header className="hud-top">
              <strong className="brand">Skilling MMO</strong>
              <span className="muted">
                {character.displayName} · {PROFESSION_LABELS[character.profession]} · {coins}c ·{" "}
                {status}
              </span>
              <nav>
                <button type="button" onClick={() => setPanel("inventory")}>
                  Inv
                </button>
                <button type="button" onClick={() => setPanel("bank")}>
                  Bank
                </button>
                <button type="button" onClick={() => setPanel("market")}>
                  Market
                </button>
                <button type="button" onClick={switchCharacter}>
                  Characters
                </button>
                <button type="button" onClick={logoutAccount}>
                  Log out
                </button>
              </nav>
            </header>
            <aside className="skills">
              {skills.map((s) => (
                <div key={s.skill}>
                  {s.skill} {s.level} ({s.xp} xp)
                </div>
              ))}
            </aside>
            {panel === "inventory" && <InventoryPanel slots={inventory} />}
            {panel === "bank" && (
              <BankPanel
                inventory={inventory}
                bank={bank}
                token={gameToken!}
                apiBase={API}
                onRefresh={async () => {
                  await refreshBank();
                  const r = await fetch(`${API}/player/inventory`, {
                    headers: { Authorization: `Bearer ${gameToken}` },
                  });
                  if (r.ok) {
                    const d = await r.json();
                    setInventory(d.slots);
                  }
                }}
              />
            )}
            {panel === "market" && (
              <MarketPanel token={gameToken!} apiBase={API} coins={coins} />
            )}
          </>
        )}
      </div>
    </>
  );
}
