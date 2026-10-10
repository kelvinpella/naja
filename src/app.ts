import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import queuePlugin from "./plugins/queue.js";
import zernioWebhookRoutes from "./routes/webhooks/zernio.js";
import { validateSupabaseConfig } from "./services/jobs/supabase-client.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  try {
    validateSupabaseConfig();
  } catch (error) {
    app.log.warn({ err: error }, "Supabase not configured at boot — job routes will fail until env is set");
  }

  app.get(
    "/",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              service: { type: "string" },
              status: { type: "string" },
              description: { type: "string" },
            },
          },
        },
      },
    },
    async () => ({
      service: "Naja API",
      status: "ok",
      description: "Connecting Tanzanian households with trusted domestic workers.",
    }),
  );

  app.register(queuePlugin);
  app.register(zernioWebhookRoutes, { prefix: "/webhooks" });
  await app.ready();
  return app;
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw ?? "<unset>"}. Must be 1-65535.`);
  }
  return port;
}

async function start(): Promise<void> {
  const app = await buildApp();
  try {
    const port = parsePort(process.env.PORT);
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