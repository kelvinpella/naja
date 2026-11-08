import type { Job, Queue } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import type { PostingJob } from "../queues/postings.js";
import { isPostJobFlowToken } from "../services/flows/post-job-flow.js";
import { resolveJobsReply } from "../services/jobs/jobs-reply.js";
import {
  handlePostJobSubmission,
  PostingEnqueueError,
} from "../services/jobs/post-job-intake.js";
import { SenderLockLostError, withPersonLock } from "../services/person-lock.js";
import { sendTypingIndicator } from "../services/kapso-typing-indicator.js";
import {
  FlowCompletionUnavailableError,
  hydrateFlowCompletion,
  isFlowCompletion,
} from "../services/whatsapp-flow-completion.js";
import { generateWhatsappReply } from "../services/whatsapp-agent.js";
import { sendWhatsappReply } from "../services/whatsapp-reply.js";
import type { WhatsappReply } from "../services/whatsapp-reply-contract.js";

const PROCESSING_TIMEOUT_MS = 90_000;
const FALLBACK_SEND_TIMEOUT_MS = 15_000;

// Sent when a Submission never reached the Posting queue, after every retry:
// the only failure where the job really will not be published. A receipt that
// failed to send is not that — its Posting will still report the outcome.
const NOT_QUEUED_REPLY =
  "Samahani, imeshindikana kutangaza kazi. Tafadhali jaribu tena.";

// When the model turn fails (every free tier rate-limited, upstream outage,
// or the processing budget running out) the person is still waiting on
// WhatsApp, so they get this instead of silence. The job then completes
// rather than retrying: a retry would spend another budget on a model that
// already failed and could deliver the apology twice.
const FALLBACK_REPLY = [
  "Samahani, kuna hitilafu ya muda kwenye mfumo. Tafadhali jaribu tena baada ya dakika chache.",
  "Sorry, something went wrong on our side. Please try again in a few minutes.",
].join("\n\n");

/** Whether BullMQ will run this job again after the current attempt. */
function hasAttemptsLeft(job: Job<WhatsappIncomingMessageJob>): boolean {
  return job.attemptsMade + 1 < (job.opts.attempts ?? 1);
}

export type WhatsappEventProcessorOptions = {
  redis: Redis;
  kapsoApiKey: string;
  logger: FastifyBaseLogger;
  postings: Queue<PostingJob>;
};

export function createWhatsappEventProcessor({
  redis,
  kapsoApiKey,
  logger,
  postings,
}: WhatsappEventProcessorOptions) {
  /**
   * A fixed message, sent on its own budget: callers use it exactly when the
   * Turn's signal may already be aborted, so it cannot borrow that signal.
   */
  const sendFixedText = (
    incoming: WhatsappIncomingMessageJob,
    body: string,
  ): Promise<number> =>
    sendWhatsappReply(
      incoming,
      { kind: "text", body },
      kapsoApiKey,
      logger,
      AbortSignal.timeout(FALLBACK_SEND_TIMEOUT_MS),
    );

  /** The conversational path: one model Turn, one reply. */
  const answerWithModel = async (
    incoming: WhatsappIncomingMessageJob,
    signal: AbortSignal,
  ): Promise<void> => {
    let reply: WhatsappReply | null;
    try {
      reply = await generateWhatsappReply(
        incoming,
        signal,
        logger,
        kapsoApiKey,
      );
      // Not every provider honours the abort signal, so a turn that outlived
      // the processing budget counts as failed even when it returns text.
      signal.throwIfAborted();
    } catch (error) {
      if (signal.reason instanceof SenderLockLostError) throw error;

      logger.error(
        { err: error, eventId: incoming.eventId, personKey: incoming.personKey },
        "Agent turn failed; sending the fallback reply",
      );
      await sendFixedText(incoming, FALLBACK_REPLY);
      return;
    }

    // A Turn that produced only a broken reply envelope has nothing safe to
    // send, so it gets the same apology as a failed Turn rather than silence.
    if (!reply) {
      logger.warn(
        { eventId: incoming.eventId, personKey: incoming.personKey },
        "Agent produced no usable reply; sending the fallback reply",
      );
      await sendFixedText(incoming, FALLBACK_REPLY);
      return;
    }

    // A `jobs` reply names ids; the rows, images and card text come from the
    // database, so nothing the model wrote is rendered as a card.
    const resolved = await resolveJobsReply(reply, logger);
    await sendWhatsappReply(incoming, resolved, kapsoApiKey, logger, signal);
  };

  /**
   * A Flow completion is a data path, not a Turn: it is answered by code and
   * never reaches the model (ADR 0006). It queues a Posting and gets out of
   * the way, so the receipt is not waiting on the photo, the insert or
   * moderation (ADR 0007).
   */
  const handleFlowCompletion = async (
    job: Job<WhatsappIncomingMessageJob>,
    signal: AbortSignal,
  ): Promise<void> => {
    try {
      // Kapso forwards Meta's stripped-down completion, so the token and the
      // answers are read back here, before anything is sent.
      const incoming = await hydrateFlowCompletion(job.data, {
        apiKey: kapsoApiKey,
        logger,
        signal,
      });

      if (!isPostJobFlowToken(incoming.flowToken)) {
        // Somebody else's Flow, or a completion with no answers: nothing to
        // queue, but the Person still deserves the model's help.
        logger.warn(
          { eventId: job.data.eventId, flowToken: incoming.flowToken },
          "Flow completion is not the post job Flow; handing it to the model",
        );
        await answerWithModel(incoming, signal);
        return;
      }

      await handlePostJobSubmission({
        job: incoming,
        apiKey: kapsoApiKey,
        logger,
        signal,
        postings,
      });
    } catch (error) {
      if (signal.reason instanceof SenderLockLostError) throw error;

      // Retrying is only useful while BullMQ has attempts left; the last
      // attempt is where someone has to say something.
      if (hasAttemptsLeft(job)) throw error;

      if (
        !(error instanceof PostingEnqueueError) &&
        !(error instanceof FlowCompletionUnavailableError)
      ) {
        // The Posting is queued and will report its own outcome, so an
        // apology here would contradict the message that is coming.
        logger.error(
          { err: error, eventId: job.data.eventId, jobId: job.id },
          "Post job receipt failed after every attempt; the Posting still runs",
        );
        return;
      }

      logger.error(
        { err: error, eventId: job.data.eventId, jobId: job.id },
        "Post job submission never reached the queue; sending the apology",
      );
      await sendFixedText(job.data, NOT_QUEUED_REPLY);
    }
  };

  return async (job: Job<WhatsappIncomingMessageJob>): Promise<void> => {
    await withPersonLock({
      redis,
      personKey: job.data.personKey,
      logger,
      timeoutMs: PROCESSING_TIMEOUT_MS,
      run: async (signal) => {
        // Best effort: a typing bubble that fails must not fail the turn.
        void sendTypingIndicator(
          job.data.phoneNumberId,
          job.data.eventId,
          kapsoApiKey,
          logger,
          signal,
        ).catch(() => {});

        const isCompletion =
          isFlowCompletion(job.data) || isPostJobFlowToken(job.data.flowToken);
        if (isCompletion) {
          await handleFlowCompletion(job, signal);
          return;
        }

        await answerWithModel(job.data, signal);
      },
    });
  };
}
