import {
  WOODCUTTING,
  MINING,
  FARMING,
  SKILLS,
  applyActionSpeedTicks,
  applyXpGain,
  applyOutputQty,
  toolBonusForSkill,
  type EquipmentLoadout,
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

/** Extension seam for future skills (mining, fishing, …). */
export interface SkillHandler {
  canHandle(resourceId: string): boolean;
  tryStart(ctx: SkillContext, resourceId: string): StartResult;
  complete(ctx: SkillContext, resourceId: string): CompleteResult;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

type GatherDef = {
  resourceId: string;
  requiredLevel: number;
  ticks: number;
  xp: number;
  itemId: string;
  itemQty: number;
  interactRange: number;
  skill: SkillId;
};

function tryStartGather(ctx: SkillContext, def: GatherDef): StartResult {
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

function completeGather(ctx: SkillContext, def: GatherDef): CompleteResult {
  const start = tryStartGather(ctx, def);
  if (!start.ok) {
    return { ok: false, skill: def.skill, xp: 0, itemId: "", itemQty: 0 };
  }
  const tool = toolBonusForSkill(ctx.equipment, def.skill);
  const xp = applyXpGain(Math.max(1, Math.floor(def.xp * tool.xpMult)), ctx.traits);
  const itemQty = applyOutputQty(Math.max(1, Math.floor(def.itemQty * tool.outputMult)), ctx.traits);
  return {
    ok: true,
    skill: def.skill,
    xp,
    itemId: def.itemId,
    itemQty,
  };
}

export class WoodcuttingHandler implements SkillHandler {
  private def: GatherDef = {
    resourceId: WOODCUTTING.NORMAL_TREE.resourceId,
    requiredLevel: WOODCUTTING.NORMAL_TREE.requiredLevel,
    ticks: WOODCUTTING.NORMAL_TREE.ticksToChop,
    xp: WOODCUTTING.NORMAL_TREE.xp,
    itemId: WOODCUTTING.NORMAL_TREE.itemId,
    itemQty: WOODCUTTING.NORMAL_TREE.itemQty,
    interactRange: WOODCUTTING.NORMAL_TREE.interactRange,
    skill: SKILLS.WOODCUTTING,
  };

  canHandle(resourceId: string): boolean {
    return resourceId === this.def.resourceId;
  }

  tryStart(ctx: SkillContext, _resourceId: string): StartResult {
    return tryStartGather(ctx, this.def);
  }

  complete(ctx: SkillContext, _resourceId: string): CompleteResult {
    return completeGather(ctx, this.def);
  }
}

export class MiningHandler implements SkillHandler {
  private def: GatherDef = {
    resourceId: MINING.STONE.resourceId,
    requiredLevel: MINING.STONE.requiredLevel,
    ticks: MINING.STONE.ticksToMine,
    xp: MINING.STONE.xp,
    itemId: MINING.STONE.itemId,
    itemQty: MINING.STONE.itemQty,
    interactRange: MINING.STONE.interactRange,
    skill: SKILLS.MINING,
  };

  canHandle(resourceId: string): boolean {
    return resourceId === this.def.resourceId;
  }

  tryStart(ctx: SkillContext, _resourceId: string): StartResult {
    return tryStartGather(ctx, this.def);
  }

  complete(ctx: SkillContext, _resourceId: string): CompleteResult {
    return completeGather(ctx, this.def);
  }
}

export class FarmingHandler implements SkillHandler {
  private def: GatherDef = {
    resourceId: FARMING.WHEAT.resourceId,
    requiredLevel: FARMING.WHEAT.requiredLevel,
    ticks: FARMING.WHEAT.ticksToHarvest,
    xp: FARMING.WHEAT.xp,
    itemId: FARMING.WHEAT.itemId,
    itemQty: FARMING.WHEAT.itemQty,
    interactRange: FARMING.WHEAT.interactRange,
    skill: SKILLS.FARMING,
  };

  canHandle(resourceId: string): boolean {
    return resourceId === this.def.resourceId;
  }

  tryStart(ctx: SkillContext, _resourceId: string): StartResult {
    return tryStartGather(ctx, this.def);
  }

  complete(ctx: SkillContext, _resourceId: string): CompleteResult {
    return completeGather(ctx, this.def);
  }
}
