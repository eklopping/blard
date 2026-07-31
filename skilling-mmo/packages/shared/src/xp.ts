/** OSRS-style cumulative XP curve (shared by skills and classes). */

/** XP required to reach level (index = level). Level 1 starts with 0 XP. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += Math.floor(l + 300 * Math.pow(2, l / 7));
  }
  return Math.floor(total / 4);
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 99 && xpForLevel(level + 1) <= xp) {
    level++;
  }
  return level;
}
