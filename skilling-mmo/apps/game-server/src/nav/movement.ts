import {
  MOVE_SPEED_PX_PER_SEC,
  MOVE_TICK_MS,
  ARRIVE_EPSILON_PX,
  createOpenWalkGrid,
  snapToTileCenter,
  stepToward,
  findClosestSideApproach,
  type WalkGrid,
  type Vec2,
} from "@skilling-mmo/shared";

export interface PlayerNavState {
  target: Vec2 | null;
  pendingInteract: string | null;
}

export type ArriveHandler = (
  playerId: string,
  pos: Vec2,
  pendingInteract: string | null,
) => void;

/** Server-side click-to-move: destinations are tile-snapped; positions step each MOVE_TICK_MS. */
export class MovementController {
  private readonly grid: WalkGrid;
  private readonly players = new Map<string, PlayerNavState>();

  constructor(grid: WalkGrid = createOpenWalkGrid()) {
    this.grid = grid;
  }

  ensure(playerId: string): PlayerNavState {
    let state = this.players.get(playerId);
    if (!state) {
      state = { target: null, pendingInteract: null };
      this.players.set(playerId, state);
    }
    return state;
  }

  clear(playerId: string) {
    this.players.delete(playerId);
  }

  /** Set walk destination from a world click. Clears pending interact. */
  setMoveTarget(playerId: string, x: number, y: number): Vec2 | null {
    // Reject off-map clicks — do not clamp to the edge (that teleports players).
    const target = snapToTileCenter(x, y, this.grid, false);
    if (!target) return null;
    const state = this.ensure(playerId);
    state.target = target;
    state.pendingInteract = null;
    return target;
  }

  /**
   * Walk to the closer left/right stand tile, then interact.
   * If already standing on that side in range, returns { inRange: true }.
   */
  beginInteract(
    playerId: string,
    from: Vec2,
    resourceId: string,
    resource: Vec2,
    interactRange: number,
  ): { inRange: true } | { inRange: false; target: Vec2 | null } {
    if (
      !Number.isFinite(from.x) ||
      !Number.isFinite(from.y) ||
      !Number.isFinite(resource.x) ||
      !Number.isFinite(resource.y) ||
      !Number.isFinite(interactRange) ||
      interactRange <= 0
    ) {
      return { inRange: false, target: null };
    }

    const approach = findClosestSideApproach(from, resource, undefined, this.grid);
    const state = this.ensure(playerId);

    if (!approach) {
      state.target = null;
      state.pendingInteract = null;
      return { inRange: false, target: null };
    }

    const distToRes = Math.hypot(from.x - resource.x, from.y - resource.y);
    const atStand =
      Math.hypot(from.x - approach.x, from.y - approach.y) <= ARRIVE_EPSILON_PX + 4;
    const inResRange = distToRes <= interactRange;

    if (atStand && inResRange) {
      state.target = null;
      state.pendingInteract = null;
      return { inRange: true };
    }

    state.target = approach;
    state.pendingInteract = resourceId;
    return { inRange: false, target: approach };
  }

  cancelMovement(playerId: string) {
    const state = this.players.get(playerId);
    if (!state) return;
    state.target = null;
    state.pendingInteract = null;
  }

  /**
   * Advance all players with targets. Calls onArrive when a player reaches their target
   * (with the pendingInteract id if any, before clearing it).
   */
  tick(
    getPos: (playerId: string) => Vec2 | undefined,
    setPos: (playerId: string, pos: Vec2) => void,
    onArrive: ArriveHandler,
    dtMs: number = MOVE_TICK_MS,
    speed: number = MOVE_SPEED_PX_PER_SEC,
  ) {
    for (const [playerId, state] of this.players) {
      if (!state.target) continue;
      const pos = getPos(playerId);
      // Locked in a skill action — keep destination so we resume after, but don't
      // drop pendingInteract on a soft skip. If we never get a pos again, cancel.
      if (!pos) continue;

      const { pos: next, arrived } = stepToward(pos, state.target, speed, dtMs);
      setPos(playerId, next);

      if (arrived) {
        const pending = state.pendingInteract;
        state.target = null;
        state.pendingInteract = null;
        onArrive(playerId, next, pending);
      }
    }
  }
}
