import { createHash } from "node:crypto";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import type { ZernioWebhookPayload } from "./zernio-events.js";
import { normalizePhoneDigits } from "./phone.js";

export function toWhatsappMessageJob(
  payload: ZernioWebhookPayload,
): WhatsappIncomingMessageJob | null {
  const sender = payload.message?.sender;
  const phoneNumber = normalizePhoneDigits(sender?.phoneNumber);
  const senderIdentity = sender?.businessScopedUserId ?? (phoneNumber || sender?.id);
  const accountId = payload.account?.accountId;
  const conversationId = payload.conversation?.id;
  const eventId = payload.id;

  if (
    !senderIdentity ||
    senderIdentity.length < 5 ||
    !accountId ||
    !conversationId ||
    !eventId
  ) {
    return null;
  }

  const personKey = createHash("sha256").update(senderIdentity).digest("hex");
  const interactiveId = payload.metadata?.interactiveId;
  const buttonPayload = payload.metadata?.buttonPayload;
  const interactiveType = payload.metadata?.interactiveType;
  const flowResponseData = payload.metadata?.flowResponseData;
  const flowResponseJson = payload.metadata?.flowResponseJson;

  // Carousel quick-reply taps arrive as buttonPayload, menu buttons as
  // interactiveId. Prefer interactiveId when both are present.
  const tapId =
    typeof interactiveId === "string"
      ? interactiveId
      : typeof buttonPayload === "string"
        ? buttonPayload
        : undefined;

  return {
    eventId,
    personKey,
    accountId,
    conversationId,
    senderPhone: phoneNumber || undefined,
    interactiveId: tapId,
    interactiveType:
      typeof interactiveType === "string" ? interactiveType : undefined,
    flowResponseData:
      typeof flowResponseData === "object" && flowResponseData !== null
        ? (flowResponseData as Record<string, unknown>)
        : undefined,
    flowResponseJson:
      typeof flowResponseJson === "string" ? flowResponseJson : undefined,
    standby: payload.metadata?.standby === true,
  };
}