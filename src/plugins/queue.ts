import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { connectRedis } from "../services/redis-connection.js";
import {
  WHATSAPP_QUEUE_JOB_OPTIONS,
  WHATSAPP_INCOMING_MESSAGES_QUEUE,
  type WhatsappIncomingMessageJob,
} from "../queues/whatsapp-events.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    whatsappIncomingMessagesQueue: Queue<WhatsappIncomingMessageJob>;
  }
}

const queuePlugin: FastifyPluginAsync = fp(
  async (app) => {
    const redis = await connectRedis(
      process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    );
    const queue = new Queue<WhatsappIncomingMessageJob>(
      WHATSAPP_INCOMING_MESSAGES_QUEUE,
      {
        connection: redis,
        defaultJobOptions: WHATSAPP_QUEUE_JOB_OPTIONS,
      },
    );

    app.decorate("redis", redis);
    app.decorate("whatsappIncomingMessagesQueue", queue);
    app.addHook("onClose", async () => {
      await queue.close();
      await redis.quit();
    });
  },
  { name: "naja-queue" },
);

export default queuePlugin;