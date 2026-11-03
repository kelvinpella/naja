import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";

// A model turn plus a synchronous Observational Memory pass is far slower than
// a menu reply, so the lock's TTL comfortably outlives the processing budget,
// and the renewal keeps it alive while the turn runs.
export const PERSON_LOCK_TTL_MS = 180_000;
const RENEW_INTERVAL_MS = 15_000;
const ACQUIRE_POLL_MS = 100;

// Aborting with this error means another worker owns the sender and is already
// answering, so this Turn must not send anything: the retry is the other
// worker's message, not an apology.
export class SenderLockLostError extends Error {}

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

export function personLockKey(personKey: string): string {
  return `naja:whatsapp-event-lock:${personKey}`;
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

export type PersonLockOptions = {
  redis: Redis;
  personKey: string;
  logger: FastifyBaseLogger;
  /** The Turn's own budget; the lock is held for at least this long. */
  timeoutMs: number;
  run: (signal: AbortSignal) => Promise<void>;
};

/**
 * Serialises one Person's messages across every worker: a Person's messages
 * arrive one at a time, in order, and the sender lock is also what stops two
 * workers answering the same conversation at once.
 *
 * The signal passed to `run` aborts when the budget runs out or the lock is
 * lost, so a Turn that outlived its ownership stops instead of racing the new
 * owner. Everything the Turn sends must honour it.
 */
export async function withPersonLock({
  redis,
  personKey,
  logger,
  timeoutMs,
  run,
}: PersonLockOptions): Promise<void> {
  const key = personLockKey(personKey);
  const token = randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("WhatsApp event processing timed out")),
    timeoutMs,
  );
  let lockAcquired = false;
  let renewal: ReturnType<typeof setInterval> | undefined;

  try {
    while (
      (await redis.set(key, token, "PX", PERSON_LOCK_TTL_MS, "NX")) !== "OK"
    ) {
      await wait(ACQUIRE_POLL_MS, controller.signal);
    }
    lockAcquired = true;

    renewal = setInterval(() => {
      void redis
        .eval(RENEW_LOCK_SCRIPT, 1, key, token, PERSON_LOCK_TTL_MS)
        .then((result) => {
          if (Number(result) !== 1) {
            controller.abort(
              new SenderLockLostError("WhatsApp sender lock was lost"),
            );
          }
        })
        .catch((error: unknown) => controller.abort(error));
    }, RENEW_INTERVAL_MS);
    renewal.unref();

    await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    if (renewal) clearInterval(renewal);

    if (lockAcquired) {
      try {
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
      } catch (error) {
        logger.error({ err: error }, "Failed to release WhatsApp sender lock");
      }
    }
  }
}
