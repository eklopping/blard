import {
  GATHER_NODES,
  applyActionSpeedTicks,
  applyXpGain,
  applyOutputQty,
  toolBonusForSkill,
  type EquipmentLoadout,
  type GatherNodeDef,
  type SkillId,
} from "@skilling-mmo/shared";

export interface SkillContext {
  playerId: string;
  x: number;
  y: number;
  traits: string[];
  equipment: EquipmentLoadout;
  getSkill: (skill: SkillId) => { level: number; xp: number };
  getResource: (id: string) =>
    | { id: string; kind: string; x: number; y: number; available: boolean }
    | undefined;
}

export interface StartResult {
  ok: boolean;
  reason?: string;
  ticksNeeded: number;
}

export interface CompleteResult {
  ok: boolean;
  skill: SkillId;
  xp: number;
  itemId: string;
  itemQty: number;
}

/** Extension seam for gather / craft skill nodes. */
export interface SkillHandler {
  canHandle(resourceId: string): boolean;
  tryStart(ctx: SkillContext, resourceId: string): StartResult;
  complete(ctx: SkillContext, resourceId: string): CompleteResult;
  interactRange(): number;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  if (![ax, ay, bx, by].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function tryStartGather(ctx: SkillContext, def: GatherNodeDef): StartResult {
  const res = ctx.getResource(def.resourceId);
  if (!res || !res.available) {
    return { ok: false, reason: "unavailable", ticksNeeded: 0 };
  }
  if (dist(ctx.x, ctx.y, res.x, res.y) > def.interactRange) {
    return { ok: false, reason: "too_far", ticksNeeded: 0 };
  }
  const skill = ctx.getSkill(def.skill);
  if (skill.level < def.requiredLevel) {
    return { ok: false, reason: "level_too_low", ticksNeeded: 0 };
  }
  return {
    ok: true,
    ticksNeeded: applyActionSpeedTicks(def.ticks, ctx.traits),
  };
}

function completeGather(ctx: SkillContext, def: GatherNodeDef): CompleteResult {
  const start = tryStartGather(ctx, def);
  if (!start.ok) {
    return { ok: false, skill: def.skill, xp: 0, itemId: "", itemQty: 0 };
  }
  const tool = toolBonusForSkill(ctx.equipment, def.skill);
  const xp = applyXpGain(Math.max(1, Math.floor(def.xp * tool.xpMult)), ctx.traits);
  // itemQty 0 = XP-only node (drops wired later)
  const rawQty = Math.floor(def.itemQty * tool.outputMult);
  const itemQty =
    rawQty <= 0 || !def.itemId ? 0 : applyOutputQty(Math.max(1, rawQty), ctx.traits);
  return {
    ok: true,
    skill: def.skill,
    xp,
    itemId: itemQty > 0 ? def.itemId : "",
    itemQty,
  };
}

export class GatherSkillHandler implements SkillHandler {
  constructor(private readonly def: GatherNodeDef) {}

  canHandle(resourceId: string): boolean {
    return resourceId === this.def.resourceId;
  }

  tryStart(ctx: SkillContext, _resourceId: string): StartResult {
    return tryStartGather(ctx, this.def);
  }

  complete(ctx: SkillContext, _resourceId: string): CompleteResult {
    return completeGather(ctx, this.def);
  }

  interactRange(): number {
    return this.def.interactRange;
  }
}

/** One handler per configured gather node. */
export function createGatherHandlers(): SkillHandler[] {
  return GATHER_NODES.map((def) => new GatherSkillHandler(def));
}

/** @deprecated Prefer createGatherHandlers(); kept for any direct imports. */
export class WoodcuttingHandler extends GatherSkillHandler {
  constructor() {
    const def = GATHER_NODES.find((n) => n.resourceId === "tree_normal")!;
    super(def);
  }
}

/** @deprecated Prefer createGatherHandlers() */
export class MiningHandler extends GatherSkillHandler {
  constructor() {
    const def = GATHER_NODES.find((n) => n.resourceId === "stone_chunk")!;
    super(def);
  }
}

/** @deprecated Prefer createGatherHandlers() */
export class FarmingHandler extends GatherSkillHandler {
  constructor() {
    const def = GATHER_NODES.find((n) => n.resourceId === "wheat_plot")!;
    super(def);
  }
}
