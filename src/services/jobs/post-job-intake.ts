import type { FastifyBaseLogger } from "fastify";
import type { Queue } from "bullmq";
import type { WhatsappIncomingMessageJob } from "../../queues/whatsapp-events.js";
import { enqueuePosting, type PostingJob } from "../../queues/postings.js";
import {
  postJobReceipt,
  validatePostJobSubmission,
} from "../flows/post-job-flow.js";
import { sendWhatsappReply } from "../whatsapp-reply.js";
import { normalizePostJobMedia } from "./job-image-storage.js";
import {
  recordPostingNotes,
  submissionNote,
} from "./post-job-memory.js";

export const INVALID_SUBMISSION_REPLY =
  "Samahani, baadhi ya taarifa haziko sahihi (jina, maelezo, eneo au bajeti). Tafadhali tangaza tena.";

/**
 * Raised when the Posting never reached the queue, which is the only failure
 * that means the job was not posted: the incoming job can then apologise
 * truthfully after its retries run out. A receipt that failed to send still
 * has a Posting behind it, so it must not be answered that way.
 */
export class PostingEnqueueError extends Error {
  constructor(cause: unknown) {
    super("Posting could not be queued", { cause });
  }
}

export type PostJobIntakeArgs = {
  job: WhatsappIncomingMessageJob;
  apiKey: string;
  logger: FastifyBaseLogger;
  signal: AbortSignal;
  postings: Queue<PostingJob>;
  // Injected so the ordering is testable without Redis, WhatsApp or Memory.
  deps?: {
    send?: typeof sendWhatsappReply;
    recordNotes?: typeof recordPostingNotes;
  };
};

/**
 * The incoming half of posting a job, and the whole of what the Person waits
 * on: validate, queue, tell them, record it. The photo, the insert and (later)
 * moderation happen in the Posting (ADR 0007), so the ordering here is what
 * keeps a retry safe — a retried enqueue is a no-op because its job id comes
 * from the completion's wamid.
 */
export async function handlePostJobSubmission({
  job,
  apiKey,
  logger,
  signal,
  postings,
  deps = {},
}: PostJobIntakeArgs): Promise<void> {
  const send = deps.send ?? sendWhatsappReply;
  const recordNotes = deps.recordNotes ?? recordPostingNotes;

  const details = validatePostJobSubmission(job.flowResponse);
  logger.info(
    {
      eventId: job.eventId,
      personKey: job.personKey,
      valid: details !== null,
      flowResponse: job.flowResponse,
    },
    "Received post job Flow submission",
  );

  if (!details) {
    await send(
      job,
      { kind: "text", body: INVALID_SUBMISSION_REPLY },
      apiKey,
      logger,
      signal,
    );
    return;
  }

  const posting: PostingJob = {
    eventId: job.eventId,
    personKey: job.personKey,
    phoneNumberId: job.phoneNumberId,
    recipient: job.recipient,
    recipientType: job.recipientType,
    senderPhone: job.senderPhone,
    details: {
      title: details.title,
      description: details.description,
      area: details.area,
      budget: details.budget,
    },
    media: normalizePostJobMedia(details.jobImage),
  };

  try {
    await enqueuePosting(postings, posting);
  } catch (error) {
    throw new PostingEnqueueError(error);
  }

  const receipt = postJobReceipt(details.title);
  await send(job, { kind: "text", body: receipt }, apiKey, logger, signal);

  await recordNotes(
    job.personKey,
    { user: submissionNote(posting.details), assistant: receipt },
    logger,
  );
}
