import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { getKapsoClient, recipientTarget, withAbort } from "./kapso-client.js";
import {
  locationRequestButton,
  type WhatsappReply,
} from "./whatsapp-reply-contract.js";

// Meta rejects text bodies over 4096 characters, so longer replies are split.
// Interactive messages have no splitting option: the reply schema keeps them
// inside Meta's limits, and a reply that does not fit is sent as text instead.
export const MAX_REPLY_LENGTH = 4096;

function lastBreakAt(text: string, limit: number): number {
  const newline = text.lastIndexOf("\n", limit);
  if (newline > 0) return newline;
  const space = text.lastIndexOf(" ", limit);
  return space > 0 ? space : -1;
}

/** Splits a reply into WhatsApp-sized parts, preferring paragraph boundaries. */
export function splitReply(body: string, limit = MAX_REPLY_LENGTH): string[] {
  const text = body.trim();
  if (!text) return [];
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const breakAt = lastBreakAt(rest, limit);
    const cut = breakAt === -1 ? limit : breakAt;
    const part = rest.slice(0, cut).trim();
    if (part) parts.push(part);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Kapso/Meta have no idempotency header, so each part carries a stable key in
// biz_opaque_callback_data; a retried job can then be traced to a duplicate.
function replyCallbackData(eventId: string, part: number): string {
  const hash = createHash("sha256").update(eventId).digest("hex");
  return `naja-reply-${hash}-${part}`;
}

/**
 * Sends the Turn's single reply. Interactive replies go out whole, in one
 * message; text replies are split only when they exceed Meta's 4096 limit.
 */
export async function sendWhatsappReply(
  job: WhatsappIncomingMessageJob,
  reply: WhatsappReply,
  apiKey: string,
  logger: FastifyBaseLogger,
  signal: AbortSignal,
): Promise<number> {
  const kapso = getKapsoClient(apiKey);
  const target = { phoneNumberId: job.phoneNumberId, ...recipientTarget(job) };
  const callbackData = replyCallbackData(job.eventId, 0);

  switch (reply.kind) {
    case "text": {
      const parts = splitReply(reply.body);
      if (parts.length === 0) {
        logger.warn({ eventId: job.eventId }, "Agent produced an empty reply");
        return 0;
      }

      let sent = 0;
      for (const [index, part] of parts.entries()) {
        await withAbort(
          kapso.messages.sendText({
            ...target,
            body: part,
            bizOpaqueCallbackData: replyCallbackData(job.eventId, index),
          }),
          signal,
        );
        sent += 1;
      }

      return sent;
    }

    case "buttons":
      await withAbort(
        kapso.messages.sendInteractiveButtons({
          ...target,
          bodyText: reply.body,
          buttons: reply.buttons,
          bizOpaqueCallbackData: callbackData,
        }),
        signal,
      );
      return 1;

    case "list":
      await withAbort(
        kapso.messages.sendInteractiveList({
          ...target,
          bodyText: reply.body,
          buttonText: reply.buttonText,
          sections: [{ rows: reply.rows }],
          bizOpaqueCallbackData: callbackData,
        }),
        signal,
      );
      return 1;

    case "cta_url":
      await withAbort(
        kapso.messages.sendInteractiveCtaUrl({
          ...target,
          bodyText: reply.body,
          parameters: { displayText: reply.displayText, url: reply.url },
          bizOpaqueCallbackData: callbackData,
        }),
        signal,
      );
      return 1;

    case "location_request":
      await withAbort(
        kapso.messages.sendInteractiveLocationRequest({
          ...target,
          bodyText: reply.body,
          parameters: { requestMessage: locationRequestButton(reply) },
          bizOpaqueCallbackData: callbackData,
        }),
        signal,
      );
      return 1;
  }
}
