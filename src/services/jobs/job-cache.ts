import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { normalizePhoneDigits } from "../phone.js";

export const JOB_LIST_CACHE_TTL_SECONDS = 90;
export const JOB_DETAIL_CACHE_TTL_SECONDS = 90;

const LIST_PREFIX = "naja:cache:jobs:list:";
const ID_PREFIX = "naja:cache:jobs:id:";

let redis: Redis | null = null;

export function setJobsCacheRedis(next: Redis | null): void {
  redis = next;
}

export function resetJobsCache(): void {
  redis = null;
}

export function jobsCacheRedis(): Redis | null {
  return redis;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function jobListCacheKey(
  offset: number,
  excludePhone?: string | null,
): string {
  return `${LIST_PREFIX}${Math.max(0, offset)}:${shortHash(normalizePhoneDigits(excludePhone) || "none")}`;
}

export function jobDetailCacheKey(id: string): string {
  return `${ID_PREFIX}${id}`;
}

export async function readCached<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  const value = await redis.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function writeCached(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!redis) return;
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function purgeCachedPrefix(prefix: string): Promise<void> {
  if (!redis) return;
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      100,
    );
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}

export async function purgeJobListCopies(): Promise<void> {
  await purgeCachedPrefix(LIST_PREFIX);
}
