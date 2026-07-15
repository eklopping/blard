import { Redis } from "ioredis";

let redis: Redis | null = null;

export function isRedisEnabled(): boolean {
  return process.env.REDIS_ENABLED === "true" || process.env.REDIS_ENABLED === "1";
}

export function getRedis(): Redis | null {
  if (!isRedisEnabled()) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redis;
}
