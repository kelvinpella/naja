import { connectRedis } from "../services/redis-connection.js";

const KEY_PATTERNS = ["naja:*", "bull:naja-*"];

async function deleteByPattern(
  redis: Awaited<ReturnType<typeof connectRedis>>,
  pattern: string,
): Promise<number> {
  const pending = new Set<Promise<unknown>>();
  let deleted = 0;
  let failed: unknown = null;
  const stream = redis.scanStream({ match: pattern, count: 100 });

  stream.on("data", (keys: string[]) => {
    if (keys.length > 0) {
      stream.pause();
      const write = redis
        .del(...keys)
        .then((count) => {
          deleted += count;
        })
        .catch((error: unknown) => {
          failed = error;
          stream.destroy(error as Error);
        })
        .finally(() => {
          pending.delete(write);
          if (!stream.destroyed) stream.resume();
        });
      pending.add(write);
    }
  });

  await new Promise<void>((resolve, reject) => {
    stream.on("end", () => resolve());
    stream.on("error", (error: unknown) => reject(error));
  });
  // Drain in-flight DELs that finished after 'end' fired.
  await Promise.allSettled([...pending]);
  if (failed) throw failed;

  return deleted;
}

async function clearRedis(): Promise<void> {
  const flushAll = process.argv.includes("--all");
  if (flushAll && process.env["CONFIRM"] !== "1") {
    console.error("Refusing to FLUSHDB without CONFIRM=1. Run with CONFIRM=1 --all to confirm.");
    process.exit(1);
  }
  const redis = await connectRedis(
    process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  );

  try {
    if (flushAll) {
      await redis.flushdb();
      console.log("Redis database flushed (FLUSHDB).");
      return;
    }

    let total = 0;
    for (const pattern of KEY_PATTERNS) {
      const deleted = await deleteByPattern(redis, pattern);
      console.log(`Deleted ${deleted} key(s) matching "${pattern}".`);
      total += deleted;
    }
    console.log(`Done. ${total} key(s) deleted.`);
  } finally {
    redis.disconnect();
  }
}

void clearRedis().catch((error: unknown) => {
  console.error("Failed to clear Redis:", error);
  process.exit(1);
});
