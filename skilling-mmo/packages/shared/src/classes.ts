/**
 * Class progression — fed by sub-skill level-ups.
 * Shared skills can belong to multiple classes; unlocking a class
 * retroactively grants class XP for levels already earned in those skills.
 */

import { xpForLevel, levelFromXp } from "./xp.js";

/** Keep in sync with PROFESSIONS / SKILLS in index.ts (avoid circular imports). */
type ProfessionId = "woodsman" | "farmer" | "miner";
type SkillId = "woodcutting" | "farming" | "mining" | (string & {});

/** When true, every character can select any class (testing). Turn off for quest-gated unlocks. */
export const UNLOCK_ALL_CLASSES_FOR_TESTING = true;

/** Classes currently match starter professions; expand independently later. */
export const CLASSES = {
  WOODSMAN: "woodsman",
  FARMER: "farmer",
  MINER: "miner",
} as const;

export type ClassId = (typeof CLASSES)[keyof typeof CLASSES];

export const CLASS_IDS: ClassId[] = [CLASSES.WOODSMAN, CLASSES.FARMER, CLASSES.MINER];

export const CLASS_LABELS: Record<ClassId, string> = {
  [CLASSES.WOODSMAN]: "Woodsman",
  [CLASSES.FARMER]: "Farmer",
  [CLASSES.MINER]: "Miner",
};

/**
 * Sub-skills that feed each class.
 * General / shared skills can appear under multiple classes.
 */
export const CLASS_SKILLS: Record<ClassId, SkillId[]> = {
  [CLASSES.WOODSMAN]: ["woodcutting"],
  [CLASSES.FARMER]: ["farming"],
  [CLASSES.MINER]: ["mining"],
};

/** Reverse map: skill → classes that receive XP when it levels. */
export function classesForSkill(skill: SkillId): ClassId[] {
  const out: ClassId[] = [];
  for (const classId of CLASS_IDS) {
    if (CLASS_SKILLS[classId].includes(skill)) out.push(classId);
  }
  return out;
}

/**
 * Class XP granted when a contributing skill reaches `newLevel`
 * (crossing from newLevel - 1). Uses the skill curve step so class
 * progression tracks real skill investment.
 */
export function classXpForSkillLevel(newLevel: number): number {
  if (newLevel <= 1) return 0;
  return Math.max(0, xpForLevel(newLevel) - xpForLevel(newLevel - 1));
}

/** Sum of class XP that would have been granted for levels 2..skillLevel. */
export function classXpFromSkillLevels(skillLevel: number): number {
  let total = 0;
  for (let level = 2; level <= skillLevel; level++) {
    total += classXpForSkillLevel(level);
  }
  return total;
}

export { levelFromXp as classLevelFromXp };

export interface ClassProgressDto {
  classId: ClassId;
  level: number;
  xp: number;
  unlocked: boolean;
}

export interface ClassProgressState {
  level: number;
  xp: number;
  unlocked: boolean;
}

/** Placeholder boons unlocked at class level thresholds (effects TBD). */
export interface ClassBoonDef {
  id: string;
  classId: ClassId | "*";
  level: number;
  description: string;
}

export const CLASS_LEVEL_BOONS: ClassBoonDef[] = [
  { id: "boon_class_5", classId: "*", level: 5, description: "Placeholder boon at class level 5" },
  { id: "boon_class_10", classId: "*", level: 10, description: "Placeholder boon at class level 10" },
  { id: "boon_class_20", classId: "*", level: 20, description: "Placeholder boon at class level 20" },
  { id: "boon_class_50", classId: "*", level: 50, description: "Placeholder boon at class level 50" },
  { id: "boon_class_99", classId: "*", level: 99, description: "Placeholder boon at class level 99" },
];

export function classBoonsEarned(classId: ClassId, level: number): ClassBoonDef[] {
  return CLASS_LEVEL_BOONS.filter(
    (b) => level >= b.level && (b.classId === "*" || b.classId === classId),
  );
}

export function isClassId(value: string): value is ClassId {
  return (CLASS_IDS as string[]).includes(value);
}

/** Profession chosen at create unlocks the matching class. */
export function starterClassForProfession(profession: ProfessionId): ClassId {
  return profession;
}

export function emptyClassProgress(unlocked = false): ClassProgressState {
  return { level: 1, xp: 0, unlocked };
}

/**
 * Grant class XP for skill levels crossed (fromLevel → toLevel).
 * Only unlocked classes that list the skill receive XP.
 */
export function applySkillLevelUpsToClasses(
  classes: Map<ClassId, ClassProgressState>,
  skill: SkillId,
  fromLevel: number,
  toLevel: number,
): ClassId[] {
  if (toLevel <= fromLevel) return [];
  const touched = new Set<ClassId>();
  const owners = classesForSkill(skill);
  for (let level = fromLevel + 1; level <= toLevel; level++) {
    const gain = classXpForSkillLevel(level);
    if (gain <= 0) continue;
    for (const classId of owners) {
      const row = classes.get(classId);
      if (!row?.unlocked) continue;
      row.xp += gain;
      row.level = levelFromXp(row.xp);
      touched.add(classId);
    }
  }
  return [...touched];
}

/**
 * Unlock a class and push retroactive XP from all of its skills' current levels.
 * Safe to call if already unlocked (no-op).
 */
export function unlockClassWithCatchUp(
  classes: Map<ClassId, ClassProgressState>,
  skills: Map<string, { level: number; xp: number }>,
  classId: ClassId,
): ClassProgressState {
  let row = classes.get(classId);
  if (!row) {
    row = emptyClassProgress(false);
    classes.set(classId, row);
  }
  if (row.unlocked) return row;

  row.unlocked = true;
  let catchUp = 0;
  for (const skill of CLASS_SKILLS[classId]) {
    const skillLevel = skills.get(skill)?.level ?? 1;
    catchUp += classXpFromSkillLevels(skillLevel);
  }
  row.xp += catchUp;
  row.level = levelFromXp(row.xp);
  return row;
}

export function classesToDto(classes: Map<ClassId, ClassProgressState>): ClassProgressDto[] {
  return CLASS_IDS.map((classId) => {
    const row = classes.get(classId) ?? emptyClassProgress(false);
    return {
      classId,
      level: row.level,
      xp: row.xp,
      unlocked: row.unlocked,
    };
  });
}

export function serializeClasses(classes: Map<ClassId, ClassProgressState>): string {
  return JSON.stringify(classesToDto(classes));
}

export function parseClassesJson(raw: unknown): ClassProgressDto[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (row): row is ClassProgressDto =>
        row &&
        typeof row === "object" &&
        isClassId(row.classId) &&
        typeof row.level === "number" &&
        typeof row.xp === "number" &&
        typeof row.unlocked === "boolean",
    );
  } catch {
    return null;
  }
}
