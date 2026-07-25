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
  type ClientMessage,
  type ChatMessageDto,
  type EquipmentLoadout,
  type ItemLocation,
  SYSTEM_CHAT_SENDER_ID,
} from "@skilling-mmo/shared";
import { WoodcuttingHandler, type SkillContext, type SkillHandler } from "../skills/SkillHandler.js";
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
  @type("string") hairColor: string = "#1a1a1a";
  @type("string") skinColor: string = "#e899a3";
  @type("string") shirtColor: string = "#0f1e3d";
  @type("string") pantsColor: string = "#4b250a";
  /** Live HUD fields — synced via Colyseus state (same path as position). */
  @type("number") woodcuttingLevel: number = 1;
  @type("number") woodcuttingXp: number = 0;
  @type("number") coins: number = 0;
  @type("number") inventoryCapacity: number = 6;
  @type("string") inventoryJson: string = "[]";
  @type("string") equipmentJson: string = "{}";
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
  kind: "woodcutting";
  resourceId: string;
  ticksDone: number;
  ticksNeeded: number;
}

export class WorldRoom extends Room<WorldState> {
  maxClients = 64;
  private tickTimer?: ReturnType<typeof setInterval>;
  private moveTimer?: ReturnType<typeof setInterval>;
  private actions = new Map<string, ActiveAction>();
  private skillHandlers: SkillHandler[] = [new WoodcuttingHandler()];
  private playerSkills = new Map<string, Map<string, { level: number; xp: number }>>();
  private playerInventory = new Map<string, { slot: number; itemId: string | null; quantity: number }[]>();
  private playerCoins = new Map<string, number>();
  private playerTraits = new Map<string, string[]>();
  private playerEquipment = new Map<string, EquipmentLoadout>();
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

  /** Push in-memory skills/inventory/coins onto synced PlayerState for live HUD. */
  private syncHudState(playerId: string, ps?: PlayerState) {
    const player = ps ?? this.state.players.get(playerId);
    if (!player) return;
    const wc = this.playerSkills.get(playerId)?.get(SKILLS.WOODCUTTING) ?? { level: 1, xp: 0 };
    player.woodcuttingLevel = wc.level;
    player.woodcuttingXp = wc.xp;
    player.coins = this.playerCoins.get(playerId) ?? 0;
    const equipment = this.playerEquipment.get(playerId) ?? {};
    player.inventoryCapacity = inventoryCapacity(equipment);
    player.equipmentJson = serializeEquipment(equipment);
    player.inventoryJson = JSON.stringify(this.visibleInventory(playerId));
  }

  private snapshotPlayers() {
    return [...this.state.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      action: p.action || null,
      appearance: this.appearanceOf(p),
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

    const tree = new ResourceState();
    tree.id = WOODCUTTING.NORMAL_TREE.resourceId;
    tree.kind = "tree";
    tree.x = 320;
    tree.y = 240;
    tree.available = true;
    this.state.resources.set(tree.id, tree);

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
        inventory: { orderBy: { slot: "asc" } },
      },
    });

    const ps = new PlayerState();
    ps.id = player.id;
    ps.name = player.name;
    ps.x = player.x;
    ps.y = player.y;
    ps.action = "";
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
    if (!skills.has(SKILLS.WOODCUTTING)) {
      skills.set(SKILLS.WOODCUTTING, { level: 1, xp: 0 });
    }
    this.playerSkills.set(player.id, skills);
    this.playerInventory.set(player.id, padInventory(player.inventory));
    this.playerCoins.set(player.id, player.coins);
    this.playerTraits.set(player.id, player.traits ?? []);

    const equipment = parseEquipmentJson(player.equipmentJson);
    this.playerEquipment.set(player.id, equipment);
    this.syncHudState(player.id, ps);

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
      you: {
        playerId: player.id,
        inventory: this.visibleInventory(player.id),
        skills: [...skills.entries()].map(([skill, v]) => ({
          skill: skill as typeof SKILLS.WOODCUTTING,
          level: v.level,
          xp: v.xp,
        })),
        coins: player.coins,
        traits: player.traits,
        appearance: this.appearanceOf(ps),
        equipment,
        inventoryCapacity: inventoryCapacity(equipment),
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
        equipmentJson: serializeEquipment(this.playerEquipment.get(playerId) ?? {}),
      });
      await flushDirtyPlayers();
      this.state.players.delete(playerId);
    }
    this.playerSkills.delete(playerId);
    this.playerInventory.delete(playerId);
    this.playerCoins.delete(playerId);
    this.playerTraits.delete(playerId);
    this.playerEquipment.delete(playerId);
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

    if (msg.type === "ChatPublic" || msg.type === "ChatDm") {
      void this.handleChat(client, playerId, ps, msg);
      return;
    }

    if (msg.type === "ItemDrag") {
      this.handleItemDrag(client, playerId, ps, msg.from, msg.to);
    }
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

    const interactRange =
      resourceId === WOODCUTTING.NORMAL_TREE.resourceId
        ? WOODCUTTING.NORMAL_TREE.interactRange
        : 48;

    // Starting a new interact cancels any in-progress skill until arrival / in-range start
    this.actions.delete(playerId);
    ps.action = "";

    const result = this.movement.beginInteract(
      playerId,
      { x: ps.x, y: ps.y },
      resourceId,
      { x: resource.x, y: resource.y },
      interactRange,
    );

    if (result.inRange) {
      this.tryStartSkill(client, playerId, ps, resourceId);
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
      kind: "woodcutting",
      resourceId,
      ticksDone: 0,
      ticksNeeded: start.ticksNeeded,
    });
    ps.action = "woodcutting";
    client?.send("ActionResult", {
      type: "ActionResult",
      ok: true,
      action: "woodcutting",
      resourceId,
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
        this.tryStartSkill(client, playerId, ps, pendingInteract);
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
      const newXp = cur.xp + result.xp;
      const newLevel = levelFromXp(newXp);
      skills.set(result.skill, { level: newLevel, xp: newXp });

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
          action: "woodcutting_complete",
          resourceId: action.resourceId,
          skillId: skillUpdate.skill,
          skillLevel: skillUpdate.level,
          skillXp: skillUpdate.xp,
          inventoryJson: JSON.stringify(inventoryUpdate),
        });
      }

      enqueueDirtyPlayer(playerId, {
        inventory: this.playerInventory.get(playerId),
        skills,
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
