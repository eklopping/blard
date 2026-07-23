/** Character traits — starting picks now; future achievement unlocks append more. */

export const TRAITS = {
  QUICK_THINKING: "quick_thinking",
  SINGLE_MINDED: "single_minded",
  STEADFAST_FOCUS: "steadfast_focus",
} as const;

export type TraitId = (typeof TRAITS)[keyof typeof TRAITS];

export interface TraitDef {
  id: TraitId;
  name: string;
  description: string;
  /** Placeholder until achievement system grants more */
  starter: boolean;
}

export const TRAIT_DEFS: Record<TraitId, TraitDef> = {
  [TRAITS.QUICK_THINKING]: {
    id: TRAITS.QUICK_THINKING,
    name: "Quick Thinking",
    description: "Performs actions 15% quicker.",
    starter: true,
  },
  [TRAITS.SINGLE_MINDED]: {
    id: TRAITS.SINGLE_MINDED,
    name: "Single Minded",
    description: "10% chance to double the output of an action.",
    starter: true,
  },
  [TRAITS.STEADFAST_FOCUS]: {
    id: TRAITS.STEADFAST_FOCUS,
    name: "Steadfast Focus",
    description: "Increases experience gain by 20%.",
    starter: true,
  },
};

export const STARTER_TRAIT_IDS = Object.values(TRAITS);

export function hasTrait(traits: string[] | undefined, id: TraitId): boolean {
  return !!traits?.includes(id);
}

/** Reduce action duration ticks (min 1). */
export function applyActionSpeedTicks(baseTicks: number, traits: string[] | undefined): number {
  if (!hasTrait(traits, TRAITS.QUICK_THINKING)) return baseTicks;
  return Math.max(1, Math.ceil(baseTicks * 0.85));
}

export function applyXpGain(baseXp: number, traits: string[] | undefined): number {
  if (!hasTrait(traits, TRAITS.STEADFAST_FOCUS)) return baseXp;
  return Math.floor(baseXp * 1.2);
}

export function applyOutputQty(
  baseQty: number,
  traits: string[] | undefined,
  rng: () => number = Math.random,
): number {
  if (!hasTrait(traits, TRAITS.SINGLE_MINDED)) return baseQty;
  if (rng() < 0.1) return baseQty * 2;
  return baseQty;
}
