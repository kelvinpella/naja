import { createHmac, timingSafeEqual } from "node:crypto";
export type ZernioWebhookPayload = {
  id?: string;
  event?: string;
  account?: {
    accountId?: string;
    profileId?: string;
    platform?: string;
  };
  conversation?: { id?: string };
  message?: {
    id?: string;
    text?: string;
    sender?: {
      id?: string;
      phoneNumber?: string | null;
      businessScopedUserId?: string;
    };
    [key: string]: unknown;
  };
  metadata?: {
    interactiveId?: string;
    interactiveType?: string;
    buttonPayload?: string;
    flowResponseData?: Record<string, unknown>;
    flowResponseJson?: string;
    standby?: boolean | string | number;
    [key: string]: unknown;
  } | null;
};

export type ParsedZernioWebhookBody = {
  rawBody: Buffer;
  payload: ZernioWebhookPayload;
};

export function parseZernioWebhookBody(rawBody: Buffer): ParsedZernioWebhookBody {
  let payload: ZernioWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as ZernioWebhookPayload;
  } catch (error) {
    throw new Error("Invalid Zernio webhook JSON", { cause: error });
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Zernio webhook payload");
  }
  return {
    rawBody,
    payload,
  };
}

export function isValidZernioSignature(
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
