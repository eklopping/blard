/**
 * TODO: PvPMatchmaker — use a Redis list (e.g. `pvp:queue`) to match two players,
 * then route them into FightRoom. Not implemented in this milestone.
 */
export class PvPMatchmaker {
  constructor(private _redisUrl?: string) {}

  async enqueue(_playerId: string): Promise<void> {
    // TODO: LPUSH pvp:queue playerId
    throw new Error("TODO: PvPMatchmaker not implemented");
  }

  async tryMatch(): Promise<[string, string] | null> {
    // TODO: pop two from queue when length >= 2
    return null;
  }
}

/**
 * TODO: Register when combat ships:
 *   gameServer.define("fight", FightRoom);
 */
// export class FightRoom extends Room { ... }
