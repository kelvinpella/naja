import type { FastifyPluginAsync } from "fastify";
import {
  parseZernioWebhookBody,
  type ParsedZernioWebhookBody,
} from "../../services/zernio-events.js";
import { enqueueWhatsappIncomingMessage } from "../../queues/zernio-events.js";
import { checkZernioWebhook } from "../../hooks/zernio-webhook-checks.js";
import { toWhatsappMessageJob } from "../../services/zernio-event-mapper.js";

const zernioWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Encapsulated scope so parser overrides never leak globally.
  await app.register(async (scoped) => {
    scoped.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body, done) => {
        try {
          const buf = Buffer.isBuffer(body)
            ? body
            : Buffer.from(body as string, "utf8");
          if (buf.length > 1_048_576) {
            done(new Error("Webhook body too large"));
            return;
          }
          const rawBody = buf;
          done(null, parseZernioWebhookBody(rawBody));
        } catch (error) {
          done(error instanceof Error ? error : new Error("Invalid JSON"));
        }
      },
    );

    scoped.post<{ Body: ParsedZernioWebhookBody }>(
      "/zernio",
      {
        bodyLimit: 1_048_576,
        preHandler: async (request, reply) => {
          const result = await checkZernioWebhook(request, reply);
          if (reply.sent) return result;
        },
      },
      async (request, reply) => {
        const payload = request.body?.payload;
        if (!payload) {
          return reply.code(400).send({ error: "Missing webhook payload" });
        }
        const job = toWhatsappMessageJob(payload);
        if (!job) {
          request.log.warn(
            { eventId: payload.id },
            "WhatsApp message is missing sender identity, account, or conversation ID",
          );
          return reply.code(422).send({ error: "Incomplete WhatsApp message event" });
        }

        let deduplicated = false;
        try {
          ({ deduplicated } = await enqueueWhatsappIncomingMessage(
            scoped.whatsappIncomingMessagesQueue,
            job,
          ));
        } catch (error) {
          request.log.error(
            { err: error, eventId: payload.id },
            "Failed to enqueue WhatsApp message",
          );
          return reply.code(503).send({ error: "Message queue unavailable" });
        }

        return reply.code(202).send({ received: true, queued: !deduplicated, deduplicated });
      },
    );
  });
};

export default zernioWebhookRoutes;
