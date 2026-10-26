import { createHash } from "node:crypto";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import type { KapsoWebhookPayload } from "./kapso-events.js";
import { normalizePhoneDigits } from "./phone.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function toWhatsappMessageJob(
  payload: KapsoWebhookPayload,
): WhatsappIncomingMessageJob | null {
  const message = payload.message;
  if (!message) return null;

  // Only inbound customer messages drive the menu. Status events and our own
  // outbound echoes carry the same message object, so filter by direction.
  if (message.kapso?.direction === "outbound") return null;

  const eventId = asString(message.id);
  const phoneNumberId =
    asString(payload.phone_number_id) ??
    asString(payload.conversation?.phone_number_id);
  const senderPhone = normalizePhoneDigits(asString(message.from));
  const bsuid = asString(message.from_user_id);
  // Prefer the stable business-scoped user id so a phone-number change keeps
  // the same conversation; fall back to the phone number.
  const senderIdentity = bsuid ?? (senderPhone || undefined);

  if (
    !eventId ||
    !phoneNumberId ||
    !senderIdentity ||
    senderIdentity.length < 5
  ) {
    return null;
  }

  const personKey = createHash("sha256").update(senderIdentity).digest("hex");
  const interactive = message.interactive;
  const interactiveType = asString(interactive?.type);

  // Flow submissions arrive twice over: Meta's nfm_reply.response_json and
  // Kapso's decoded flow_response. Prefer the decoded object.
  const kapsoFlowResponse = message.kapso?.flow_response;
  const flowResponseData = asRecord(kapsoFlowResponse);
  const flowResponseJson =
    typeof kapsoFlowResponse === "string"
      ? kapsoFlowResponse
      : asString(interactive?.nfm_reply?.response_json);

  // Button taps (menu and carousel) arrive as button_reply.id; template
  // quick replies arrive as the legacy `button.payload`.
  const tapId =
    asString(interactive?.button_reply?.id) ??
    asString(interactive?.list_reply?.id) ??
    asString(message.button?.payload);

  return {
    eventId,
    personKey,
    phoneNumberId,
    recipient: senderPhone || bsuid || senderIdentity,
    recipientType: senderPhone ? "phone" : "bsuid",
    senderPhone: senderPhone || undefined,
    interactiveId: tapId,
    interactiveType,
    flowResponseData,
    flowResponseJson,
  };
}
