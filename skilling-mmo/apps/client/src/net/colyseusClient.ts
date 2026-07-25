import { Client, Room } from "colyseus.js";
import type {
  ClientMessage,
  ServerMessage,
  InventorySlotDto,
  SkillProgressDto,
  ChatMessageDto,
  PlayerSnapshot,
  SkillId,
  EquipmentLoadout,
} from "@skilling-mmo/shared";
import { SKILLS, INVENTORY_BASE_SLOTS, parseEquipmentJson } from "@skilling-mmo/shared";

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
  inventoryCapacity: number;
  equipment: EquipmentLoadout;
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
  onCoins?: (coins: number) => void;
  onEquipment?: (equipment: EquipmentLoadout, capacity: number) => void;
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

function parseInventoryJson(raw: unknown): InventorySlotDto[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InventorySlotDto[]) : null;
  } catch {
    return null;
  }
}

function parseActionResult(msg: unknown): Extract<ServerMessage, { type: "ActionResult" }> {
  const m = asRecord(msg);
  let skill: SkillProgressDto | undefined;
  if (typeof m.skillId === "string" && typeof m.skillLevel === "number" && typeof m.skillXp === "number") {
    skill = {
      skill: m.skillId as SkillId,
      level: m.skillLevel,
      xp: m.skillXp,
    };
  } else if (m.skill && typeof m.skill === "object") {
    const s = asRecord(m.skill);
    if (typeof s.skill === "string" && typeof s.level === "number" && typeof s.xp === "number") {
      skill = { skill: s.skill as SkillId, level: s.level, xp: s.xp };
    }
  }

  const inventory =
    parseInventoryJson(m.inventoryJson) ??
    (Array.isArray(m.inventory) ? (m.inventory as InventorySlotDto[]) : null);

  return {
    type: "ActionResult",
    ok: Boolean(m.ok),
    reason: typeof m.reason === "string" ? m.reason : undefined,
    action: typeof m.action === "string" ? m.action : undefined,
    resourceId: typeof m.resourceId === "string" ? m.resourceId : undefined,
    skillId: typeof m.skillId === "string" ? (m.skillId as SkillId) : undefined,
    skillLevel: typeof m.skillLevel === "number" ? m.skillLevel : undefined,
    skillXp: typeof m.skillXp === "number" ? m.skillXp : undefined,
    inventoryJson: typeof m.inventoryJson === "string" ? m.inventoryJson : undefined,
    equipmentJson: typeof m.equipmentJson === "string" ? m.equipmentJson : undefined,
    inventoryCapacity: typeof m.inventoryCapacity === "number" ? m.inventoryCapacity : undefined,
    skill,
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
  let localPlayerId = "";
  let hudState: HudLiveState = {
    skills: [],
    inventory: [],
    coins: 0,
    inventoryCapacity: INVENTORY_BASE_SLOTS,
    equipment: {},
  };

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

  function applyCoins(coins: number) {
    if (hudState.coins === coins) return;
    hudState = { ...hudState, coins };
    handlers.onCoins?.(coins);
  }

  function applyEquipment(equipment: EquipmentLoadout, capacity?: number) {
    hudState = {
      ...hudState,
      equipment,
      inventoryCapacity: capacity ?? hudState.inventoryCapacity,
    };
    handlers.onEquipment?.(equipment, hudState.inventoryCapacity);
  }

  /** Apply HUD fields from synced Colyseus PlayerState (reliable real-time path). */
  function applyHudFromPlayerState(p: any) {
    if (typeof p.woodcuttingLevel === "number" && typeof p.woodcuttingXp === "number") {
      applySkill({
        skill: SKILLS.WOODCUTTING,
        level: p.woodcuttingLevel,
        xp: p.woodcuttingXp,
      });
    }
    if (typeof p.coins === "number") {
      applyCoins(p.coins);
    }
    if (typeof p.equipmentJson === "string") {
      const equipment = parseEquipmentJson(p.equipmentJson);
      applyEquipment(
        equipment,
        typeof p.inventoryCapacity === "number" ? p.inventoryCapacity : undefined,
      );
    } else if (typeof p.inventoryCapacity === "number") {
      hudState = { ...hudState, inventoryCapacity: p.inventoryCapacity };
    }
    const inv = parseInventoryJson(p.inventoryJson);
    if (inv) applyInventory(inv);
  }

  async function join() {
    handlers.onStatus(reconnectAttempt ? `reconnecting (${reconnectAttempt})…` : "joining…");
    room = await client.joinOrCreate("world", { token });
    reconnectAttempt = 0;
    handlers.onStatus("connected");

    room.onMessage("StateSnapshot", (msg: Extract<ServerMessage, { type: "StateSnapshot" }>) => {
      localPlayerId = msg.you?.playerId ?? localPlayerId;
      hudState = {
        skills: (msg.you?.skills ?? []).map((s) => ({ ...s })),
        inventory: (msg.you?.inventory ?? []).map((s) => ({ ...s })),
        coins: msg.you?.coins ?? 0,
        inventoryCapacity: msg.you?.inventoryCapacity ?? INVENTORY_BASE_SLOTS,
        equipment: msg.you?.equipment ?? {},
      };
      handlers.onSnapshot(msg);
      handlers.onEquipment?.(hudState.equipment, hudState.inventoryCapacity);
    });

    room.onMessage("ActionResult", (msg: unknown) => {
      const parsed = parseActionResult(msg);
      if (parsed.ok && (parsed.action === "woodcutting_complete" || parsed.action === "item_drag")) {
        if (parsed.skill) applySkill(parsed.skill);
        if (parsed.inventory) applyInventory(parsed.inventory);
        if (typeof parsed.equipmentJson === "string") {
          applyEquipment(
            parseEquipmentJson(parsed.equipmentJson),
            typeof parsed.inventoryCapacity === "number" ? parsed.inventoryCapacity : undefined,
          );
        } else if (typeof parsed.inventoryCapacity === "number") {
          hudState = { ...hudState, inventoryCapacity: parsed.inventoryCapacity };
          handlers.onEquipment?.(hudState.equipment, parsed.inventoryCapacity);
        }
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
        const playerId = (typeof p.id === "string" && p.id) || id;
        onlinePlayers.push({
          id: playerId,
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
        handlers.reconcilePlayer(playerId, p.x, p.y);

        if (localPlayerId && (playerId === localPlayerId || id === localPlayerId)) {
          applyHudFromPlayerState(p);
        }
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
