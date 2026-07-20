// colyseus is CJS — default import avoids ESM named-export errors under NodeNext
import colyseus from "colyseus";
import type { Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

const { Room } = colyseus;
import jwt from "jsonwebtoken";
import { prisma, LedgerType } from "@skilling-mmo/db";
import {
  TICK_MS,
  WOODCUTTING,
  SKILLS,
  levelFromXp,
  type ClientMessage,
} from "@skilling-mmo/shared";
import { WoodcuttingHandler, type SkillContext, type SkillHandler } from "../skills/SkillHandler.js";
import { enqueueDirtyPlayer, flushDirtyPlayers } from "../persistence.js";
// TODO: PvPMatchmaker enqueue(playerId) via Redis list when combat is added

class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") action: string = "";
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
  private actions = new Map<string, ActiveAction>();
  private skillHandlers: SkillHandler[] = [new WoodcuttingHandler()];
  private playerSkills = new Map<string, Map<string, { level: number; xp: number }>>();
  private playerInventory = new Map<string, { slot: number; itemId: string | null; quantity: number }[]>();
  private playerCoins = new Map<string, number>();

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
    console.log(`[WorldRoom] created — tick ${TICK_MS}ms`);
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
    this.playerInventory.set(
      player.id,
      player.inventory.map((s) => ({ slot: s.slot, itemId: s.itemId, quantity: s.quantity })),
    );
    this.playerCoins.set(player.id, player.coins);

    client.send("StateSnapshot", {
      type: "StateSnapshot",
      players: [...this.state.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        action: p.action || null,
      })),
      resources: [...this.state.resources.values()].map((r) => ({
        id: r.id,
        kind: r.kind,
        x: r.x,
        y: r.y,
        available: r.available,
      })),
      you: {
        playerId: player.id,
        inventory: this.playerInventory.get(player.id)!,
        skills: [...skills.entries()].map(([skill, v]) => ({
          skill: skill as typeof SKILLS.WOODCUTTING,
          level: v.level,
          xp: v.xp,
        })),
        coins: player.coins,
      },
    });
  }

  async onLeave(client: Client) {
    const playerId = (client as any).playerId as string | undefined;
    if (!playerId) return;
    this.actions.delete(playerId);
    const ps = this.state.players.get(playerId);
    if (ps) {
      enqueueDirtyPlayer(playerId, {
        x: ps.x,
        y: ps.y,
        coins: this.playerCoins.get(playerId),
        inventory: this.playerInventory.get(playerId),
        skills: this.playerSkills.get(playerId),
      });
      await flushDirtyPlayers();
      this.state.players.delete(playerId);
    }
    this.playerSkills.delete(playerId);
    this.playerInventory.delete(playerId);
    this.playerCoins.delete(playerId);
  }

  onDispose() {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  private handleIntent(client: Client, msg: ClientMessage) {
    const playerId = (client as any).playerId as string;
    if (!playerId) return;
    const ps = this.state.players.get(playerId);
    if (!ps) return;

    if (msg.type === "Move") {
      ps.x = msg.x;
      ps.y = msg.y;
      this.actions.delete(playerId);
      ps.action = "";
      enqueueDirtyPlayer(playerId, { x: ps.x, y: ps.y });
      return;
    }

    if (msg.type === "CancelAction") {
      this.actions.delete(playerId);
      ps.action = "";
      client.send("ActionResult", { type: "ActionResult", ok: true, action: "cancel" });
      return;
    }

    if (msg.type === "InteractResource") {
      const handler = this.skillHandlers.find((h) => h.canHandle(msg.resourceId));
      if (!handler) {
        client.send("ActionResult", {
          type: "ActionResult",
          ok: false,
          reason: "unknown_resource",
        });
        return;
      }

      const ctx = this.buildCtx(playerId, ps);
      const start = handler.tryStart(ctx, msg.resourceId);
      if (!start.ok) {
        client.send("ActionResult", {
          type: "ActionResult",
          ok: false,
          reason: start.reason,
        });
        return;
      }

      this.actions.set(playerId, {
        kind: "woodcutting",
        resourceId: msg.resourceId,
        ticksDone: 0,
        ticksNeeded: start.ticksNeeded,
      });
      ps.action = "woodcutting";
      client.send("ActionResult", {
        type: "ActionResult",
        ok: true,
        action: "woodcutting",
      });
    }
  }

  private buildCtx(playerId: string, ps: PlayerState): SkillContext {
    return {
      playerId,
      x: ps.x,
      y: ps.y,
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

      const client = this.clients.find((c) => (c as any).playerId === playerId);
      if (client) {
        client.send("SkillUpdate", {
          type: "SkillUpdate",
          skill: result.skill,
          level: newLevel,
          xp: newXp,
        });
        client.send("InventoryUpdate", {
          type: "InventoryUpdate",
          slots: this.playerInventory.get(playerId)!,
        });
        client.send("ActionResult", {
          type: "ActionResult",
          ok: true,
          action: "woodcutting_complete",
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
    const inv = this.playerInventory.get(playerId);
    if (!inv) return;
    const stack = inv.find((s) => s.itemId === itemId);
    if (stack) {
      stack.quantity += qty;
      return;
    }
    const empty = inv.find((s) => !s.itemId || s.quantity === 0);
    if (empty) {
      empty.itemId = itemId;
      empty.quantity = qty;
    }
  }
}
