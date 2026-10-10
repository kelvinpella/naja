import type { FastifyReply, FastifyRequest } from "fastify";
import {
  isValidZernioSignature,
  type ParsedZernioWebhookBody,
} from "../services/zernio-events.js";

export async function checkZernioWebhook(
  request: FastifyRequest<{ Body: ParsedZernioWebhookBody }>,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) {
    request.log.error("ZERNIO_WEBHOOK_SECRET is not configured");
    return reply.code(500).send({ error: "Webhook is not configured" });
  }

  const rawBody = request.body?.rawBody;
  if (!rawBody || rawBody.length === 0) {
    return reply.code(400).send({ error: "Missing webhook body" });
  }

  const signature = request.headers["x-zernio-signature"];
  if (
    !isValidZernioSignature(
      rawBody,
      typeof signature === "string" ? signature : undefined,
      secret,
    )
  ) {
    return reply.code(401).send({ error: "Invalid webhook signature" });
  }

  const { payload } = request.body;
  if (
    payload.event !== "message.received" ||
    payload.account?.platform !== "whatsapp"
  ) {
    return reply.code(200).send({ received: true, ignored: true });
  }
}