import { useEffect, useRef, useState, useCallback } from "react";
import { createGame } from "../phaser/createGame";
import type { GameBridge } from "../phaser/createGame";
import { AuthPanel } from "./AuthPanel";
import { CharacterSelectPanel } from "./CharacterSelectPanel";
import { LobbyShell } from "./LobbyShell";
import { GameHud, type HudPanel } from "./GameHud";
import { connectGame, type GameConnection } from "../net/colyseusClient";
import type {
  InventorySlotDto,
  SkillProgressDto,
  CharacterAuthResponse,
  ChatMessageDto,
  ChatInboxThreadDto,
  PlayerSnapshot,
} from "@skilling-mmo/shared";
import { DEFAULT_APPEARANCE } from "@skilling-mmo/shared";
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

type Panel = HudPanel;

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

  const [chatMessages, setChatMessages] = useState<ChatMessageDto[]>([]);
  const [chatInbox, setChatInbox] = useState<ChatInboxThreadDto[]>([]);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [chatError, setChatError] = useState("");
  const [chatMode, setChatMode] = useState<"public" | "dm">("public");
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<PlayerSnapshot[]>([]);

  const character = session?.character ?? null;
  const gameToken = session ? activeGameToken(session) : null;
  const selfId = character?.playerId ?? "";

  const chatModeRef = useRef(chatMode);
  const activeThreadKeyRef = useRef(activeThreadKey);
  const mutedRef = useRef(mutedIds);
  const selfIdRef = useRef(selfId);

  useEffect(() => {
    chatModeRef.current = chatMode;
  }, [chatMode]);

  useEffect(() => {
    activeThreadKeyRef.current = activeThreadKey;
  }, [activeThreadKey]);

  useEffect(() => {
    mutedRef.current = mutedIds;
  }, [mutedIds]);

  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

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

  const loadMutes = useCallback(async () => {
    if (!gameToken) return;
    const r = await fetch(`${API}/chat/mutes`, {
      headers: { Authorization: `Bearer ${gameToken}` },
    });
    if (r.ok) {
      const data = await r.json();
      setMutedIds(new Set(data.mutedPlayerIds));
    }
  }, [gameToken]);

  const loadPublic = useCallback(async () => {
    if (!gameToken) return;
    const r = await fetch(`${API}/chat/public`, {
      headers: { Authorization: `Bearer ${gameToken}` },
    });
    if (r.ok) {
      const data = await r.json();
      setChatMode("public");
      setActiveThreadKey(null);
      setChatMessages(data.messages);
    }
  }, [gameToken]);

  const loadInbox = useCallback(async () => {
    if (!gameToken) return;
    const r = await fetch(`${API}/chat/inbox`, {
      headers: { Authorization: `Bearer ${gameToken}` },
    });
    if (r.ok) setChatInbox((await r.json()).threads);
  }, [gameToken]);

  const loadThread = useCallback(
    async (threadKey: string) => {
      if (!gameToken) return;
      const r = await fetch(`${API}/chat/dm/${encodeURIComponent(threadKey)}`, {
        headers: { Authorization: `Bearer ${gameToken}` },
      });
      if (r.ok) {
        setChatMode("dm");
        setActiveThreadKey(threadKey);
        setChatMessages((await r.json()).messages);
      }
    },
    [gameToken],
  );

  const muteChatPlayer = useCallback(
    async (id: string) => {
      if (!gameToken) return;
      await fetch(`${API}/chat/mutes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gameToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mutedPlayerId: id }),
      });
      await loadMutes();
      if (chatModeRef.current === "public") await loadPublic();
      else if (activeThreadKeyRef.current) await loadThread(activeThreadKeyRef.current);
    },
    [gameToken, loadMutes, loadPublic, loadThread],
  );

  const unmuteChatPlayer = useCallback(
    async (id: string) => {
      if (!gameToken) return;
      await fetch(`${API}/chat/mutes/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${gameToken}` },
      });
      await loadMutes();
      if (chatModeRef.current === "public") await loadPublic();
      else if (activeThreadKeyRef.current) await loadThread(activeThreadKeyRef.current);
    },
    [gameToken, loadMutes, loadPublic, loadThread],
  );

  const openChatThread = useCallback(
    (threadKey: string, _otherPlayerId: string) => {
      void loadThread(threadKey);
    },
    [loadThread],
  );

  const sendChatPublic = useCallback((body: string) => {
    conn.current?.sendIntent({ type: "ChatPublic", body });
  }, []);

  const sendChatDm = useCallback((recipientId: string, body: string) => {
    conn.current?.sendIntent({ type: "ChatDm", recipientId, body });
  }, []);

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
          onChatMessage: (message) => {
            if (cancelled) return;
            setChatError("");
            if (message.channel === "PUBLIC") {
              if (chatModeRef.current !== "public") return;
              if (
                message.senderId !== selfIdRef.current &&
                mutedRef.current.has(message.senderId)
              ) {
                return;
              }
              setChatMessages((prev) => [...prev, message]);
              return;
            }
            // DIRECT
            void loadInbox();
            if (
              chatModeRef.current === "dm" &&
              message.threadKey === activeThreadKeyRef.current
            ) {
              if (
                message.senderId !== selfIdRef.current &&
                mutedRef.current.has(message.senderId)
              ) {
                return;
              }
              setChatMessages((prev) => [...prev, message]);
            }
          },
          onChatError: (error) => {
            if (!cancelled) {
              setChatError(error === "rate_limited" ? "slow down" : error);
            }
          },
          getPredictedPos: () => bridge.current?.getLocalPos() ?? { x: 160, y: 160 },
          reconcilePlayer: (id, x, y) => bridge.current?.reconcilePlayer(id, x, y),
        });
        if (cancelled) {
          c.leave();
          return;
        }
        conn.current = c;
        void loadMutes();
        void loadPublic();
        void loadInbox();
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

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(() => {
      setOnlinePlayers(conn.current?.getOnlinePlayers() ?? []);
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const inLobby = !session || !character;
  const connectFailed = !!character && status.startsWith("connect failed");
  const connecting =
    !!character && status !== "connected" && !connectFailed;

  return (
    <>
      <div
        id="game-root"
        ref={gameHost}
        className={
          inLobby || connecting || connectFailed
            ? "lobby-backdrop"
            : "with-hud"
        }
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
                  Back to profiles
                </button>
              </div>
            ) : null}
          </LobbyShell>
        ) : (
          <GameHud
            displayName={character.displayName}
            username={session.username}
            profession={character.profession}
            traits={character.traits ?? []}
            appearance={character.appearance ?? DEFAULT_APPEARANCE}
            coins={coins}
            status={status}
            skills={skills}
            panel={panel}
            onPanel={setPanel}
            inventory={inventory}
            bank={bank}
            token={gameToken!}
            apiBase={API}
            onRefreshBank={async () => {
              await refreshBank();
              const r = await fetch(`${API}/player/inventory`, {
                headers: { Authorization: `Bearer ${gameToken}` },
              });
              if (r.ok) {
                const d = await r.json();
                setInventory(d.slots);
              }
            }}
            onProfiles={switchCharacter}
            onLogout={logoutAccount}
            selfId={selfId}
            chatMessages={chatMessages}
            chatInbox={chatInbox}
            mutedIds={mutedIds}
            onlinePlayers={onlinePlayers}
            chatError={chatError}
            onSendPublic={sendChatPublic}
            onSendDm={sendChatDm}
            onOpenThread={openChatThread}
            onRefreshInbox={() => void loadInbox()}
            onMutePlayer={(id) => void muteChatPlayer(id)}
            onUnmutePlayer={(id) => void unmuteChatPlayer(id)}
            onLoadPublicChat={() => void loadPublic()}
          />
        )}
      </div>
    </>
  );
}
