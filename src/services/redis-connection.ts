import { Redis } from "ioredis";

export async function connectRedis(
  redisUrl: string,
  timeoutMs = 5000,
): Promise<Redis> {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  redis.on("error", (err) => {
    // Prevent unhandled 'error' throws; BullMQ/workers log contextually.
    // Console used here to avoid logger dependency at connection layer.
    console.error("Redis connection error:", err);
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const ping = redis.ping();
  // Avoid dangling rejection if timeout wins the race.
  ping.catch(() => undefined);

  try {
    await Promise.race([
      ping,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Redis connection timed out")),
          timeoutMs,
        );
      }),
    ]);
    return redis;
  } catch (error) {
    redis.disconnect();
    throw new Error("Unable to connect to Redis. Check REDIS_URL.", {
      cause: error,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}