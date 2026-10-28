import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import Fastify from "fastify";
import { connectRedis } from "./services/redis-connection.js";
import {
  WHATSAPP_INCOMING_MESSAGES_QUEUE,
  WHATSAPP_INCOMING_MESSAGES_DEAD_LETTER_QUEUE,
  type WhatsappIncomingMessageDeadLetterJob,
  type WhatsappIncomingMessageJob,
  whatsappEventJobId,
} from "./queues/whatsapp-events.js";
import { createWhatsappEventProcessor } from "./workers/whatsapp-events.js";
import { connectJobsTimingToLogger } from "./services/jobs/job-timing.js";
import { listJobs, setJobsCacheRedis } from "./services/jobs/jobs.js";

async function startWorker(): Promise<void> {
  const loggerHost = Fastify({ logger: true });
  const logger = loggerHost.log;
  connectJobsTimingToLogger(logger);
  const kapsoApiKey = process.env.KAPSO_API_KEY;
  if (!kapsoApiKey) {
    throw new Error("KAPSO_API_KEY is required for WhatsApp replies");
  }

  const redis = await connectRedis(
    process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  );
  setJobsCacheRedis(redis);
  // Prime the database connection and the first list page so the
  // first real reply skips cold-start setup. Best effort: a cold
  // Supabase at boot must not stop the worker.
  try {
    await listJobs(0);
  } catch (error) {
    logger.warn({ err: error }, "Job list warmup failed, continuing cold");
  }
  const deadLetterQueue = new Queue<WhatsappIncomingMessageDeadLetterJob>(
    WHATSAPP_INCOMING_MESSAGES_DEAD_LETTER_QUEUE,
    {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnFail: { age: 365 * 24 * 60 * 60, count: 5000 },
      },
    },
  );
  const pendingDeadLetterWrites = new Set<Promise<void>>();
  const processor = createWhatsappEventProcessor({
    redis,
    kapsoApiKey,
    logger,
  });

  const worker = new Worker<WhatsappIncomingMessageJob>(
    WHATSAPP_INCOMING_MESSAGES_QUEUE,
    (job: Job<WhatsappIncomingMessageJob>) => processor(job),
    {
      connection: redis,
        concurrency: 8,
      lockDuration: 60_000,
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, eventId: job?.data.eventId },
      "WhatsApp incoming-message job failed",
    );
    const attemptsExhausted =
      job && job.attemptsMade >= (job.opts.attempts ?? 1);
    const stalledLimitReached = error.message.includes(
      "stalled more than allowable limit",
    );
    if (!job || (!attemptsExhausted && !stalledLimitReached)) {
      return;
    }

    const deadLetterJob: WhatsappIncomingMessageDeadLetterJob = {
      originalJobId: String(job.id),
      eventId: job.data.eventId,
      personKey: job.data.personKey,
      attemptsMade: job.attemptsMade,
      failedReason: error.message,
      failedAt: new Date().toISOString(),
      data: job.data,
    };

    let write: Promise<void>;
    write = deadLetterQueue
      .add("whatsapp-incoming-message-failed", deadLetterJob, {
        jobId: `dead-${whatsappEventJobId(job.data.eventId)}`,
      })
      .then(() => undefined)
      .catch((deadLetterError: unknown) => {
        logger.error(
          {
            err: deadLetterError,
            eventId: job.data.eventId,
            originalJobId: job.id,
          },
          "Failed to enqueue dead-letter WhatsApp message",
        );
      })
      .finally(() => pendingDeadLetterWrites.delete(write));
    pendingDeadLetterWrites.add(write);
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ queue: WHATSAPP_INCOMING_MESSAGES_QUEUE, jobId }, "WhatsApp incoming-message job stalled");
  });
  worker.on("error", (error) => {
    logger.error({ err: error }, "WhatsApp incoming-message worker error");
  });

  const close = async () => {
    const closeErrors: unknown[] = [];
    const workerCloseResults = await Promise.allSettled([worker.close()]);
    closeErrors.push(
      ...workerCloseResults.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      ),
    );
    await Promise.allSettled([...pendingDeadLetterWrites]);

    for (const closeResource of [
      () => deadLetterQueue.close(),
      () => redis.quit(),
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
    logger.info({ signal }, "Shutting down Kapso workers");
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
  console.error("Failed to start Kapso workers:", error);
  process.exitCode = 1;
});