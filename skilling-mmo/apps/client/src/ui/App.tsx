import { useEffect, useRef, useState, useCallback } from "react";
import { createGame } from "../phaser/createGame";
import type { GameBridge } from "../phaser/createGame";
import { AuthPanel } from "./AuthPanel";
import { CharacterSelectPanel } from "./CharacterSelectPanel";
import { LobbyShell } from "./LobbyShell";
import { GameHud, type HudPanel } from "./GameHud";
import { TravelMap } from "./TravelMap";
import { ShopPanel } from "./ShopPanel";
import { connectGame, type GameConnection } from "../net/colyseusClient";
import type {
  InventorySlotDto,
  SkillProgressDto,
  ClassProgressDto,
  CharacterAuthResponse,
  ChatMessageDto,
  ChatInboxThreadDto,
  PlayerSnapshot,
  EquipmentLoadout,
  ItemLocation,
  ZoneId,
} from "@skilling-mmo/shared";
import { DEFAULT_APPEARANCE, INVENTORY_BASE_SLOTS, isSystemChatMessage } from "@skilling-mmo/shared";
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
  const [bankOpen, setBankOpen] = useState(false);
  const [showTravel, setShowTravel] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [inventory, setInventory] = useState<InventorySlotDto[]>([]);
  const [inventoryCapacity, setInventoryCapacity] = useState(INVENTORY_BASE_SLOTS);
  const [equipment, setEquipment] = useState<EquipmentLoadout>({});
  const [skills, setSkills] = useState<SkillProgressDto[]>([]);
  const [classes, setClasses] = useState<ClassProgressDto[]>([]);
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

  const resetChatState = useCallback(() => {
    chatModeRef.current = "public";
    activeThreadKeyRef.current = null;
    mutedRef.current = new Set();
    setChatMessages([]);
    setChatInbox([]);
    setMutedIds(new Set());
    setChatError("");
    setChatMode("public");
    setActiveThreadKey(null);
    setOnlinePlayers([]);
  }, []);

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
    bridge.current?.clearPlayers();
    setStatus("logged out");
    resetChatState();
  }, [resetChatState]);

  const switchCharacter = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null;
      conn.current?.leave();
      conn.current = null;
      bridge.current?.clearPlayers();
      setStatus("idle");
      return clearCharacter(prev);
    });
    resetChatState();
  }, [resetChatState]);

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
    // Switch mode/refs synchronously before the async fetch so any chat
    // message received while this request is in flight is filtered against
    // the *new* view instead of the stale one (thread-open race fix).
    chatModeRef.current = "public";
    activeThreadKeyRef.current = null;
    setChatMode("public");
    setActiveThreadKey(null);
    setChatMessages([]);
    const r = await fetch(`${API}/chat/public`, {
      headers: { Authorization: `Bearer ${gameToken}` },
    });
    if (r.ok) {
      const data = await r.json();
      if (chatModeRef.current === "public") {
        // Drop any system/ephemeral rows — login notices are live-only
        const history = (data.messages as ChatMessageDto[]).filter(
          (m) => !isSystemChatMessage(m),
        );
        setChatMessages(history);
      }
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
      // Same synchronous switch as loadPublic — set mode/thread/refs and
      // clear stale messages before awaiting the fetch.
      chatModeRef.current = "dm";
      activeThreadKeyRef.current = threadKey;
      setChatMode("dm");
      setActiveThreadKey(threadKey);
      setChatMessages([]);
      const r = await fetch(`${API}/chat/dm/${encodeURIComponent(threadKey)}`, {
        headers: { Authorization: `Bearer ${gameToken}` },
      });
      if (r.ok) {
        const data = await r.json();
        // Guard against a late response landing after the user switched
        // to a different thread/view in the meantime.
        if (activeThreadKeyRef.current === threadKey) {
          setChatMessages(data.messages);
        }
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
      onInteractResource: (resourceId) =>
        conn.current?.sendIntent({ type: "InteractResource", resourceId }),
      onInteractNpc: (npcId) =>
        conn.current?.sendIntent({ type: "InteractNpc", npcId }),
    });
    return () => {
      bridge.current?.destroy();
      bridge.current = null;
    };
  }, []);

  useEffect(() => {
    if (!gameToken) return;
    let cancelled = false;
    resetChatState();

    const onInventory = (slots: InventorySlotDto[]) => {
      if (cancelled) return;
      setInventory(slots.map((s) => ({ ...s })));
    };
    const onSkill = (s: SkillProgressDto) => {
      if (cancelled) return;
      setSkills((prev) => {
        const rest = prev.filter((x) => x.skill !== s.skill);
        return [...rest, { skill: s.skill, level: s.level, xp: s.xp }];
      });
    };
    const onClasses = (next: ClassProgressDto[]) => {
      if (cancelled) return;
      setClasses(next.map((c) => ({ ...c })));
    };

    (async () => {
      setStatus("connecting…");
      try {
        const c = await connectGame(gameToken, {
          onSnapshot: (snap) => {
            if (cancelled) return;
            setInventory((snap.you.inventory ?? []).map((s) => ({ ...s })));
            setSkills((snap.you.skills ?? []).map((s) => ({ ...s })));
            setClasses((snap.you.classes ?? []).map((c) => ({ ...c })));
            setCoins(snap.you.coins);
            if (snap.you.equipment) setEquipment(snap.you.equipment);
            if (typeof snap.you.inventoryCapacity === "number") {
              setInventoryCapacity(snap.you.inventoryCapacity);
            }
            bridge.current?.applySnapshot(snap);
            setStatus("connected");
          },
          onInventory,
          onSkill,
          onClasses,
          onCoins: (coins) => {
            if (!cancelled) setCoins(coins);
          },
          onEquipment: (eq, capacity) => {
            if (cancelled) return;
            setEquipment(eq);
            setInventoryCapacity(capacity);
          },
          onAction: (msg) => {
            bridge.current?.onActionResult(msg);
            if (!cancelled && msg.action === "item_drag" && !msg.ok) {
              const hints: Record<string, string> = {
                clear_backpack_slots: "Move items out of backpack slots first",
                wrong_slot: "That item can't go there",
                occupied: "Target slot is occupied",
                empty: "Nothing to move",
                invalid_slot: "Invalid slot",
                cannot_swap_stack: "Can't swap with a stack",
              };
              setStatus(hints[msg.reason ?? ""] ?? `Can't move item (${msg.reason ?? "error"})`);
              window.setTimeout(() => {
                if (!cancelled) setStatus("connected");
              }, 2200);
            }
          },
          onOpenPanel: (openPanel) => {
            if (cancelled) return;
            // Modal steals pointerup from Phaser — unlock world input
            bridge.current?.releaseInput();
            if (openPanel === "travel") setShowTravel(true);
            else if (openPanel === "shop") setShowShop(true);
            else if (openPanel === "bank") {
              setBankOpen(true);
              void refreshBank();
            }
          },
          onStatus: (s) => {
            if (!cancelled) setStatus(s);
          },
          onChatMessage: (message) => {
            if (cancelled) return;
            setChatError("");
            if (message.channel === "PUBLIC") {
              // System notices (login, etc.) are live-only — never muted, always shown
              if (isSystemChatMessage(message)) {
                setChatMessages((prev) => [...prev, message]);
                return;
              }
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
          getPredictedPos: () => bridge.current?.getLocalPos() ?? { x: 640, y: 480 },
          reconcilePlayer: (id, x, y) => bridge.current?.reconcilePlayer(id, x, y),
          removePlayer: (id) => bridge.current?.removePlayer(id),
        });
        if (cancelled) {
          c.leave();
          return;
        }
        conn.current = c;
        // Sync HUD from connection store (covers any missed React setState races)
        const hud = c.getHudState();
        setInventory(hud.inventory.map((s) => ({ ...s })));
        setSkills(hud.skills.map((s) => ({ ...s })));
        setClasses(hud.classes.map((c) => ({ ...c })));
        setCoins(hud.coins);
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
      bridge.current?.clearPlayers();
    };
  }, [gameToken]);

  useEffect(() => {
    if (showTravel || showShop || bankOpen) {
      bridge.current?.releaseInput();
    }
  }, [showTravel, showShop, bankOpen]);

  useEffect(() => {
    if (bankOpen) void refreshBank();
  }, [bankOpen, refreshBank]);

  const syncAfterBank = useCallback(async () => {
    await refreshBank();
    if (!gameToken) return;
    const r = await fetch(`${API}/player/inventory`, {
      headers: { Authorization: `Bearer ${gameToken}` },
    });
    if (r.ok) {
      const d = await r.json();
      setInventory(d.slots);
      if (typeof d.capacity === "number") setInventoryCapacity(d.capacity);
    }
    conn.current?.sendIntent({ type: "SyncInventory" });
  }, [gameToken, refreshBank]);

  const handleItemDrag = useCallback(
    async (from: ItemLocation, to: ItemLocation) => {
      if (from.kind === "bank" || to.kind === "bank") {
        if (from.kind === "equipment" || to.kind === "equipment") return;
        if (!gameToken) return;
        const r = await fetch(`${API}/player/bank/move`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gameToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          const hints: Record<string, string> = {
            bank_full: "Bank is full",
            inventory_full: "Bag is full",
            stack_full: "Stack is full",
            empty: "Nothing to move",
            invalid_slot: "Invalid slot",
            cannot_partial_swap: "Can't partially swap different items",
          };
          const err = typeof d.error === "string" ? d.error : "move_failed";
          setStatus(hints[err] ?? `Bank move failed (${err})`);
          window.setTimeout(() => setStatus("connected"), 2200);
          return;
        }
        await syncAfterBank();
        return;
      }
      conn.current?.sendIntent({ type: "ItemDrag", from, to });
    },
    [gameToken, syncAfterBank],
  );

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(() => {
      setOnlinePlayers(conn.current?.getOnlinePlayers() ?? []);
      const hud = conn.current?.getHudState();
      if (!hud) return;
      setSkills((prev) => {
        const next = hud.skills;
        if (
          prev.length === next.length &&
          prev.every((s, i) => s.skill === next[i]?.skill && s.level === next[i]?.level && s.xp === next[i]?.xp)
        ) {
          return prev;
        }
        return next.map((s) => ({ ...s }));
      });
      setClasses((prev) => {
        const next = hud.classes;
        if (
          prev.length === next.length &&
          prev.every(
            (c, i) =>
              c.classId === next[i]?.classId &&
              c.level === next[i]?.level &&
              c.xp === next[i]?.xp &&
              c.unlocked === next[i]?.unlocked,
          )
        ) {
          return prev;
        }
        return next.map((c) => ({ ...c }));
      });
      setInventory((prev) => {
        const next = hud.inventory;
        if (
          prev.length === next.length &&
          prev.every(
            (s, i) =>
              s.slot === next[i]?.slot &&
              s.itemId === next[i]?.itemId &&
              s.quantity === next[i]?.quantity,
          )
        ) {
          return prev;
        }
        return next.map((s) => ({ ...s }));
      });
      setCoins((prev) => (prev === hud.coins ? prev : hud.coins));
      setInventoryCapacity((prev) =>
        prev === hud.inventoryCapacity ? prev : hud.inventoryCapacity,
      );
      setEquipment((prev) => {
        const next = hud.equipment;
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return next;
      });
    }, 250);
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
            classes={classes}
            panel={panel}
            onPanel={setPanel}
            inventory={inventory}
            inventoryCapacity={inventoryCapacity}
            equipment={equipment}
            bank={bank}
            token={gameToken!}
            apiBase={API}
            bankOpen={bankOpen}
            onBankOpen={setBankOpen}
            onRefreshBank={syncAfterBank}
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
            onItemDrag={(from: ItemLocation, to: ItemLocation) => {
              void handleItemDrag(from, to);
            }}
          />
        )}
        {showTravel ? (
          <TravelMap
            onTravel={(zone: ZoneId) => {
              conn.current?.sendIntent({ type: "TravelZone", zone });
              setShowTravel(false);
              bridge.current?.releaseInput();
            }}
            onClose={() => {
              setShowTravel(false);
              bridge.current?.releaseInput();
            }}
          />
        ) : null}
        {showShop ? (
          <ShopPanel
            coins={coins}
            inventory={inventory}
            onBuy={(itemId, quantity) => {
              conn.current?.sendIntent({ type: "ShopBuy", itemId, quantity });
            }}
            onSell={(itemId, quantity) => {
              conn.current?.sendIntent({ type: "ShopSell", itemId, quantity });
            }}
            onClose={() => {
              setShowShop(false);
              bridge.current?.releaseInput();
            }}
          />
        ) : null}
      </div>
    </>
  );
}
