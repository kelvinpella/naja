import { createHash } from "node:crypto";
import type { JobsOptions, Queue } from "bullmq";
import type {
  PostJobFields,
  PostJobMedia,
} from "../services/flows/post-job-flow.js";
import type { WhatsappRecipientType } from "./whatsapp-events.js";

export const POSTINGS_QUEUE = "naja-postings";

// Three attempts, not the incoming queue's five: the Person already holds the
// receipt, so a retry is invisible while it lasts, and three failures still
// leave the apology arriving while it reads as an answer rather than a hang
// (ADR 0007).
export const POSTING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 5000 },
};

/**
 * One Posting: everything needed to publish a Submission and to answer the
 * Person about it, without reading back from the incoming job. The sender
 * fields are copied because the excuse for a failed Posting is a WhatsApp
 * message too.
 */
export type PostingJob = {
  eventId: string;
  personKey: string;
  phoneNumberId: string;
  recipient: string;
  recipientType: WhatsappRecipientType;
  senderPhone?: string;
  details: PostJobFields;
  media: PostJobMedia | null;
};

// Keyed on the completion's wamid, so a retried incoming job that enqueues
// again is a no-op instead of a second Posting for the same Submission.
export function postingJobId(eventId: string): string {
  return `posting-${createHash("sha256").update(eventId).digest("hex")}`;
}

export async function enqueuePosting(
  queue: Queue<PostingJob>,
  job: PostingJob,
): Promise<void> {
  await queue.add("posting", job, {
    ...POSTING_JOB_OPTIONS,
    jobId: postingJobId(job.eventId),
  });
}
