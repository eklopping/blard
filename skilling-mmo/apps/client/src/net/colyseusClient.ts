import { Client, Room } from "colyseus.js";
import type {
  ClientMessage,
  ServerMessage,
  InventorySlotDto,
  SkillProgressDto,
  ClassProgressDto,
  ChatMessageDto,
  PlayerSnapshot,
  SkillId,
  EquipmentLoadout,
} from "@skilling-mmo/shared";
import {
  SKILLS,
  INVENTORY_BASE_SLOTS,
  parseEquipmentJson,
  parseClassesJson,
  isZoneId,
  isClassId,
  type ClassId,
} from "@skilling-mmo/shared";
import type { ZoneId } from "@skilling-mmo/shared";

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
  classes: ClassProgressDto[];
  activeClass: ClassId | "";
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
  onClasses?: (classes: ClassProgressDto[]) => void;
  onActiveClass?: (classId: ClassId) => void;
  onCoins?: (coins: number) => void;
  onEquipment?: (equipment: EquipmentLoadout, capacity: number) => void;
  onAction: (msg: Extract<ServerMessage, { type: "ActionResult" }>) => void;
  onOpenPanel?: (panel: "shop" | "bank" | "travel") => void;
  onStatus: (status: string) => void;
  onChatMessage: (message: ChatMessageDto) => void;
  onChatError: (error: string) => void;
  getPredictedPos: () => { x: number; y: number };
  reconcilePlayer: (id: string, x: number, y: number, zone?: string) => void;
  removePlayer?: (id: string) => void;
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
    coins: typeof m.coins === "number" ? m.coins : undefined,
    zone: typeof m.zone === "string" && isZoneId(m.zone) ? (m.zone as ZoneId) : undefined,
    x: typeof m.x === "number" ? m.x : undefined,
    y: typeof m.y === "number" ? m.y : undefined,
    skill,
    classesJson: typeof m.classesJson === "string" ? m.classesJson : undefined,
    activeClass:
      typeof m.activeClass === "string" && isClassId(m.activeClass) ? m.activeClass : undefined,
    inventory: inventory ?? undefined,
  };
}

function playerIdOf(p: any, mapKey: string): string {
  return typeof p?.id === "string" && p.id ? p.id : mapKey;
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
  let posePollTimer: ReturnType<typeof setInterval> | null = null;
  let onlinePlayers: PlayerSnapshot[] = [];
  let localPlayerId = "";
  let hudState: HudLiveState = {
    skills: [],
    classes: [],
    activeClass: "",
    inventory: [],
    coins: 0,
    inventoryCapacity: INVENTORY_BASE_SLOTS,
    equipment: {},
  };
  /** Last inventoryJson string applied — skip redundant React updates. */
  let lastInventoryJson = "";
  let lastEquipmentJson = "";
  let lastClassesJson = "";

  function applySkill(s: SkillProgressDto) {
    const existing = hudState.skills.find((x) => x.skill === s.skill);
    if (existing && existing.level === s.level && existing.xp === s.xp) return;
    const rest = hudState.skills.filter((x) => x.skill !== s.skill);
    hudState = {
      ...hudState,
      skills: [...rest, { skill: s.skill, level: s.level, xp: s.xp }],
    };
    handlers.onSkill(s);
  }

  function applyClasses(classes: ClassProgressDto[], rawJson?: string) {
    if (rawJson != null && rawJson === lastClassesJson) return;
    if (rawJson != null) lastClassesJson = rawJson;
    hudState = { ...hudState, classes: classes.map((c) => ({ ...c })) };
    handlers.onClasses?.(hudState.classes);
  }

  function applyActiveClass(classId: string) {
    if (!isClassId(classId)) return;
    if (hudState.activeClass === classId) return;
    hudState = { ...hudState, activeClass: classId };
    handlers.onActiveClass?.(classId);
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
    const nextCap = capacity ?? hudState.inventoryCapacity;
    hudState = {
      ...hudState,
      equipment,
      inventoryCapacity: nextCap,
    };
    handlers.onEquipment?.(equipment, nextCap);
  }

  function applyLocalHudFields(p: any) {
    if (typeof p.woodcuttingLevel === "number" && typeof p.woodcuttingXp === "number") {
      applySkill({
        skill: SKILLS.WOODCUTTING,
        level: p.woodcuttingLevel,
        xp: p.woodcuttingXp,
      });
    }
    if (typeof p.miningLevel === "number" && typeof p.miningXp === "number") {
      applySkill({
        skill: SKILLS.MINING,
        level: p.miningLevel,
        xp: p.miningXp,
      });
    }
    if (typeof p.farmingLevel === "number" && typeof p.farmingXp === "number") {
      applySkill({
        skill: SKILLS.FARMING,
        level: p.farmingLevel,
        xp: p.farmingXp,
      });
    }
    if (typeof p.coins === "number") {
      applyCoins(p.coins);
    }
    if (typeof p.inventoryCapacity === "number" && p.inventoryCapacity !== hudState.inventoryCapacity) {
      hudState = { ...hudState, inventoryCapacity: p.inventoryCapacity };
    }
    if (typeof p.equipmentJson === "string" && p.equipmentJson !== lastEquipmentJson) {
      lastEquipmentJson = p.equipmentJson;
      applyEquipment(
        parseEquipmentJson(p.equipmentJson),
        typeof p.inventoryCapacity === "number" ? p.inventoryCapacity : undefined,
      );
    }
    if (typeof p.inventoryJson === "string" && p.inventoryJson !== lastInventoryJson) {
      lastInventoryJson = p.inventoryJson;
      const inv = parseInventoryJson(p.inventoryJson);
      if (inv) applyInventory(inv);
    }
    if (typeof p.classesJson === "string") {
      const parsed = parseClassesJson(p.classesJson);
      if (parsed) applyClasses(parsed, p.classesJson);
    }
    if (typeof p.activeClass === "string" && p.activeClass) {
      applyActiveClass(p.activeClass);
    }
  }

  function upsertOnlinePlayer(p: any, mapKey: string) {
    const id = playerIdOf(p, mapKey);
    const snap: PlayerSnapshot = {
      id,
      name: p.name,
      x: p.x,
      y: p.y,
      action: p.action || null,
      zone: typeof p.zone === "string" ? (p.zone as PlayerSnapshot["zone"]) : undefined,
      appearance: {
        hairColor: p.hairColor,
        skinColor: p.skinColor,
        shirtColor: p.shirtColor,
        pantsColor: p.pantsColor,
      },
    };
    const idx = onlinePlayers.findIndex((o) => o.id === id);
    if (idx >= 0) onlinePlayers[idx] = snap;
    else onlinePlayers.push(snap);
  }

  function removeOnlinePlayer(id: string) {
    onlinePlayers = onlinePlayers.filter((o) => o.id !== id);
  }

  function bindPlayer(p: any, mapKey: string) {
    const syncMotion = () => {
      const id = playerIdOf(p, mapKey);
      upsertOnlinePlayer(p, mapKey);
      handlers.reconcilePlayer(id, p.x, p.y, typeof p.zone === "string" ? p.zone : undefined);
    };

    // Immediate pose + list entry
    syncMotion();

    // Colyseus 0.15: prefer listen() for hot fields — onChange is unreliable for x/y streams
    p.listen("x", () => syncMotion());
    p.listen("y", () => syncMotion());
    p.listen("zone", () => syncMotion());
    p.listen("name", () => syncMotion());
    p.listen("action", () => syncMotion());
    p.listen("hairColor", () => syncMotion());
    p.listen("skinColor", () => syncMotion());
    p.listen("shirtColor", () => syncMotion());
    p.listen("pantsColor", () => syncMotion());

    // Local HUD fields only when those properties actually change
    const maybeHud = () => {
      const id = playerIdOf(p, mapKey);
      if (!localPlayerId || (id !== localPlayerId && mapKey !== localPlayerId)) return;
      applyLocalHudFields(p);
    };

    p.listen("woodcuttingLevel", () => maybeHud());
    p.listen("woodcuttingXp", () => maybeHud());
    p.listen("miningLevel", () => maybeHud());
    p.listen("miningXp", () => maybeHud());
    p.listen("farmingLevel", () => maybeHud());
    p.listen("farmingXp", () => maybeHud());
    p.listen("coins", () => maybeHud());
    p.listen("inventoryJson", () => maybeHud());
    p.listen("equipmentJson", () => maybeHud());
    p.listen("inventoryCapacity", () => maybeHud());
    p.listen("classesJson", () => maybeHud());
    p.listen("activeClass", () => maybeHud());
  }

  function wireStateCallbacks(r: Room) {
    const players = (r.state as any).players;
    if (!players?.onAdd) return;

    players.onAdd((p: any, mapKey: string) => {
      bindPlayer(p, mapKey);
    });

    players.onRemove((p: any, mapKey: string) => {
      const id = playerIdOf(p, mapKey);
      removeOnlinePlayer(id);
      handlers.removePlayer?.(id);
    });
  }

  async function join() {
    handlers.onStatus(reconnectAttempt ? `reconnecting (${reconnectAttempt})…` : "joining…");
    room = await client.joinOrCreate("world", { token });
    reconnectAttempt = 0;
    handlers.onStatus("connected");
    onlinePlayers = [];

    wireStateCallbacks(room);

    room.onMessage("StateSnapshot", (msg: Extract<ServerMessage, { type: "StateSnapshot" }>) => {
      localPlayerId = msg.you?.playerId ?? localPlayerId;
      lastInventoryJson = "";
      lastEquipmentJson = "";
      lastClassesJson = "";
      hudState = {
        skills: (msg.you?.skills ?? []).map((s) => ({ ...s })),
        classes: (msg.you?.classes ?? []).map((c) => ({ ...c })),
        activeClass:
          msg.you?.activeClass && isClassId(msg.you.activeClass) ? msg.you.activeClass : "",
        inventory: (msg.you?.inventory ?? []).map((s) => ({ ...s })),
        coins: msg.you?.coins ?? 0,
        inventoryCapacity: msg.you?.inventoryCapacity ?? INVENTORY_BASE_SLOTS,
        equipment: msg.you?.equipment ?? {},
      };
      if (msg.you?.classes) lastClassesJson = JSON.stringify(msg.you.classes);
      handlers.onSnapshot(msg);
      handlers.onEquipment?.(hudState.equipment, hudState.inventoryCapacity);
      if (hudState.classes.length) handlers.onClasses?.(hudState.classes);
      if (hudState.activeClass) handlers.onActiveClass?.(hudState.activeClass);

      // Snapshot may arrive after onAdd — refresh local HUD from live schema
      const players = (room?.state as any)?.players;
      players?.forEach?.((p: any, key: string) => {
        const id = playerIdOf(p, key);
        if (id === localPlayerId || key === localPlayerId) {
          applyLocalHudFields(p);
        }
        upsertOnlinePlayer(p, key);
        handlers.reconcilePlayer(id, p.x, p.y, typeof p.zone === "string" ? p.zone : undefined);
      });
    });

    room.onMessage("ActionResult", (msg: unknown) => {
      const parsed = parseActionResult(msg);
      const syncHudActions = new Set([
        "gather_complete",
        "woodcutting_complete",
        "item_drag",
        "shop_buy",
        "shop_sell",
        "sync_inventory",
        "set_active_class",
      ]);
      if (parsed.ok && parsed.action && syncHudActions.has(parsed.action)) {
        if (parsed.skill) applySkill(parsed.skill);
        if (typeof parsed.classesJson === "string") {
          const parsedClasses = parseClassesJson(parsed.classesJson);
          if (parsedClasses) applyClasses(parsedClasses, parsed.classesJson);
        }
        if (parsed.activeClass) applyActiveClass(parsed.activeClass);
        if (parsed.inventory) {
          lastInventoryJson = parsed.inventoryJson ?? lastInventoryJson;
          applyInventory(parsed.inventory);
        }
        if (typeof parsed.coins === "number") {
          applyCoins(parsed.coins);
        }
        if (typeof parsed.equipmentJson === "string") {
          lastEquipmentJson = parsed.equipmentJson;
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

    room.onMessage("OpenPanel", (msg: Extract<ServerMessage, { type: "OpenPanel" }>) => {
      if (msg?.panel) handlers.onOpenPanel?.(msg.panel);
    });

    room.onMessage("ChatMessage", (msg: Extract<ServerMessage, { type: "ChatMessage" }>) => {
      handlers.onChatMessage(msg.message);
    });
    room.onMessage("ChatError", (msg: Extract<ServerMessage, { type: "ChatError" }>) => {
      handlers.onChatError(msg.error);
    });

    room.onLeave((code) => {
      handlers.onStatus(`disconnected (${code})`);
      if (posePollTimer) {
        clearInterval(posePollTimer);
        posePollTimer = null;
      }
      room = null;
      if (!intentionalLeave) {
        scheduleReconnect();
      }
    });

    room.onError((code, message) => {
      handlers.onStatus(`error ${code}: ${message}`);
    });

    // Backup: force-reconcile poses each patch window in case a listen misses a tick
    if (posePollTimer) clearInterval(posePollTimer);
    posePollTimer = setInterval(() => {
      const players = (room?.state as any)?.players;
      if (!players?.forEach) return;
      players.forEach((p: any, key: string) => {
        const id = playerIdOf(p, key);
        upsertOnlinePlayer(p, key);
        handlers.reconcilePlayer(id, p.x, p.y, typeof p.zone === "string" ? p.zone : undefined);
      });
    }, 50);
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
      if (posePollTimer) {
        clearInterval(posePollTimer);
        posePollTimer = null;
      }
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
