import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import queuePlugin from "./plugins/queue.js";
import kapsoWebhookRoutes from "./routes/webhooks/kapso.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/", async () => ({
    service: "Naja API",
    status: "ok",
    description: "Connecting Tanzanian households with trusted domestic workers.",
  }));

  app.register(queuePlugin);
  app.register(kapsoWebhookRoutes, { prefix: "/webhooks" });
  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  try {
    const port = Number(process.env.PORT ?? 3000);
    await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
    app.log.info({ port }, "Naja API listening");
  } catch (error) {
    app.log.error({ err: error }, "Naja API failed to start");
    try {
      await app.close();
    } catch (closeError) {
      app.log.error({ err: closeError }, "Failed to close after startup error");
    }
    process.exitCode = 1;
    return;
  }

  let shutdownStarted = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    app.log.info({ signal }, "Shutting down Naja API");
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, "Graceful API shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void start();
}