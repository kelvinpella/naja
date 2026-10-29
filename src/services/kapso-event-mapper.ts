import { createHash } from "node:crypto";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import type { KapsoInboundMessage, KapsoWebhookPayload } from "./kapso-events.js";
import { normalizePhoneDigits } from "./phone.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readLocation(
  message: KapsoInboundMessage,
): { latitude: number; longitude: number } | undefined {
  const location = message.location as
    | { latitude?: unknown; longitude?: unknown }
    | undefined;
  const latitude = asNumber(location?.latitude);
  const longitude = asNumber(location?.longitude);
  return latitude !== undefined && longitude !== undefined
    ? { latitude, longitude }
    : undefined;
}

function readCaption(message: KapsoInboundMessage): string | undefined {
  const media = message[message.type ?? ""] as
    | { caption?: unknown; filename?: unknown }
    | undefined;
  return asString(media?.caption) ?? asString(media?.filename);
}

function readInteractiveTitle(
  message: KapsoInboundMessage,
): string | undefined {
  const interactive = message.interactive;
  return (
    asString(interactive?.button_reply?.title) ??
    asString(interactive?.list_reply?.title) ??
    asString(message.button?.text)
  );
}

export function toWhatsappMessageJob(
  payload: KapsoWebhookPayload,
): WhatsappIncomingMessageJob | null {
  const message = payload.message;
  if (!message) return null;

  // Status events and our own outbound echoes carry the same message object,
  // so filter by direction before anything else.
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
  const messageType = asString(message.type);

  return {
    eventId,
    personKey,
    phoneNumberId,
    recipient: senderPhone || bsuid || senderIdentity,
    recipientType: senderPhone ? "phone" : "bsuid",
    senderPhone: senderPhone || undefined,
    text: asString(message.text?.body),
    messageType,
    caption: readCaption(message),
    interactiveTitle: readInteractiveTitle(message),
    location: readLocation(message),
  };
}
