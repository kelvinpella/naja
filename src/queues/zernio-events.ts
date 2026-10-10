import { createHash } from "node:crypto";
import type { JobsOptions, Queue } from "bullmq";

export const WHATSAPP_INCOMING_MESSAGES_QUEUE =
  "naja-whatsapp-incoming-messages";
export const WHATSAPP_INCOMING_MESSAGES_DEAD_LETTER_QUEUE =
  "naja-whatsapp-incoming-messages-dead-letter";
export const ZERNIO_QUEUE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 5000 },
};

export type WhatsappIncomingMessageJob = {
  eventId: string;
  personKey: string;
  accountId: string;
  conversationId: string;
  senderPhone?: string;
  interactiveId?: string;
  interactiveType?: string;
  flowResponseData?: Record<string, unknown>;
  flowResponseJson?: string;
  standby: boolean;
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

export function zernioEventJobId(eventId: string): string {
  if (!eventId?.trim()) {
    throw new Error("zernioEventJobId requires a non-empty eventId");
  }
  return `zernio-${createHash("sha256").update(eventId).digest("hex")}`;
}

export async function enqueueWhatsappIncomingMessage(
  queue: Queue<WhatsappIncomingMessageJob>,
  job: WhatsappIncomingMessageJob,
): Promise<{ deduplicated: boolean }> {
  if (!job.eventId?.trim()) {
    throw new Error("enqueueWhatsappIncomingMessage requires non-empty eventId");
  }
  if (!job.personKey?.trim()) {
    throw new Error("enqueueWhatsappIncomingMessage requires non-empty personKey");
  }
  const jobId = zernioEventJobId(job.eventId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    return { deduplicated: true };
  }
  const enqueuePromise = queue.add("incoming-message", job, {
    ...ZERNIO_QUEUE_JOB_OPTIONS,
    jobId,
  });
  // Avoid dangling rejection if timeout wins the race.
  enqueuePromise.catch(() => undefined);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      enqueuePromise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Zernio event queue write timed out")),
          3000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return { deduplicated: false };
}