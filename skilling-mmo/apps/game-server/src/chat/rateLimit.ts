export class ChatRateLimiter {
  private last = new Map<string, number>();

  allow(playerId: string, bucket: string, minIntervalMs: number): boolean {
    const key = `${playerId}:${bucket}`;
    const now = Date.now();
    const prev = this.last.get(key) ?? 0;
    if (now - prev < minIntervalMs) return false;
    this.last.set(key, now);
    return true;
  }

  clear(playerId: string) {
    const prefix = `${playerId}:`;
    for (const key of this.last.keys()) {
      if (key.startsWith(prefix)) this.last.delete(key);
    }
  }
}
