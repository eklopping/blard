export class ChatRateLimiter {
  private last = new Map<string, number>();

  allow(playerId: string, minIntervalMs: number): boolean {
    const now = Date.now();
    const prev = this.last.get(playerId) ?? 0;
    if (now - prev < minIntervalMs) return false;
    this.last.set(playerId, now);
    return true;
  }

  clear(playerId: string) {
    this.last.delete(playerId);
  }
}
