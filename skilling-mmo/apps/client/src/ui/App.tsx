import { useEffect, useRef, useState, useCallback } from "react";
import { createGame } from "../phaser/createGame";
import type { GameBridge } from "../phaser/createGame";
import { AuthPanel } from "./AuthPanel";
import { InventoryPanel } from "./InventoryPanel";
import { BankPanel } from "./BankPanel";
import { MarketPanel } from "./MarketPanel";
import { connectGame, type GameConnection } from "../net/colyseusClient";
import type {
  InventorySlotDto,
  SkillProgressDto,
  AuthResponse,
} from "@skilling-mmo/shared";

type Panel = "inventory" | "bank" | "market" | null;

const API = import.meta.env.VITE_API_URL ?? "/api";

export function App() {
  const gameHost = useRef<HTMLDivElement>(null);
  const bridge = useRef<GameBridge | null>(null);
  const conn = useRef<GameConnection | null>(null);

  const [auth, setAuth] = useState<AuthResponse | null>(() => {
    const raw = localStorage.getItem("skilling_auth");
    return raw ? (JSON.parse(raw) as AuthResponse) : null;
  });
  const [panel, setPanel] = useState<Panel>("inventory");
  const [inventory, setInventory] = useState<InventorySlotDto[]>([]);
  const [skills, setSkills] = useState<SkillProgressDto[]>([]);
  const [coins, setCoins] = useState(0);
  const [status, setStatus] = useState("idle");
  const [bank, setBank] = useState<InventorySlotDto[]>([]);

  const onAuth = useCallback((res: AuthResponse) => {
    localStorage.setItem("skilling_auth", JSON.stringify(res));
    setAuth(res);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("skilling_auth");
    setAuth(null);
    conn.current?.leave();
    conn.current = null;
    setStatus("logged out");
  }, []);

  const refreshBank = useCallback(async () => {
    if (!auth) return;
    const r = await fetch(`${API}/player/bank`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (r.ok) {
      const data = await r.json();
      setBank(data.slots);
    }
  }, [auth]);

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
    if (!auth) return;
    let cancelled = false;

    (async () => {
      setStatus("connecting…");
      try {
        const c = await connectGame(auth.accessToken, {
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
  }, [auth]);

  useEffect(() => {
    if (panel === "bank") void refreshBank();
  }, [panel, refreshBank]);

  return (
    <>
      <div id="game-root" ref={gameHost} />
      <div id="ui-root">
        {!auth ? (
          <AuthPanel apiBase={API} onAuth={onAuth} />
        ) : (
          <>
            <header className="hud-top">
              <strong className="brand">Skilling MMO</strong>
              <span className="muted">
                {auth.displayName} · {coins}c · {status}
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
                <button type="button" onClick={logout}>
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
                token={auth.accessToken}
                apiBase={API}
                onRefresh={async () => {
                  await refreshBank();
                  const r = await fetch(`${API}/player/inventory`, {
                    headers: { Authorization: `Bearer ${auth.accessToken}` },
                  });
                  if (r.ok) {
                    const d = await r.json();
                    setInventory(d.slots);
                  }
                }}
              />
            )}
            {panel === "market" && (
              <MarketPanel token={auth.accessToken} apiBase={API} coins={coins} />
            )}
          </>
        )}
      </div>
      <style>{`
        .hud-top {
          display: flex; gap: 1rem; align-items: center;
          padding: 0.6rem 1rem;
          background: linear-gradient(180deg, var(--bg-panel), transparent);
        }
        .brand { font-family: var(--font-display); font-size: 1.25rem; color: var(--accent); }
        .muted { color: var(--muted); font-size: 0.85rem; flex: 1; }
        .hud-top nav { display: flex; gap: 0.4rem; }
        .hud-top button, .panel button {
          background: var(--accent-dim); color: var(--fg); border: 1px solid var(--border);
          padding: 0.35rem 0.7rem; cursor: pointer; font-family: var(--font-ui);
        }
        .hud-top button:hover, .panel button:hover { background: var(--accent); color: #1a1a12; }
        .skills {
          position: absolute; top: 3rem; left: 0.75rem;
          background: var(--bg-panel); padding: 0.5rem 0.75rem;
          border: 1px solid var(--border); font-size: 0.8rem;
        }
        .panel {
          position: absolute; right: 0.75rem; bottom: 0.75rem;
          width: min(360px, 92vw); max-height: 50vh; overflow: auto;
          background: var(--bg-panel); border: 1px solid var(--border);
          padding: 0.75rem;
        }
        .panel h2 { margin: 0 0 0.5rem; font-family: var(--font-display); font-size: 1rem; color: var(--accent); }
        .grid {
          display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
        }
        .slot {
          aspect-ratio: 1; background: rgba(0,0,0,0.35); border: 1px solid var(--border);
          font-size: 0.65rem; display: flex; flex-direction: column; align-items: center; justify-content: center;
          cursor: pointer; padding: 2px; text-align: center;
        }
        .slot.empty { opacity: 0.4; }
        .auth-wrap {
          position: absolute; inset: 0; display: grid; place-items: center;
          background: radial-gradient(ellipse at 30% 20%, #2a4a2a, var(--bg-deep) 60%);
        }
        .auth-card {
          width: min(360px, 92vw); padding: 1.5rem;
          background: var(--bg-panel); border: 1px solid var(--border);
        }
        .auth-card h1 { font-family: var(--font-display); color: var(--accent); margin: 0 0 0.25rem; }
        .auth-card p { color: var(--muted); margin: 0 0 1rem; font-size: 0.9rem; }
        .auth-card label { display: block; font-size: 0.8rem; margin-top: 0.5rem; color: var(--muted); }
        .auth-card input {
          width: 100%; margin-top: 0.25rem; padding: 0.5rem;
          background: rgba(0,0,0,0.4); border: 1px solid var(--border); color: var(--fg);
        }
        .auth-card .row { display: flex; gap: 0.5rem; margin-top: 1rem; }
        .auth-card .err { color: var(--danger); font-size: 0.85rem; margin-top: 0.5rem; }
        .market-row { display: flex; gap: 0.4rem; margin: 0.4rem 0; flex-wrap: wrap; }
        .market-row input, .market-row select {
          background: rgba(0,0,0,0.4); border: 1px solid var(--border); color: var(--fg); padding: 0.35rem;
        }
      `}</style>
    </>
  );
}
