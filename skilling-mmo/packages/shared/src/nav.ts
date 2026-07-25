/** Tile grid + click-to-move helpers (shared by client prediction and server authority). */

export const TILE_SIZE = 32;
export const WORLD_TILES_W = 40;
export const WORLD_TILES_H = 30;
export const WORLD_WIDTH_PX = WORLD_TILES_W * TILE_SIZE;
export const WORLD_HEIGHT_PX = WORLD_TILES_H * TILE_SIZE;

/** Continuous walk speed used by server stepper and client prediction. */
export const MOVE_SPEED_PX_PER_SEC = 120;

/** Movement simulation interval (skill tick stays TICK_MS = 600). */
export const MOVE_TICK_MS = 50;

/** Arrive when within this many pixels of target. */
export const ARRIVE_EPSILON_PX = 2;

export interface Vec2 {
  x: number;
  y: number;
}

export interface TileCoord {
  tx: number;
  ty: number;
}

/** Row-major walkability: true = walkable. */
export type WalkGrid = boolean[][];

export function createOpenWalkGrid(
  width = WORLD_TILES_W,
  height = WORLD_TILES_H,
): WalkGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => true));
}

export function worldToTile(x: number, y: number): TileCoord {
  return {
    tx: Math.floor(x / TILE_SIZE),
    ty: Math.floor(y / TILE_SIZE),
  };
}

export function tileToWorldCenter(tx: number, ty: number): Vec2 {
  return {
    x: tx * TILE_SIZE + TILE_SIZE / 2,
    y: ty * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function clampToWorld(x: number, y: number): Vec2 {
  return {
    x: Math.min(WORLD_WIDTH_PX - 0.01, Math.max(0, x)),
    y: Math.min(WORLD_HEIGHT_PX - 0.01, Math.max(0, y)),
  };
}

export function isWalkable(grid: WalkGrid, tx: number, ty: number): boolean {
  if (ty < 0 || tx < 0 || ty >= grid.length) return false;
  const row = grid[ty];
  if (!row || tx >= row.length) return false;
  return row[tx] === true;
}

/** Snap world point to nearest walkable tile center (or null if none). */
export function snapToTileCenter(x: number, y: number, grid?: WalkGrid): Vec2 | null {
  const g = grid ?? createOpenWalkGrid();
  const clamped = clampToWorld(x, y);
  const { tx, ty } = worldToTile(clamped.x, clamped.y);
  if (isWalkable(g, tx, ty)) {
    return tileToWorldCenter(tx, ty);
  }
  // Spiral search for nearest walkable tile
  const maxR = Math.max(WORLD_TILES_W, WORLD_TILES_H);
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ntx = tx + dx;
        const nty = ty + dy;
        if (isWalkable(g, ntx, nty)) {
          return tileToWorldCenter(ntx, nty);
        }
      }
    }
  }
  return null;
}

export function stepToward(
  pos: Vec2,
  target: Vec2,
  speedPxPerSec: number,
  dtMs: number,
): { pos: Vec2; arrived: boolean } {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= ARRIVE_EPSILON_PX) {
    return { pos: { x: target.x, y: target.y }, arrived: true };
  }
  const step = (speedPxPerSec * dtMs) / 1000;
  if (step >= dist) {
    return { pos: { x: target.x, y: target.y }, arrived: true };
  }
  return {
    pos: {
      x: pos.x + (dx / dist) * step,
      y: pos.y + (dy / dist) * step,
    },
    arrived: false,
  };
}

/**
 * Pick a walkable tile center within interactRange of the resource,
 * preferring the tile closest to the player's current position.
 */
export function findApproachPoint(
  from: Vec2,
  resource: Vec2,
  interactRange: number,
  grid?: WalkGrid,
): Vec2 | null {
  const g = grid ?? createOpenWalkGrid();
  const candidates: Vec2[] = [];
  const minTx = Math.max(0, worldToTile(resource.x - interactRange, resource.y).tx);
  const maxTx = Math.min(
    WORLD_TILES_W - 1,
    worldToTile(resource.x + interactRange, resource.y).tx,
  );
  const minTy = Math.max(0, worldToTile(resource.x, resource.y - interactRange).ty);
  const maxTy = Math.min(
    WORLD_TILES_H - 1,
    worldToTile(resource.x, resource.y + interactRange).ty,
  );

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isWalkable(g, tx, ty)) continue;
      const center = tileToWorldCenter(tx, ty);
      if (Math.hypot(center.x - resource.x, center.y - resource.y) <= interactRange) {
        candidates.push(center);
      }
    }
  }

  if (candidates.length === 0) {
    // Fallback: step from resource toward player by interactRange * 0.75, then snap
    const dx = from.x - resource.x;
    const dy = from.y - resource.y;
    const dist = Math.hypot(dx, dy) || 1;
    const standDist = Math.min(interactRange * 0.75, dist);
    return snapToTileCenter(
      resource.x + (dx / dist) * standDist,
      resource.y + (dy / dist) * standDist,
      g,
    );
  }

  let best = candidates[0]!;
  let bestDist = Math.hypot(best.x - from.x, best.y - from.y);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    const d = Math.hypot(c.x - from.x, c.y - from.y);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
