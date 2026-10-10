import { createHash, randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import { processWhatsappMessage } from "../services/whatsapp-conversation.js";

const PERSON_LOCK_TTL_MS = 60_000;
const PERSON_LOCK_RENEW_MS = 15_000;
const PROCESSING_TIMEOUT_MS = 30_000;

const RENEW_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

function personLockKey(personKey: string): string {
  const hashed = createHash("sha256").update(personKey).digest("hex");
  return `naja:zernio-event-lock:${hashed}`;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function withPersonLock(
  redis: Redis,
  personKey: string,
  logger: FastifyBaseLogger,
  run: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const key = personLockKey(personKey);
  const token = randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Zernio event processing timed out")),
    PROCESSING_TIMEOUT_MS,
  );
  let lockAcquired = false;
  let renewal: ReturnType<typeof setInterval> | undefined;

  try {
    const start = Date.now();
    let attempt = 0;
    while (
      (await redis.set(key, token, "PX", PERSON_LOCK_TTL_MS, "NX")) !== "OK"
    ) {
      controller.signal.throwIfAborted();
      const elapsed = Date.now() - start;
      if (elapsed > PROCESSING_TIMEOUT_MS) {
        throw new Error("Timed out waiting for Zernio sender lock");
      }
      // Jittered exponential backoff: 100,200,400... capped at 1s.
      const backoff = Math.min(100 * 2 ** attempt, 1000);
      const jitter = Math.random() * 100;
      attempt += 1;
      logger.warn({ personLock: key, attempt }, "Sender lock contended, backing off");
      await wait(backoff + jitter, controller.signal);
    }
    lockAcquired = true;

    renewal = setInterval(() => {
      void redis
        .eval(RENEW_LOCK_SCRIPT, 1, key, token, PERSON_LOCK_TTL_MS)
        .then((result) => {
          if (Number(result) !== 1) {
            controller.abort(new Error("Zernio sender lock was lost"));
          }
        })
        .catch((error: unknown) => controller.abort(error));
    }, PERSON_LOCK_RENEW_MS);
    renewal.unref();

    await run(controller.signal);
    // run() may ignore the signal — enforce it before releasing the lock.
    controller.signal.throwIfAborted();
  } finally {
    clearTimeout(timeout);
    if (renewal) clearInterval(renewal);

    if (lockAcquired) {
      try {
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
      } catch (error) {
        logger.error({ err: error }, "Failed to release Zernio sender lock");
      }
    }
  }
}

export type ZernioEventProcessorOptions = {
  redis: Redis;
  zernioApiKey: string;
  logger: FastifyBaseLogger;
};

export function createZernioEventProcessor({
  redis,
  zernioApiKey,
  logger,
}: ZernioEventProcessorOptions) {
  return async (job: Job<WhatsappIncomingMessageJob>): Promise<void> => {
    const personKey = job.data?.personKey;
    const eventId = job.data?.eventId;
    if (typeof personKey !== "string" || personKey.trim().length === 0) {
      throw new Error("WhatsApp job missing personKey");
    }
    if (typeof eventId !== "string" || eventId.trim().length === 0) {
      throw new Error("WhatsApp job missing eventId");
    }
    await withPersonLock(redis, personKey, logger, (signal) =>
      processWhatsappMessage(job.data, redis, zernioApiKey, logger, signal),
    );
  };
}