// The SDK captures `globalThis.fetch` when the client is constructed, so a
// cached client would also freeze that reference. Clients are cheap config
// objects (no connection pool), so build one per call site instead.
import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";

const DEFAULT_API_HOST = "https://api.kapso.ai";
// The Kapso proxy tracks the current Meta Graph version it exposes. Pinning
// it here keeps payloads stable if the SDK's default advances.
const GRAPH_VERSION = "v24.0";

export function kapsoApiBaseUrl(): string {
  const host = (process.env.KAPSO_API_BASE_URL ?? DEFAULT_API_HOST).replace(
    /\/+$/,
    "",
  );
  return `${host}/meta/whatsapp`;
}

export function getKapsoClient(apiKey: string): WhatsAppClient {
  return new WhatsAppClient({
    baseUrl: kapsoApiBaseUrl(),
    graphVersion: GRAPH_VERSION,
    kapsoApiKey: apiKey,
  });
}

// Kapso accepts `to` for phone numbers and `recipient` for BSUIDs. Exactly
// one must be present, so the job's recipientType decides the field.
export function recipientTarget(
  job: Pick<WhatsappIncomingMessageJob, "recipient" | "recipientType">,
): { to: string } | { recipient: string } {
  return job.recipientType === "bsuid"
    ? { recipient: job.recipient }
    : { to: job.recipient };
}

// The SDK has no per-request AbortSignal, so callers race the send against
// the job's abort signal. The underlying HTTP request may still settle later;
// the job itself stops waiting when its processing budget expires.
export function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
