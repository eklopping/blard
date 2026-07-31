// colyseus is CJS — default import avoids ESM named-export errors under NodeNext
import colyseus from "colyseus";
import type { Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

const { Room } = colyseus;
import jwt from "jsonwebtoken";
import { prisma, LedgerType, ChatChannel } from "@skilling-mmo/db";
import {
  TICK_MS,
  MOVE_TICK_MS,
  WOODCUTTING,
  MINING,
  FARMING,
  SKILLS,
  INVENTORY_SIZE,
  maxStackFor,
  levelFromXp,
  CHAT_PUBLIC_RATE_MS,
  CHAT_DM_RATE_MS,
  validateChatBody,
  dmThreadKey,
  inventoryCapacity,
  parseEquipmentJson,
  serializeEquipment,
  ZONE_DEFS,
  ZONES,
  TOWN_SPAWN,
  TRAVEL_ZONES,
  NPC_KINDS,
  findNpc,
  isZoneId,
  zoneForResource,
  shopBuyPrice,
  shopSellPrice,
  ITEM_DEFS,
  CLASS_IDS,
  isClassId,
  emptyClassProgress,
  applySkillLevelUpsToClasses,
  unlockClassWithCatchUp,
  classesToDto,
  serializeClasses,
  starterClassForProfession,
  UNLOCK_ALL_CLASSES_FOR_TESTING,
  classStarterTool,
  toolMatchesClass,
  type ClientMessage,
  type ChatMessageDto,
  type EquipmentLoadout,
  type ItemLocation,
  type ZoneId,
  type NpcSnapshot,
  type ClassId,
  type ClassProgressState,
  type ProfessionId,
  type SkillId,
  SYSTEM_CHAT_SENDER_ID,
} from "@skilling-mmo/shared";
import {
  WoodcuttingHandler,
  MiningHandler,
  FarmingHandler,
  type SkillContext,
  type SkillHandler,
} from "../skills/SkillHandler.js";
import { enqueueDirtyPlayer, flushDirtyPlayers } from "../persistence.js";
import { ChatRateLimiter } from "../chat/rateLimit.js";
import { MovementController } from "../nav/movement.js";
import { applyItemDrag } from "../inventory/itemDrag.js";
// TODO: PvPMatchmaker enqueue(playerId) via Redis list when combat is added

class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") action: string = "";
  @type("string") zone: string = ZONES.TOWN;
  @type("string") hairColor: string = "#1a1a1a";
  @type("string") skinColor: string = "#e899a3";
  @type("string") shirtColor: string = "#0f1e3d";
  @type("string") pantsColor: string = "#4b250a";
  /** Live HUD fields — synced via Colyseus state (same path as position). */
  @type("number") woodcuttingLevel: number = 1;
  @type("number") woodcuttingXp: number = 0;
  @type("number") miningLevel: number = 1;
  @type("number") miningXp: number = 0;
  @type("number") farmingLevel: number = 1;
  @type("number") farmingXp: number = 0;
  @type("number") coins: number = 0;
  @type("number") inventoryCapacity: number = 6;
  @type("string") inventoryJson: string = "[]";
  @type("string") equipmentJson: string = "{}";
  /** JSON array of ClassProgressDto for live HUD */
  @type("string") classesJson: string = "[]";
  /** Currently selected class id */
  @type("string") activeClass: string = "";
}

class ResourceState extends Schema {
  @type("string") id: string = "";
  @type("string") kind: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("boolean") available: boolean = true;
}

class WorldState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: ResourceState }) resources = new MapSchema<ResourceState>();
}

interface SessionData {
  accountId: string;
  playerId: string;
  username: string;
}

interface ActiveAction {
  kind: "gather";
  resourceId: string;
  ticksDone: number;
  ticksNeeded: number;
}

export class WorldRoom extends Room<WorldState> {
  maxClients = 64;
  private tickTimer?: ReturnType<typeof setInterval>;
  private moveTimer?: ReturnType<typeof setInterval>;
  private actions = new Map<string, ActiveAction>();
  private skillHandlers: SkillHandler[] = [
    new WoodcuttingHandler(),
    new MiningHandler(),
    new FarmingHandler(),
  ];
  private playerSkills = new Map<string, Map<string, { level: number; xp: number }>>();
  private playerClasses = new Map<string, Map<ClassId, ClassProgressState>>();
  private playerActiveClass = new Map<string, ClassId>();
  private playerInventory = new Map<string, { slot: number; itemId: string | null; quantity: number }[]>();
  private playerCoins = new Map<string, number>();
  private playerTraits = new Map<string, string[]>();
  private playerEquipment = new Map<string, EquipmentLoadout>();
  private playerZone = new Map<string, ZoneId>();
  /** Throttle DB writes for x/y — Colyseus still syncs every move tick. */
  private lastPosPersistAt = new Map<string, number>();
  private chatLimiter = new ChatRateLimiter();
  private movement = new MovementController();

  private persistPosition(playerId: string, x: number, y: number, force = false) {
    const now = Date.now();
    const last = this.lastPosPersistAt.get(playerId) ?? 0;
    if (!force && now - last < 2000) return;
    this.lastPosPersistAt.set(playerId, now);
    enqueueDirtyPlayer(playerId, { x, y });
  }

  private appearanceOf(ps: PlayerState) {
    return {
      hairColor: ps.hairColor,
      skinColor: ps.skinColor,
      shirtColor: ps.shirtColor,
      pantsColor: ps.pantsColor,
    };
  }

  private capacityOf(playerId: string): number {
    return inventoryCapacity(this.playerEquipment.get(playerId));
  }

  private npcSnapshots(): NpcSnapshot[] {
    return Object.values(ZONE_DEFS).flatMap((zone) =>
      zone.npcs.map((n) => ({
        id: n.id,
        kind: n.kind,
        name: n.name,
        x: n.x,
        y: n.y,
        zoneId: zone.id,
      })),
    );
  }

  private interactRangeFor(resourceId: string): number {
    if (resourceId === WOODCUTTING.NORMAL_TREE.resourceId) return WOODCUTTING.NORMAL_TREE.interactRange;
    if (resourceId === MINING.STONE.resourceId) return MINING.STONE.interactRange;
    if (resourceId === FARMING.WHEAT.resourceId) return FARMING.WHEAT.interactRange;
    return 48;
  }

  /** Visible bag slots only (capacity-bounded). */
  private visibleInventory(playerId: string) {
    const inv = this.playerInventory.get(playerId) ?? [];
    const cap = this.capacityOf(playerId);
    return inv.filter((s) => s.slot < cap).map((s) => ({
      slot: s.slot,
      itemId: s.itemId,
      quantity: s.quantity,
    }));
  }

  /**
   * Load class rows (or seed defaults). Starter profession is unlocked;
   * unlocked classes with 0 XP get one-time catch-up from current skill levels
   * (covers characters that leveled before class progress existed).
   */
  private loadOrSeedClasses(
    _playerId: string,
    rows: { classId: string; level: number; xp: number; unlocked: boolean }[],
    profession: ProfessionId,
    skills: Map<string, { level: number; xp: number }>,
  ): Map<ClassId, ClassProgressState> {
    const classes = new Map<ClassId, ClassProgressState>();
    for (const classId of CLASS_IDS) {
      classes.set(classId, emptyClassProgress(false));
    }
    for (const row of rows) {
      if (!isClassId(row.classId)) continue;
      classes.set(row.classId, {
        level: row.level,
        xp: row.xp,
        unlocked: row.unlocked,
      });
    }

    const starter = starterClassForProfession(profession);
    if (!classes.get(starter)!.unlocked) {
      unlockClassWithCatchUp(classes, skills, starter);
    }

    // Testing: unlock every class so the HUD dropdown can switch freely
    if (UNLOCK_ALL_CLASSES_FOR_TESTING) {
      for (const classId of CLASS_IDS) {
        if (!classes.get(classId)!.unlocked) {
          unlockClassWithCatchUp(classes, skills, classId);
        }
      }
    }

    // One-time catch-up for unlocked classes still at 0 XP with leveled skills
    for (const classId of CLASS_IDS) {
      const row = classes.get(classId)!;
      if (!row.unlocked || row.xp > 0) continue;
      const temp = new Map<ClassId, ClassProgressState>([
        [classId, { level: 1, xp: 0, unlocked: false }],
      ]);
      unlockClassWithCatchUp(temp, skills, classId);
      const filled = temp.get(classId)!;
      row.xp = filled.xp;
      row.level = filled.level;
    }

    return classes;
  }

  private resolveActiveClass(
    stored: string | null | undefined,
    profession: ProfessionId,
    classes: Map<ClassId, ClassProgressState>,
  ): ClassId {
    if (stored && isClassId(stored) && classes.get(stored)?.unlocked) {
      return stored;
    }
    const starter = starterClassForProfession(profession);
    if (classes.get(starter)?.unlocked) return starter;
    const firstUnlocked = CLASS_IDS.find((id) => classes.get(id)?.unlocked);
    return firstUnlocked ?? starter;
  }

  /** Unlock a class and apply shared-skill catch-up XP (for future unlock flows). */
  unlockPlayerClass(playerId: string, classId: ClassId): boolean {
    const classes = this.playerClasses.get(playerId);
    const skills = this.playerSkills.get(playerId);
    if (!classes || !skills) return false;
    const before = classes.get(classId)?.unlocked ?? false;
    if (before) return false;
    unlockClassWithCatchUp(classes, skills, classId);
    const ps = this.state.players.get(playerId);
    this.syncHudState(playerId, ps);
    enqueueDirtyPlayer(playerId, { classes });
    return true;
  }

  private setActiveClass(playerId: string, classId: ClassId): boolean {
    const classes = this.playerClasses.get(playerId);
    if (!classes?.get(classId)?.unlocked) return false;
    this.playerActiveClass.set(playerId, classId);
    const ps = this.state.players.get(playerId);
    this.syncHudState(playerId, ps);
    enqueueDirtyPlayer(playerId, { activeClassId: classId });
    return true;
  }

  /** Push in-memory skills/inventory/coins onto synced PlayerState for live HUD. */
  private syncHudState(playerId: string, ps?: PlayerState) {
    const player = ps ?? this.state.players.get(playerId);
    if (!player) return;
    const wc = this.playerSkills.get(playerId)?.get(SKILLS.WOODCUTTING) ?? { level: 1, xp: 0 };
    const mn = this.playerSkills.get(playerId)?.get(SKILLS.MINING) ?? { level: 1, xp: 0 };
    const fm = this.playerSkills.get(playerId)?.get(SKILLS.FARMING) ?? { level: 1, xp: 0 };
    player.woodcuttingLevel = wc.level;
    player.woodcuttingXp = wc.xp;
    player.miningLevel = mn.level;
    player.miningXp = mn.xp;
    player.farmingLevel = fm.level;
    player.farmingXp = fm.xp;
    player.coins = this.playerCoins.get(playerId) ?? 0;
    player.zone = this.playerZone.get(playerId) ?? ZONES.TOWN;
    const equipment = this.playerEquipment.get(playerId) ?? {};
    player.inventoryCapacity = inventoryCapacity(equipment);
    player.equipmentJson = serializeEquipment(equipment);
    player.inventoryJson = JSON.stringify(this.visibleInventory(playerId));
    const classes = this.playerClasses.get(playerId);
    player.classesJson = classes ? serializeClasses(classes) : "[]";
    player.activeClass = this.playerActiveClass.get(playerId) ?? "";
  }

  private snapshotPlayers() {
    return [...this.state.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      action: p.action || null,
      appearance: this.appearanceOf(p),
      zone: (this.playerZone.get(p.id) ?? ZONES.TOWN) as ZoneId,
    }));
  }
  async onAuth(_client: Client, options: { token?: string }): Promise<SessionData> {
    const token = options?.token;
    if (!token) throw new Error("missing_token");
    const secret = process.env.JWT_SECRET ?? "dev-secret-change-me";
    try {
      const payload = jwt.verify(token, secret) as {
        sub: string;
        playerId: string;
        username: string;
      };
      return {
        accountId: payload.sub,
        playerId: payload.playerId,
        username: payload.username,
      };
    } catch {
      throw new Error("invalid_token");
    }
  }

  onCreate() {
    this.setState(new WorldState());
    // Broadcast position patches ~20 Hz (movement steps every 50ms)
    this.setPatchRate(50);

    for (const zone of Object.values(ZONE_DEFS)) {
      for (const res of zone.resources) {
        const rs = new ResourceState();
        rs.id = res.id;
        rs.kind = res.kind;
        rs.x = res.x;
        rs.y = res.y;
        rs.available = true;
        this.state.resources.set(rs.id, rs);
      }
    }

    this.onMessage("intent", (client, message: ClientMessage) => {
      this.handleIntent(client, message);
    });

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.moveTimer = setInterval(() => this.moveTick(), MOVE_TICK_MS);
    console.log(`[WorldRoom] created — skill tick ${TICK_MS}ms, move tick ${MOVE_TICK_MS}ms`);
  }

  async onJoin(client: Client, _options: unknown, auth?: SessionData) {
    if (!auth) {
      client.leave(4001);
      return;
    }

    const player = await prisma.player.findUniqueOrThrow({
      where: { id: auth.playerId },
      include: {
        skills: true,
        classes: true,
        inventory: { orderBy: { slot: "asc" } },
      },
    });

    const ps = new PlayerState();
    ps.id = player.id;
    ps.name = player.name;
    // Always enter the world in town (zone hub)
    ps.x = TOWN_SPAWN.x;
    ps.y = TOWN_SPAWN.y;
    ps.action = "";
    ps.zone = ZONES.TOWN;
    ps.hairColor = player.hairColor;
    ps.skinColor = player.skinColor;
    ps.shirtColor = player.shirtColor;
    ps.pantsColor = player.pantsColor;
    this.state.players.set(player.id, ps);
    (client as any).playerId = player.id;

    const skills = new Map<string, { level: number; xp: number }>();
    for (const s of player.skills) {
      skills.set(s.skill, { level: s.level, xp: s.xp });
    }
    let seededSkills = false;
    for (const skill of Object.values(SKILLS)) {
      if (!skills.has(skill)) {
        skills.set(skill, { level: 1, xp: 0 });
        seededSkills = true;
      }
    }
    this.playerSkills.set(player.id, skills);

    const profession = player.profession.toLowerCase() as ProfessionId;
    const classes = this.loadOrSeedClasses(player.id, player.classes, profession, skills);
    this.playerClasses.set(player.id, classes);
    const activeClass = this.resolveActiveClass(
      player.activeClassId,
      profession,
      classes,
    );
    this.playerActiveClass.set(player.id, activeClass);

    this.playerInventory.set(player.id, padInventory(player.inventory));
    this.playerCoins.set(player.id, player.coins);
    this.playerTraits.set(player.id, player.traits ?? []);
    this.playerZone.set(player.id, ZONES.TOWN);

    const equipment = parseEquipmentJson(player.equipmentJson);
    this.playerEquipment.set(player.id, equipment);
    this.syncHudState(player.id, ps);

    if (Math.abs(player.x - TOWN_SPAWN.x) > 1 || Math.abs(player.y - TOWN_SPAWN.y) > 1) {
      enqueueDirtyPlayer(player.id, { x: ps.x, y: ps.y });
    }

    // Persist class catch-up / seed / active class if anything changed vs DB
    enqueueDirtyPlayer(player.id, {
      classes,
      activeClassId: activeClass,
      ...(seededSkills ? { skills } : {}),
    });

    client.send("StateSnapshot", {
      type: "StateSnapshot",
      players: this.snapshotPlayers(),
      resources: [...this.state.resources.values()].map((r) => ({
        id: r.id,
        kind: r.kind,
        x: r.x,
        y: r.y,
        available: r.available,
      })),
      npcs: this.npcSnapshots(),
      you: {
        playerId: player.id,
        inventory: this.visibleInventory(player.id),
        skills: [...skills.entries()].map(([skill, v]) => ({
          skill: skill as SkillId,
          level: v.level,
          xp: v.xp,
        })),
        classes: classesToDto(classes),
        activeClass,
        coins: player.coins,
        profession,
        traits: player.traits,
        appearance: this.appearanceOf(ps),
        equipment,
        inventoryCapacity: inventoryCapacity(equipment),
        zone: ZONES.TOWN,
      },
    });

    // Ephemeral system notice — broadcast only, never written to chat history
    const loginNotice: ChatMessageDto = {
      id: `sys_login_${player.id}_${Date.now()}`,
      channel: "PUBLIC",
      senderId: SYSTEM_CHAT_SENDER_ID,
      senderName: "System",
      recipientId: null,
      threadKey: null,
      body: `${player.name} has logged in.`,
      createdAt: new Date().toISOString(),
    };
    this.broadcast("ChatMessage", { type: "ChatMessage", message: loginNotice });
  }

  async onLeave(client: Client) {
    const playerId = (client as any).playerId as string | undefined;
    if (!playerId) return;
    this.actions.delete(playerId);
    this.movement.clear(playerId);
    const ps = this.state.players.get(playerId);
    if (ps) {
      enqueueDirtyPlayer(playerId, {
        x: ps.x,
        y: ps.y,
        coins: this.playerCoins.get(playerId),
        inventory: this.playerInventory.get(playerId),
        skills: this.playerSkills.get(playerId),
        classes: this.playerClasses.get(playerId),
        activeClassId: this.playerActiveClass.get(playerId),
        equipmentJson: serializeEquipment(this.playerEquipment.get(playerId) ?? {}),
      });
      // Remove from live state first so other clients drop the sprite immediately
      this.state.players.delete(playerId);
      await flushDirtyPlayers();
    }
    this.playerSkills.delete(playerId);
    this.playerClasses.delete(playerId);
    this.playerActiveClass.delete(playerId);
    this.playerInventory.delete(playerId);
    this.playerCoins.delete(playerId);
    this.playerTraits.delete(playerId);
    this.playerEquipment.delete(playerId);
    this.playerZone.delete(playerId);
    this.lastPosPersistAt.delete(playerId);
    this.chatLimiter.clear(playerId);
  }

  onDispose() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.moveTimer) clearInterval(this.moveTimer);
  }

  private handleIntent(client: Client, msg: ClientMessage) {
    const playerId = (client as any).playerId as string;
    if (!playerId) return;
    const ps = this.state.players.get(playerId);
    if (!ps) return;

    if (msg.type === "Move") {
      const target = this.movement.setMoveTarget(playerId, msg.x, msg.y);
      if (!target) return;
      this.actions.delete(playerId);
      ps.action = "";
      return;
    }

    if (msg.type === "CancelAction") {
      this.actions.delete(playerId);
      ps.action = "";
      this.movement.cancelMovement(playerId);
      client.send("ActionResult", { type: "ActionResult", ok: true, action: "cancel" });
      return;
    }

    if (msg.type === "InteractResource") {
      this.handleInteractResource(client, playerId, ps, msg.resourceId);
      return;
    }

    if (msg.type === "InteractNpc") {
      this.handleInteractNpc(client, playerId, ps, msg.npcId);
      return;
    }

    if (msg.type === "TravelZone") {
      this.handleTravelZone(client, playerId, ps, msg.zone);
      return;
    }

    if (msg.type === "ShopBuy") {
      this.handleShopBuy(client, playerId, ps, msg.itemId, msg.quantity ?? 1);
      return;
    }

    if (msg.type === "ShopSell") {
      this.handleShopSell(client, playerId, ps, msg.itemId, msg.quantity);
      return;
    }

    if (msg.type === "SyncInventory") {
      void this.handleSyncInventory(client, playerId, ps);
      return;
    }

    if (msg.type === "ChatPublic" || msg.type === "ChatDm") {
      void this.handleChat(client, playerId, ps, msg);
      return;
    }

    if (msg.type === "ItemDrag") {
      this.handleItemDrag(client, playerId, ps, msg.from, msg.to);
      return;
    }

    if (msg.type === "SetActiveClass") {
      this.handleSetActiveClass(client, playerId, msg.classId);
    }
  }

  private handleSetActiveClass(client: Client, playerId: string, classId: string) {
    if (!isClassId(classId)) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "unknown_class",
        action: "set_active_class",
      });
      return;
    }
    const ok = this.setActiveClass(playerId, classId);
    if (!ok) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        action: "set_active_class",
        reason: "class_locked",
      });
      return;
    }

    // Equip the class's gather tool into the primary slot
    this.equipToolForClass(playerId, classId);
    const ps = this.state.players.get(playerId);
    this.syncHudState(playerId, ps);

    client.send("ActionResult", {
      type: "ActionResult",
      ok: true,
      action: "set_active_class",
      activeClass: classId,
      classesJson: serializeClasses(this.playerClasses.get(playerId) ?? new Map()),
      inventoryJson: JSON.stringify(this.visibleInventory(playerId)),
      equipmentJson: serializeEquipment(this.playerEquipment.get(playerId) ?? {}),
      inventoryCapacity: this.capacityOf(playerId),
    });
  }

  /**
   * Put the active class's tool in the primary hand.
   * Swaps with inventory if the player already has it; grants the basic tool if missing.
   */
  private equipToolForClass(playerId: string, classId: ClassId) {
    let inv = this.playerInventory.get(playerId);
    let equipment = this.playerEquipment.get(playerId);
    if (!inv || !equipment) return;

    inv = padInventory(inv);
    equipment = { ...equipment };

    if (toolMatchesClass(equipment.primary?.itemId, classId)) {
      this.playerInventory.set(playerId, inv);
      this.playerEquipment.set(playerId, equipment);
      return;
    }

    const preferred = classStarterTool(classId);
    let toolSlot = inv.find((s) => s.itemId === preferred && s.quantity > 0);
    if (!toolSlot) {
      toolSlot = inv.find(
        (s) => !!s.itemId && s.quantity > 0 && toolMatchesClass(s.itemId, classId),
      );
    }

    // No tool in bag — grant the basic class tool for testing / new unlocks
    if (!toolSlot) {
      const empty = inv.find((s) => s.slot < this.capacityOf(playerId) && (!s.itemId || s.quantity <= 0));
      if (empty) {
        empty.itemId = preferred;
        empty.quantity = 1;
        toolSlot = empty;
      } else {
        // Bag full: still switch class, leave equipment alone
        this.playerInventory.set(playerId, inv);
        this.playerEquipment.set(playerId, equipment);
        enqueueDirtyPlayer(playerId, {
          inventory: inv,
          equipmentJson: serializeEquipment(equipment),
        });
        return;
      }
    }

    const prevPrimary = equipment.primary
      ? { itemId: equipment.primary.itemId, quantity: equipment.primary.quantity }
      : null;

    equipment.primary = { itemId: toolSlot.itemId!, quantity: 1 };
    if (prevPrimary) {
      toolSlot.itemId = prevPrimary.itemId;
      toolSlot.quantity = prevPrimary.quantity;
    } else {
      toolSlot.itemId = null;
      toolSlot.quantity = 0;
    }

    this.playerInventory.set(playerId, inv);
    this.playerEquipment.set(playerId, equipment);
    enqueueDirtyPlayer(playerId, {
      inventory: inv,
      equipmentJson: serializeEquipment(equipment),
      activeClassId: classId,
    });
  }

  private handleItemDrag(
    client: Client,
    playerId: string,
    ps: PlayerState,
    from: ItemLocation,
    to: ItemLocation,
  ) {
    const inv = this.playerInventory.get(playerId);
    const equipment = this.playerEquipment.get(playerId);
    if (!inv || !equipment) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "not_ready",
        action: "item_drag",
      });
      return;
    }

    const result = applyItemDrag(inv, equipment, from, to);
    if (!result.ok) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: result.reason,
        action: "item_drag",
      });
      return;
    }

    this.playerInventory.set(playerId, result.inventory);
    this.playerEquipment.set(playerId, result.equipment);
    this.syncHudState(playerId, ps);
    enqueueDirtyPlayer(playerId, {
      inventory: result.inventory,
      equipmentJson: serializeEquipment(result.equipment),
    });
    client.send("ActionResult", {
      type: "ActionResult",
      ok: true,
      action: "item_drag",
      inventoryJson: JSON.stringify(this.visibleInventory(playerId)),
      equipmentJson: serializeEquipment(result.equipment),
      inventoryCapacity: inventoryCapacity(result.equipment),
    });
  }

  private handleInteractResource(
    client: Client,
    playerId: string,
    ps: PlayerState,
    resourceId: string,
  ) {
    const handler = this.skillHandlers.find((h) => h.canHandle(resourceId));
    if (!handler) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "unknown_resource",
      });
      return;
    }

    const resource = this.state.resources.get(resourceId);
    if (!resource) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "unknown_resource",
      });
      return;
    }

    const resZone = zoneForResource(resourceId);
    const playerZone = this.playerZone.get(playerId) ?? ZONES.TOWN;
    if (resZone && resZone !== playerZone) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "wrong_zone",
      });
      return;
    }

    // Starting a new interact cancels any in-progress skill until arrival / in-range start
    this.actions.delete(playerId);
    ps.action = "";

    const result = this.movement.beginInteract(
      playerId,
      { x: ps.x, y: ps.y },
      resourceId,
      { x: resource.x, y: resource.y },
      this.interactRangeFor(resourceId),
    );

    if (result.inRange) {
      this.tryStartSkill(client, playerId, ps, resourceId);
    }
  }

  private handleInteractNpc(
    client: Client,
    playerId: string,
    ps: PlayerState,
    npcId: string,
  ) {
    const npc = findNpc(npcId);
    if (!npc) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "unknown_npc",
      });
      return;
    }

    const playerZone = this.playerZone.get(playerId) ?? ZONES.TOWN;
    if (npc.zoneId !== playerZone) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "wrong_zone",
      });
      return;
    }

    this.actions.delete(playerId);
    ps.action = "";

    // Already close enough — open immediately (don't require exact side-stand)
    const dist = Math.hypot(ps.x - npc.x, ps.y - npc.y);
    if (dist <= npc.interactRange) {
      this.resolveNpcInteract(client, playerId, ps, npcId);
      return;
    }

    const result = this.movement.beginInteract(
      playerId,
      { x: ps.x, y: ps.y },
      npcId,
      { x: npc.x, y: npc.y },
      npc.interactRange,
    );

    if (result.inRange) {
      this.resolveNpcInteract(client, playerId, ps, npcId);
    }
  }

  private resolveNpcInteract(
    client: Client | undefined,
    playerId: string,
    ps: PlayerState,
    npcId: string,
  ) {
    const npc = findNpc(npcId);
    if (!npc || !client) return;

    const playerZone = this.playerZone.get(playerId) ?? ZONES.TOWN;
    if (npc.zoneId !== playerZone) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "wrong_zone",
      });
      return;
    }

    const dist = Math.hypot(ps.x - npc.x, ps.y - npc.y);
    if (dist > npc.interactRange + 8) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "too_far",
      });
      return;
    }

    this.movement.cancelMovement(playerId);

    if (npc.kind === NPC_KINDS.SHOPKEEPER) {
      client.send("OpenPanel", { type: "OpenPanel", panel: "shop" });
      return;
    }
    if (npc.kind === NPC_KINDS.STOREHOUSE) {
      client.send("OpenPanel", { type: "OpenPanel", panel: "bank" });
      return;
    }
    if (npc.kind === NPC_KINDS.EXIT) {
      client.send("OpenPanel", { type: "OpenPanel", panel: "travel" });
      return;
    }
    if (npc.kind === NPC_KINDS.RETURN) {
      this.teleportToZone(client, playerId, ps, ZONES.TOWN);
    }
  }

  private handleTravelZone(
    client: Client,
    playerId: string,
    ps: PlayerState,
    zone: string,
  ) {
    if (!isZoneId(zone)) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "unknown_zone",
      });
      return;
    }

    const current = this.playerZone.get(playerId) ?? ZONES.TOWN;

    if (zone === ZONES.TOWN) {
      if (current === ZONES.TOWN) {
        client.send("ActionResult", {
          type: "ActionResult",
          ok: false,
          reason: "already_there",
        });
        return;
      }
      this.teleportToZone(client, playerId, ps, ZONES.TOWN);
      return;
    }

    if (!TRAVEL_ZONES.includes(zone)) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "unknown_zone",
      });
      return;
    }

    if (current !== ZONES.TOWN) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "must_be_in_town",
      });
      return;
    }

    this.teleportToZone(client, playerId, ps, zone);
  }

  private teleportToZone(
    client: Client,
    playerId: string,
    ps: PlayerState,
    zone: ZoneId,
  ) {
    const def = ZONE_DEFS[zone];
    this.actions.delete(playerId);
    this.movement.cancelMovement(playerId);
    ps.action = "";
    ps.x = def.spawn.x;
    ps.y = def.spawn.y;
    this.playerZone.set(playerId, zone);
    ps.zone = zone;
    this.persistPosition(playerId, ps.x, ps.y, true);
    this.syncHudState(playerId, ps);

    client.send("ActionResult", {
      type: "ActionResult",
      ok: true,
      action: "travel",
      zone,
      x: def.spawn.x,
      y: def.spawn.y,
    });
  }

  private handleShopBuy(
    client: Client,
    playerId: string,
    ps: PlayerState,
    itemId: string,
    quantity: number,
  ) {
    if ((this.playerZone.get(playerId) ?? ZONES.TOWN) !== ZONES.TOWN) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "wrong_zone",
      });
      return;
    }

    const unitPrice = shopBuyPrice(itemId);
    if (unitPrice == null || !ITEM_DEFS[itemId]) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "not_for_sale",
      });
      return;
    }

    const qty = Math.max(1, Math.min(99, Math.floor(quantity)));
    const total = unitPrice * qty;
    const coins = this.playerCoins.get(playerId) ?? 0;
    if (coins < total) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "not_enough_coins",
      });
      return;
    }

    this.playerCoins.set(playerId, coins - total);
    this.addItem(playerId, itemId, qty);
    this.syncHudState(playerId, ps);

    client.send("ActionResult", {
      type: "ActionResult",
      ok: true,
      action: "shop_buy",
      inventoryJson: JSON.stringify(this.visibleInventory(playerId)),
      coins: this.playerCoins.get(playerId) ?? 0,
    });

    enqueueDirtyPlayer(playerId, {
      inventory: this.playerInventory.get(playerId),
      coins: this.playerCoins.get(playerId),
      ledger: {
        type: LedgerType.TRADE,
        itemId,
        deltaQty: qty,
        meta: { shop: "buy", price: total },
      },
    });
  }

  private handleShopSell(
    client: Client,
    playerId: string,
    ps: PlayerState,
    itemId: string,
    quantity: number,
  ) {
    if ((this.playerZone.get(playerId) ?? ZONES.TOWN) !== ZONES.TOWN) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "wrong_zone",
      });
      return;
    }

    const unitPrice = shopSellPrice(itemId);
    if (unitPrice == null) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "not_buyable",
      });
      return;
    }

    const qty = Math.max(1, Math.floor(quantity));
    if (!this.removeItem(playerId, itemId, qty)) {
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "not_enough_items",
      });
      return;
    }

    const earned = unitPrice * qty;
    const coins = (this.playerCoins.get(playerId) ?? 0) + earned;
    this.playerCoins.set(playerId, coins);
    this.syncHudState(playerId, ps);

    client.send("ActionResult", {
      type: "ActionResult",
      ok: true,
      action: "shop_sell",
      inventoryJson: JSON.stringify(this.visibleInventory(playerId)),
      coins,
    });

    enqueueDirtyPlayer(playerId, {
      inventory: this.playerInventory.get(playerId),
      coins,
      ledger: {
        type: LedgerType.TRADE,
        itemId,
        deltaQty: -qty,
        meta: { shop: "sell", price: earned },
      },
    });
  }

  private async handleSyncInventory(
    client: Client,
    playerId: string,
    ps: PlayerState,
  ) {
    try {
      const player = await prisma.player.findUniqueOrThrow({
        where: { id: playerId },
        include: { inventory: { orderBy: { slot: "asc" } } },
      });
      this.playerInventory.set(playerId, padInventory(player.inventory));
      this.playerCoins.set(playerId, player.coins);
      this.syncHudState(playerId, ps);
      client.send("ActionResult", {
        type: "ActionResult",
        ok: true,
        action: "sync_inventory",
        inventoryJson: JSON.stringify(this.visibleInventory(playerId)),
        coins: player.coins,
      });
    } catch (err) {
      console.error("[WorldRoom] SyncInventory failed", err);
      client.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "sync_failed",
      });
    }
  }

  private tryStartSkill(
    client: Client | undefined,
    playerId: string,
    ps: PlayerState,
    resourceId: string,
  ) {
    const handler = this.skillHandlers.find((h) => h.canHandle(resourceId));
    if (!handler) {
      client?.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: "unknown_resource",
        resourceId,
      });
      return;
    }

    // Lock in place for the duration of the action (already at side stand from walk)
    this.movement.cancelMovement(playerId);

    const ctx = this.buildCtx(playerId, ps);
    const start = handler.tryStart(ctx, resourceId);
    if (!start.ok) {
      client?.send("ActionResult", {
        type: "ActionResult",
        ok: false,
        reason: start.reason,
        resourceId,
      });
      return;
    }

    this.actions.set(playerId, {
      kind: "gather",
      resourceId,
      ticksDone: 0,
      ticksNeeded: start.ticksNeeded,
    });
    ps.action = "gather";
    client?.send("ActionResult", {
      type: "ActionResult",
      ok: true,
      action: "gather",
      resourceId,
      // Authoritative stand pose beside the resource (client must not use a stale pose)
      x: ps.x,
      y: ps.y,
    });
  }

  private moveTick() {
    this.movement.tick(
      (playerId) => {
        // Stay locked while performing a skill action
        if (this.actions.has(playerId)) return undefined;
        const ps = this.state.players.get(playerId);
        return ps ? { x: ps.x, y: ps.y } : undefined;
      },
      (playerId, pos) => {
        if (this.actions.has(playerId)) return;
        const ps = this.state.players.get(playerId);
        if (!ps) return;
        ps.x = pos.x;
        ps.y = pos.y;
        this.persistPosition(playerId, ps.x, ps.y);
      },
      (playerId, pos, pendingInteract) => {
        if (this.actions.has(playerId)) return;
        const ps = this.state.players.get(playerId);
        if (!ps) return;
        ps.x = pos.x;
        ps.y = pos.y;
        this.persistPosition(playerId, ps.x, ps.y, true);
        if (!pendingInteract) return;
        const client = this.findClientByPlayerId(playerId);
        if (findNpc(pendingInteract)) {
          this.resolveNpcInteract(client, playerId, ps, pendingInteract);
        } else {
          const resource = this.state.resources.get(pendingInteract);
          if (!resource) return;
          const range = this.interactRangeFor(pendingInteract);
          const dist = Math.hypot(ps.x - resource.x, ps.y - resource.y);
          if (!Number.isFinite(dist) || dist > range + 8) {
            client?.send("ActionResult", {
              type: "ActionResult",
              ok: false,
              reason: "too_far",
              resourceId: pendingInteract,
            });
            return;
          }
          this.tryStartSkill(client, playerId, ps, pendingInteract);
        }
      },
    );
  }

  private findClientByPlayerId(playerId: string): Client | undefined {
    return this.clients.find((c) => (c as any).playerId === playerId);
  }

  private async handleChat(
    client: Client,
    playerId: string,
    ps: PlayerState,
    msg: ClientMessage & { type: "ChatPublic" | "ChatDm" },
  ) {
    const isDm = msg.type === "ChatDm";
    if (!this.chatLimiter.allow(playerId, isDm ? "dm" : "public", isDm ? CHAT_DM_RATE_MS : CHAT_PUBLIC_RATE_MS)) {
      client.send("ChatError", { type: "ChatError", error: "rate_limited" });
      return;
    }

    const validated = validateChatBody(msg.body);
    if (!validated.ok) {
      client.send("ChatError", { type: "ChatError", error: validated.error });
      return;
    }

    if (msg.type === "ChatPublic") {
      try {
        const row = await prisma.chatMessage.create({
          data: {
            channel: ChatChannel.PUBLIC,
            senderId: playerId,
            senderName: ps.name,
            body: validated.body,
          },
        });
        const message: ChatMessageDto = {
          id: row.id,
          channel: row.channel,
          senderId: row.senderId,
          senderName: row.senderName,
          recipientId: row.recipientId,
          threadKey: row.threadKey,
          body: row.body,
          createdAt: row.createdAt.toISOString(),
        };
        this.broadcast("ChatMessage", { type: "ChatMessage", message });
      } catch (err) {
        console.error("[WorldRoom] chat public failed", err);
        client.send("ChatError", { type: "ChatError", error: "server_error" });
      }
      return;
    }

    // ChatDm
    const recipientId = msg.recipientId;
    if (recipientId === playerId) {
      client.send("ChatError", { type: "ChatError", error: "dm_self" });
      return;
    }

    try {
      const recipient = await prisma.player.findUnique({ where: { id: recipientId } });
      if (!recipient) {
        client.send("ChatError", { type: "ChatError", error: "unknown_recipient" });
        return;
      }

      const threadKey = dmThreadKey(playerId, recipientId);
      const row = await prisma.chatMessage.create({
        data: {
          channel: ChatChannel.DIRECT,
          senderId: playerId,
          senderName: ps.name,
          recipientId,
          threadKey,
          body: validated.body,
        },
      });
      const message: ChatMessageDto = {
        id: row.id,
        channel: row.channel,
        senderId: row.senderId,
        senderName: row.senderName,
        recipientId: row.recipientId,
        threadKey: row.threadKey,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      };
      client.send("ChatMessage", { type: "ChatMessage", message });
      const recipientClient = this.findClientByPlayerId(recipientId);
      if (recipientClient) {
        recipientClient.send("ChatMessage", { type: "ChatMessage", message });
      }
    } catch (err) {
      console.error("[WorldRoom] chat dm failed", err);
      client.send("ChatError", { type: "ChatError", error: "server_error" });
    }
  }

  private buildCtx(playerId: string, ps: PlayerState): SkillContext {
    return {
      playerId,
      x: ps.x,
      y: ps.y,
      traits: this.playerTraits.get(playerId) ?? [],
      equipment: this.playerEquipment.get(playerId) ?? {},
      getSkill: (skill) => this.playerSkills.get(playerId)?.get(skill) ?? { level: 1, xp: 0 },
      getResource: (id) => {
        const r = this.state.resources.get(id);
        return r
          ? { id: r.id, kind: r.kind, x: r.x, y: r.y, available: r.available }
          : undefined;
      },
    };
  }

  private tick() {
    for (const [playerId, action] of this.actions) {
      const ps = this.state.players.get(playerId);
      if (!ps) {
        this.actions.delete(playerId);
        continue;
      }

      action.ticksDone += 1;
      if (action.ticksDone < action.ticksNeeded) continue;

      const handler = this.skillHandlers.find((h) => h.canHandle(action.resourceId));
      if (!handler) {
        this.actions.delete(playerId);
        ps.action = "";
        continue;
      }

      const ctx = this.buildCtx(playerId, ps);
      const result = handler.complete(ctx, action.resourceId);
      this.actions.delete(playerId);
      ps.action = "";

      if (!result.ok) continue;

      // Grant XP + items (server authoritative)
      const skills = this.playerSkills.get(playerId)!;
      const cur = skills.get(result.skill) ?? { level: 1, xp: 0 };
      const oldLevel = cur.level;
      const newXp = cur.xp + result.xp;
      const newLevel = levelFromXp(newXp);
      skills.set(result.skill, { level: newLevel, xp: newXp });

      const classes = this.playerClasses.get(playerId);
      if (classes && newLevel > oldLevel) {
        applySkillLevelUpsToClasses(classes, result.skill, oldLevel, newLevel);
      }

      this.addItem(playerId, result.itemId, result.itemQty);
      this.syncHudState(playerId, ps);

      const skillUpdate = {
        skill: result.skill,
        level: newLevel,
        xp: newXp,
      };
      const inventoryUpdate = this.visibleInventory(playerId);

      const client = this.clients.find((c) => (c as any).playerId === playerId);
      if (client) {
        // Flat primitives only — nested objects have been unreliable over Colyseus messages
        client.send("ActionResult", {
          type: "ActionResult",
          ok: true,
          action: "gather_complete",
          resourceId: action.resourceId,
          skillId: skillUpdate.skill,
          skillLevel: skillUpdate.level,
          skillXp: skillUpdate.xp,
          classesJson: classes ? serializeClasses(classes) : undefined,
          inventoryJson: JSON.stringify(inventoryUpdate),
        });
      }

      enqueueDirtyPlayer(playerId, {
        inventory: this.playerInventory.get(playerId),
        skills,
        classes,
        ledger: {
          type: LedgerType.SKILL_REWARD,
          itemId: result.itemId,
          deltaQty: result.itemQty,
          meta: { skill: result.skill, xp: result.xp },
        },
      });
    }

    // Persist dirty players periodically (not every tick for position-only)
    void flushDirtyPlayers();
  }

  private addItem(playerId: string, itemId: string, qty: number) {
    let inv = this.playerInventory.get(playerId);
    if (!inv) {
      inv = padInventory([]);
      this.playerInventory.set(playerId, inv);
    } else if (inv.length < INVENTORY_SIZE) {
      inv = padInventory(inv);
      this.playerInventory.set(playerId, inv);
    }

    const maxStack = maxStackFor(itemId);
    const capacity = this.capacityOf(playerId);
    let remaining = qty;

    while (remaining > 0) {
      const stack = inv.find(
        (s) =>
          s.slot < capacity && s.itemId === itemId && s.quantity > 0 && s.quantity < maxStack,
      );
      if (stack) {
        const space = maxStack - stack.quantity;
        const add = Math.min(space, remaining);
        stack.quantity += add;
        remaining -= add;
        continue;
      }
      const empty = inv.find((s) => s.slot < capacity && (!s.itemId || s.quantity === 0));
      if (!empty) return; // inventory full — drop remainder
      const add = Math.min(maxStack, remaining);
      empty.itemId = itemId;
      empty.quantity = add;
      remaining -= add;
    }
  }

  /** Remove qty of itemId from visible inventory. Returns false if not enough. */
  private removeItem(playerId: string, itemId: string, qty: number): boolean {
    const inv = this.playerInventory.get(playerId);
    if (!inv) return false;
    const capacity = this.capacityOf(playerId);
    let have = 0;
    for (const s of inv) {
      if (s.slot < capacity && s.itemId === itemId) have += s.quantity;
    }
    if (have < qty) return false;

    let remaining = qty;
    for (const s of inv) {
      if (remaining <= 0) break;
      if (s.slot >= capacity || s.itemId !== itemId || s.quantity <= 0) continue;
      const take = Math.min(s.quantity, remaining);
      s.quantity -= take;
      remaining -= take;
      if (s.quantity <= 0) {
        s.itemId = null;
        s.quantity = 0;
      }
    }
    return true;
  }
}

function padInventory(
  slots: { slot: number; itemId: string | null; quantity: number }[],
): { slot: number; itemId: string | null; quantity: number }[] {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  return Array.from({ length: INVENTORY_SIZE }, (_, slot) => {
    const existing = bySlot.get(slot);
    return existing
      ? { slot, itemId: existing.itemId, quantity: existing.quantity }
      : { slot, itemId: null, quantity: 0 };
  });
}
