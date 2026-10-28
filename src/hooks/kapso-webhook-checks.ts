import type { FastifyReply, FastifyRequest } from "fastify";
import {
  KAPSO_MESSAGE_RECEIVED_EVENT,
  isValidKapsoSignature,
  type ParsedKapsoWebhookBody,
} from "../services/kapso-events.js";

export async function checkKapsoWebhook(
  request: FastifyRequest<{ Body: ParsedKapsoWebhookBody }>,
  reply: FastifyReply,
): Promise<void> {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) {
    request.log.error("KAPSO_WEBHOOK_SECRET is not configured");
    reply.code(500).send({ error: "Webhook is not configured" });
    return;
  }

  const signature = request.headers["x-webhook-signature"];
  if (
    !isValidKapsoSignature(
      request.body.rawBody,
      typeof signature === "string" ? signature : undefined,
      secret,
    )
  ) {
    reply.code(401).send({ error: "Invalid webhook signature" });
    return;
  }

  const { payload } = request.body;
  // A phone-number webhook can subscribe to several events; only inbound
  // customer messages belong to the menu worker.
  if (
    (typeof payload.event === "string" &&
      payload.event !== KAPSO_MESSAGE_RECEIVED_EVENT) ||
    payload.message?.kapso?.direction === "outbound"
  ) {
    reply.code(200).send({ received: true, ignored: true });
  }
}
