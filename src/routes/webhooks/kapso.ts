import type { FastifyPluginAsync } from "fastify";
import {
  parseKapsoWebhookBody,
  type KapsoWebhookPayload,
  type ParsedKapsoWebhookBody,
} from "../../services/kapso-events.js";
import { enqueueWhatsappIncomingMessage } from "../../queues/whatsapp-events.js";
import { checkKapsoWebhook } from "../../hooks/kapso-webhook-checks.js";
import { toWhatsappMessageJob } from "../../services/kapso-event-mapper.js";

const kapsoWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      try {
        const rawBody = Buffer.isBuffer(body)
          ? body
          : Buffer.from(body, "utf8");
        done(null, parseKapsoWebhookBody(rawBody));
      } catch (error) {
        done(error instanceof Error ? error : new Error("Invalid JSON"));
      }
    },
  );

  app.post<{ Body: ParsedKapsoWebhookBody }>(
    "/kapso",
    {
      preHandler: async (request, reply) => checkKapsoWebhook(request, reply),
    },
    async (request, reply) => {
      const { payload } = request.body;
      const job = toWhatsappMessageJob(payload);
      if (!job) {
        request.log.warn(
          { eventId: (payload as KapsoWebhookPayload).message?.id },
          "WhatsApp message is missing id, phone number, or sender identity",
        );
        return reply
          .code(422)
          .send({ error: "Incomplete WhatsApp message event" });
      }

      try {
        await enqueueWhatsappIncomingMessage(
          app.whatsappIncomingMessagesQueue,
          job,
        );
      } catch (error) {
        request.log.error(
          { err: error, eventId: job.eventId },
          "Failed to enqueue WhatsApp message",
        );
        return reply.code(503).send({ error: "Message queue unavailable" });
      }

      return reply.code(200).send({ received: true, queued: true });
    },
  );
};

export default kapsoWebhookRoutes;
