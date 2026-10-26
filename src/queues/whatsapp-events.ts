import { createHash } from "node:crypto";
import type { JobsOptions, Queue } from "bullmq";

export const WHATSAPP_INCOMING_MESSAGES_QUEUE =
  "naja-whatsapp-incoming-messages";
export const WHATSAPP_INCOMING_MESSAGES_DEAD_LETTER_QUEUE =
  "naja-whatsapp-incoming-messages-dead-letter";
export const WHATSAPP_QUEUE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 5000 },
};

// Kapso addresses sends with phone_number_id + one of `to` (wa_id) or
// `recipient` (BSUID). Keep both kinds explicit so a username-only contact
// never gets mistaken for a phone number.
export type WhatsappRecipientType = "phone" | "bsuid";

export type WhatsappIncomingMessageJob = {
  // Kapso/Meta message id (wamid). It is both the idempotency source and
  // the target of read receipts + typing indicators.
  eventId: string;
  personKey: string;
  phoneNumberId: string;
  recipient: string;
  recipientType: WhatsappRecipientType;
  // Normalized phone number when one is available. BSUID-only contacts
  // leave this unset, so payment/job paths must tolerate a missing number.
  senderPhone?: string;
  interactiveId?: string;
  interactiveType?: string;
  flowResponseData?: Record<string, unknown>;
  flowResponseJson?: string;
};

export type WhatsappIncomingMessageDeadLetterJob = {
  originalJobId: string;
  eventId: string;
  personKey: string;
  attemptsMade: number;
  failedReason: string;
  failedAt: string;
  data: WhatsappIncomingMessageJob;
};

export function whatsappEventJobId(eventId: string): string {
  return `whatsapp-${createHash("sha256").update(eventId).digest("hex")}`;
}

export async function enqueueWhatsappIncomingMessage(
  queue: Queue<WhatsappIncomingMessageJob>,
  job: WhatsappIncomingMessageJob,
): Promise<void> {
  const enqueuePromise = queue.add("incoming-message", job, {
    ...WHATSAPP_QUEUE_JOB_OPTIONS,
    jobId: whatsappEventJobId(job.eventId),
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      enqueuePromise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("WhatsApp event queue write timed out")),
          3000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
