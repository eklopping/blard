import {
  MOVE_SPEED_PX_PER_SEC,
  MOVE_TICK_MS,
  createOpenWalkGrid,
  snapToTileCenter,
  stepToward,
  findApproachPoint,
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
    const target = snapToTileCenter(x, y, this.grid);
    if (!target) return null;
    const state = this.ensure(playerId);
    state.target = target;
    state.pendingInteract = null;
    return target;
  }

  /**
   * If already in range, returns { inRange: true }.
   * Otherwise sets approach target + pendingInteract and returns { inRange: false, target }.
   */
  beginInteract(
    playerId: string,
    from: Vec2,
    resourceId: string,
    resource: Vec2,
    interactRange: number,
  ): { inRange: true } | { inRange: false; target: Vec2 | null } {
    const dist = Math.hypot(from.x - resource.x, from.y - resource.y);
    if (dist <= interactRange) {
      const state = this.ensure(playerId);
      state.target = null;
      state.pendingInteract = null;
      return { inRange: true };
    }

    const approach = findApproachPoint(from, resource, interactRange, this.grid);
    const state = this.ensure(playerId);
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
