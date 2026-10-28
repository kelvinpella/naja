import { createHmac, timingSafeEqual } from "node:crypto";

export const KAPSO_MESSAGE_RECEIVED_EVENT = "whatsapp.message.received";

// Inbound message shape: Meta Cloud API fields wrapped by Kapso (v2 payload).
// Kapso appends its own `kapso` object with direction/status/flow_response.
export type KapsoInboundMessage = {
  id?: string;
  from?: string;
  from_user_id?: string | null;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
    nfm_reply?: { response_json?: string; body?: string; name?: string };
  };
  kapso?: {
    direction?: string;
    status?: string;
    flow_response?: unknown;
    flow_token?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

export type KapsoWebhookPayload = {
  event?: string;
  phone_number_id?: string;
  message?: KapsoInboundMessage;
  conversation?: {
    id?: string;
    phone_number?: string;
    phone_number_id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ParsedKapsoWebhookBody = {
  rawBody: Buffer;
  payload: KapsoWebhookPayload;
};

export function parseKapsoWebhookBody(rawBody: Buffer): ParsedKapsoWebhookBody {
  return {
    rawBody,
    payload: JSON.parse(rawBody.toString("utf8")) as KapsoWebhookPayload,
  };
}

// Kapso signs with HMAC-SHA256(webhook_secret_key, raw_body) as hex in the
// X-Webhook-Signature header.
export function isValidKapsoSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
