import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import pino from "pino";
import { connectRedis } from "./services/redis-connection.js";
import {
  WHATSAPP_INCOMING_MESSAGES_QUEUE,
  WHATSAPP_INCOMING_MESSAGES_DEAD_LETTER_QUEUE,
  ZERNIO_QUEUE_JOB_OPTIONS,
  type WhatsappIncomingMessageDeadLetterJob,
  type WhatsappIncomingMessageJob,
  zernioEventJobId,
} from "./queues/zernio-events.js";
import { createZernioEventProcessor } from "./workers/zernio-events.js";

async function startWorker(): Promise<void> {
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  const zernioApiKey = process.env.ZERNIO_API_KEY;
  if (!zernioApiKey) {
    throw new Error("ZERNIO_API_KEY is required for WhatsApp replies");
  }

  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  // Separate connections: BullMQ blocks shared connections; locks need their own.
  const lockRedis = await connectRedis(redisUrl);
  const queueRedis = await connectRedis(redisUrl);
  const workerRedis = await connectRedis(redisUrl);
  const deadLetterQueue = new Queue<WhatsappIncomingMessageDeadLetterJob>(
    WHATSAPP_INCOMING_MESSAGES_DEAD_LETTER_QUEUE,
    {
      connection: queueRedis,
      defaultJobOptions: {
        attempts: 1,
        removeOnFail: { age: 365 * 24 * 60 * 60, count: 5000 },
      },
    },
  );
  const pendingDeadLetterWrites = new Set<Promise<void>>();
  const processor = createZernioEventProcessor({
    redis: lockRedis,
    zernioApiKey,
    logger,
  });

  const worker = new Worker<WhatsappIncomingMessageJob>(
    WHATSAPP_INCOMING_MESSAGES_QUEUE,
    (job: Job<WhatsappIncomingMessageJob>) => processor(job),
    {
      connection: workerRedis,
        concurrency: 8,
      lockDuration: 60_000,
    },
  );

  function isStalledLimitError(error: Error): boolean {
    const code = (error as Error & { code?: unknown }).code;
    return (
      /stalled/i.test(error.message) ||
      code === "BULLMQ_STALLED_LIMIT" ||
      code === "ERR_STALLED_LIMIT"
    );
  }

  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, eventId: job?.data.eventId },
      "WhatsApp incoming-message job failed",
    );
    const attemptsExhausted =
      job && job.attemptsMade >= (job.opts.attempts ?? ZERNIO_QUEUE_JOB_OPTIONS.attempts ?? 5);
    const stalledLimitReached = isStalledLimitError(error);
    if (!job || (!attemptsExhausted && !stalledLimitReached)) {
      return;
    }

    const failedAt = new Date().toISOString();
    const deadLetterJob: WhatsappIncomingMessageDeadLetterJob = {
      originalJobId: String(job.id),
      eventId: job.data.eventId,
      personKey: job.data.personKey,
      attemptsMade: job.attemptsMade,
      failedReason: error.message,
      failedAt,
      data: job.data,
    };

    const write: Promise<void> = (async () => {
      try {
        await deadLetterQueue.add("whatsapp-incoming-message-failed", deadLetterJob, {
          jobId: `dead-${zernioEventJobId(job.data.eventId)}-${job.attemptsMade}-${Date.parse(failedAt)}`,
        });
      } catch (deadLetterError: unknown) {
        logger.error(
          {
            err: deadLetterError,
            eventId: job.data.eventId,
            originalJobId: job.id,
          },
          "Failed to enqueue dead-letter WhatsApp message",
        );
      }
    })();
    pendingDeadLetterWrites.add(write);
    void write.finally(() => {
      pendingDeadLetterWrites.delete(write);
    });
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ queue: WHATSAPP_INCOMING_MESSAGES_QUEUE, jobId }, "WhatsApp incoming-message job stalled");
  });
  worker.on("error", (error) => {
    logger.error({ err: error }, "WhatsApp incoming-message worker error");
  });

  const close = async () => {
    const closeErrors: unknown[] = [];
    try {
      await worker.pause();
    } catch (error) {
      closeErrors.push(error);
    }
    const workerCloseResults = await Promise.allSettled([worker.close()]);
    closeErrors.push(
      ...workerCloseResults.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      ),
    );
    // Drain loop: new failures may enqueue while closing.
    while (pendingDeadLetterWrites.size > 0) {
      await Promise.allSettled([...pendingDeadLetterWrites]);
    }

    for (const closeResource of [
      () => deadLetterQueue.close(),
      () => lockRedis.quit(),
      () => queueRedis.quit(),
      () => workerRedis.quit(),
    ]) {
      try {
        await closeResource();
      } catch (error) {
        closeErrors.push(error);
      }
    }

    if (closeErrors.length > 0) {
      throw new AggregateError(
        closeErrors,
        "One or more worker resources failed to close",
      );
    }
  };

  let shutdownStarted = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    logger.info({ signal }, "Shutting down Zernio workers");
    void close().catch((error: unknown) => {
      logger.error({ err: error }, "Graceful worker shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await worker.waitUntilReady();
  } catch (error) {
    await close();
    throw error;
  }

  logger.info({ queue: WHATSAPP_INCOMING_MESSAGES_QUEUE }, "WhatsApp incoming-message worker ready");
}

void startWorker().catch((error: unknown) => {
  console.error("Failed to start Zernio workers:", error);
  process.exit(1);
});