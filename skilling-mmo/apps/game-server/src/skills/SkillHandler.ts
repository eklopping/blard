import { WOODCUTTING, SKILLS, type SkillId } from "@skilling-mmo/shared";

export interface SkillContext {
  playerId: string;
  x: number;
  y: number;
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

export class WoodcuttingHandler implements SkillHandler {
  canHandle(resourceId: string): boolean {
    return resourceId === WOODCUTTING.NORMAL_TREE.resourceId;
  }

  tryStart(ctx: SkillContext, resourceId: string): StartResult {
    const def = WOODCUTTING.NORMAL_TREE;
    const res = ctx.getResource(resourceId);
    if (!res || !res.available) {
      return { ok: false, reason: "unavailable", ticksNeeded: 0 };
    }
    if (dist(ctx.x, ctx.y, res.x, res.y) > def.interactRange) {
      return { ok: false, reason: "too_far", ticksNeeded: 0 };
    }
    const skill = ctx.getSkill(SKILLS.WOODCUTTING);
    if (skill.level < def.requiredLevel) {
      return { ok: false, reason: "level_too_low", ticksNeeded: 0 };
    }
    return { ok: true, ticksNeeded: def.ticksToChop };
  }

  complete(ctx: SkillContext, resourceId: string): CompleteResult {
    const start = this.tryStart(ctx, resourceId);
    if (!start.ok) {
      return { ok: false, skill: SKILLS.WOODCUTTING, xp: 0, itemId: "", itemQty: 0 };
    }
    const def = WOODCUTTING.NORMAL_TREE;
    return {
      ok: true,
      skill: SKILLS.WOODCUTTING,
      xp: def.xp,
      itemId: def.itemId,
      itemQty: def.itemQty,
    };
  }
}
