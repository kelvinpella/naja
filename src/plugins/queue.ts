import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { connectRedis } from "../services/redis-connection.js";
import {
  ZERNIO_QUEUE_JOB_OPTIONS,
  WHATSAPP_INCOMING_MESSAGES_QUEUE,
  type WhatsappIncomingMessageJob,
} from "../queues/zernio-events.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    whatsappIncomingMessagesQueue: Queue<WhatsappIncomingMessageJob>;
  }
}

const queuePlugin: FastifyPluginAsync = fp(
  async (app) => {
    let redis: Redis;
    try {
      redis = await connectRedis(
        process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
      );
    } catch (error) {
      app.log.error({ err: error }, "Failed to connect to Redis for queue plugin");
      throw new Error("Queue plugin: Redis unavailable. Check REDIS_URL.", {
        cause: error,
      });
    }
    // Dedicated connection for the Queue — never share app.redis with BullMQ.
    const queueRedis = await connectRedis(
      process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    );
    const queue = new Queue<WhatsappIncomingMessageJob>(
      WHATSAPP_INCOMING_MESSAGES_QUEUE,
      {
        connection: queueRedis,
        defaultJobOptions: ZERNIO_QUEUE_JOB_OPTIONS,
      },
    );

    app.decorate("redis", redis);
    app.decorate("whatsappIncomingMessagesQueue", queue);
    app.addHook("onClose", async () => {
      try {
        await queue.close();
      } finally {
        await redis.quit();
        await queueRedis.quit();
      }
    });
  },
  { name: "naja-queue" },
);

export default queuePlugin;