import { Client, Room } from "colyseus.js";
import type {
  ClientMessage,
  ServerMessage,
  InventorySlotDto,
  SkillProgressDto,
  ChatMessageDto,
  PlayerSnapshot,
} from "@skilling-mmo/shared";

/** Colyseus endpoint must be a full origin (ws://host), never a path like /ws. */
function resolveEndpoint(): string {
  const env = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
  if (
    env &&
    (env.startsWith("ws://") ||
      env.startsWith("wss://") ||
      env.startsWith("http://") ||
      env.startsWith("https://"))
  ) {
    return env.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.host) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}`;
  }
  return "ws://127.0.0.1:2567";
}

export interface HudLiveState {
  skills: SkillProgressDto[];
  inventory: InventorySlotDto[];
  coins: number;
}

export interface GameConnection {
  sendIntent: (msg: ClientMessage) => void;
  leave: () => void;
  getOnlinePlayers: () => PlayerSnapshot[];
  getHudState: () => HudLiveState;
}

export interface ConnectHandlers {
  onSnapshot: (snap: Extract<ServerMessage, { type: "StateSnapshot" }>) => void;
  onInventory: (slots: InventorySlotDto[]) => void;
  onSkill: (s: SkillProgressDto) => void;
  onAction: (msg: Extract<ServerMessage, { type: "ActionResult" }>) => void;
  onStatus: (status: string) => void;
  onChatMessage: (message: ChatMessageDto) => void;
  onChatError: (error: string) => void;
  getPredictedPos: () => { x: number; y: number };
  reconcilePlayer: (id: string, x: number, y: number) => void;
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object" && "type" in e) {
    return `network ${(e as { type: string }).type}`;
  }
  return String(e);
}

function asRecord(msg: unknown): Record<string, unknown> {
  return msg && typeof msg === "object" ? (msg as Record<string, unknown>) : {};
}

function parseSkill(msg: unknown): SkillProgressDto | null {
  const m = asRecord(msg);
  const skill = m.skill;
  const level = m.level;
  const xp = m.xp;
  if (typeof skill !== "string") return null;
  if (typeof level !== "number" || typeof xp !== "number") return null;
  return { skill: skill as SkillProgressDto["skill"], level, xp };
}

function parseInventory(msg: unknown): InventorySlotDto[] | null {
  if (Array.isArray(msg)) {
    return msg as InventorySlotDto[];
  }
  const m = asRecord(msg);
  if (Array.isArray(m.slots)) {
    return m.slots as InventorySlotDto[];
  }
  return null;
}

function parseActionResult(msg: unknown): Extract<ServerMessage, { type: "ActionResult" }> {
  const m = asRecord(msg);
  const nestedSkill = m.skill && typeof m.skill === "object" ? parseSkill(m.skill) : null;
  const inventory = Array.isArray(m.inventory) ? (m.inventory as InventorySlotDto[]) : null;
  return {
    type: "ActionResult",
    ok: Boolean(m.ok),
    reason: typeof m.reason === "string" ? m.reason : undefined,
    action: typeof m.action === "string" ? m.action : undefined,
    resourceId: typeof m.resourceId === "string" ? m.resourceId : undefined,
    skill: nestedSkill ?? undefined,
    inventory: inventory ?? undefined,
  };
}

export async function connectGame(
  token: string,
  handlers: ConnectHandlers,
): Promise<GameConnection> {
  const endpoint = resolveEndpoint();
  const client = new Client(endpoint);

  let room: Room | null = null;
  let intentionalLeave = false;
  let reconnectAttempt = 0;
  let onlinePlayers: PlayerSnapshot[] = [];
  let hudState: HudLiveState = { skills: [], inventory: [], coins: 0 };

  function applySkill(s: SkillProgressDto) {
    const rest = hudState.skills.filter((x) => x.skill !== s.skill);
    hudState = {
      ...hudState,
      skills: [...rest, { skill: s.skill, level: s.level, xp: s.xp }],
    };
    handlers.onSkill(s);
  }

  function applyInventory(slots: InventorySlotDto[]) {
    hudState = {
      ...hudState,
      inventory: slots.map((s) => ({ ...s })),
    };
    handlers.onInventory(hudState.inventory);
  }

  async function join() {
    handlers.onStatus(reconnectAttempt ? `reconnecting (${reconnectAttempt})…` : "joining…");
    room = await client.joinOrCreate("world", { token });
    reconnectAttempt = 0;
    handlers.onStatus("connected");

    room.onMessage("StateSnapshot", (msg: Extract<ServerMessage, { type: "StateSnapshot" }>) => {
      hudState = {
        skills: (msg.you?.skills ?? []).map((s) => ({ ...s })),
        inventory: (msg.you?.inventory ?? []).map((s) => ({ ...s })),
        coins: msg.you?.coins ?? 0,
      };
      handlers.onSnapshot(msg);
    });

    room.onMessage("InventoryUpdate", (msg: unknown) => {
      const slots = parseInventory(msg);
      if (slots) applyInventory(slots);
    });

    room.onMessage("SkillUpdate", (msg: unknown) => {
      const skill = parseSkill(msg);
      if (skill) applySkill(skill);
    });

    room.onMessage("ActionResult", (msg: unknown) => {
      const parsed = parseActionResult(msg);
      if (parsed.ok && parsed.action === "woodcutting_complete") {
        if (parsed.skill) applySkill(parsed.skill);
        if (parsed.inventory) applyInventory(parsed.inventory);
      }
      handlers.onAction(parsed);
    });

    room.onMessage("ChatMessage", (msg: Extract<ServerMessage, { type: "ChatMessage" }>) => {
      handlers.onChatMessage(msg.message);
    });
    room.onMessage("ChatError", (msg: Extract<ServerMessage, { type: "ChatError" }>) => {
      handlers.onChatError(msg.error);
    });

    room.onStateChange((state: any) => {
      onlinePlayers = [];
      state.players?.forEach((p: any, id: string) => {
        onlinePlayers.push({
          id,
          name: p.name,
          x: p.x,
          y: p.y,
          action: p.action || null,
          appearance: {
            hairColor: p.hairColor,
            skinColor: p.skinColor,
            shirtColor: p.shirtColor,
            pantsColor: p.pantsColor,
          },
        });
        handlers.reconcilePlayer(id, p.x, p.y);
      });
    });

    room.onLeave((code) => {
      handlers.onStatus(`disconnected (${code})`);
      room = null;
      if (!intentionalLeave) {
        scheduleReconnect();
      }
    });

    room.onError((code, message) => {
      handlers.onStatus(`error ${code}: ${message}`);
    });
  }

  function scheduleReconnect() {
    reconnectAttempt += 1;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttempt, 5));
    handlers.onStatus(`reconnect in ${delay}ms…`);
    setTimeout(() => {
      if (intentionalLeave) return;
      join().catch((e) => {
        handlers.onStatus(`reconnect failed: ${errorText(e)}`);
        scheduleReconnect();
      });
    }, delay);
  }

  await join();

  return {
    sendIntent(msg) {
      room?.send("intent", msg);
    },
    leave() {
      intentionalLeave = true;
      room?.leave();
      room = null;
    },
    getOnlinePlayers() {
      return onlinePlayers;
    },
    getHudState() {
      return hudState;
    },
  };
}
