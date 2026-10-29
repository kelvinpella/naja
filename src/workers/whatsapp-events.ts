import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { generateWhatsappReply } from "../services/whatsapp-agent.js";
import { sendTypingIndicator } from "../services/kapso-typing-indicator.js";
import { sendWhatsappReply } from "../services/whatsapp-reply.js";

// A model turn plus a synchronous Observational Memory pass is far slower than
// the old menu replies, so the budget and the lock outlive it comfortably.
const PERSON_LOCK_TTL_MS = 180_000;
const PERSON_LOCK_RENEW_MS = 15_000;
const PROCESSING_TIMEOUT_MS = 90_000;

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
    () => controller.abort(new Error("WhatsApp event processing timed out")),
    PROCESSING_TIMEOUT_MS,
  );
  let lockAcquired = false;
  let renewal: ReturnType<typeof setInterval> | undefined;

  try {
    while (
      (await redis.set(key, token, "PX", PERSON_LOCK_TTL_MS, "NX")) !== "OK"
    ) {
      await wait(100, controller.signal);
    }
    lockAcquired = true;

    renewal = setInterval(() => {
      void redis
        .eval(RENEW_LOCK_SCRIPT, 1, key, token, PERSON_LOCK_TTL_MS)
        .then((result) => {
          if (Number(result) !== 1) {
            controller.abort(new Error("WhatsApp sender lock was lost"));
          }
        })
        .catch((error: unknown) => controller.abort(error));
    }, PERSON_LOCK_RENEW_MS);
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

export type WhatsappEventProcessorOptions = {
  redis: Redis;
  kapsoApiKey: string;
  logger: FastifyBaseLogger;
};

export function createWhatsappEventProcessor({
  redis,
  kapsoApiKey,
  logger,
}: WhatsappEventProcessorOptions) {
  return async (job: Job<WhatsappIncomingMessageJob>): Promise<void> => {
    await withPersonLock(redis, job.data.personKey, logger, async (signal) => {
      // Best effort: a typing bubble that fails must not fail the turn.
      void sendTypingIndicator(
        job.data.phoneNumberId,
        job.data.eventId,
        kapsoApiKey,
        logger,
        signal,
      ).catch(() => {});

      const reply = await generateWhatsappReply(job.data, signal);
      signal.throwIfAborted();
      await sendWhatsappReply(job.data, reply, kapsoApiKey, logger, signal);
    });
  };
}
