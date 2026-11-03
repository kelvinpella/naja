import type { Job } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { mastra } from "../mastra/index.js";
import type { PostingJob } from "../queues/postings.js";
import {
  POST_JOB_FAILED_BODY,
  postJobPublished,
} from "../services/flows/post-job-flow.js";
import {
  failedNote,
  publishedNote,
  recordPostingNotes,
} from "../services/jobs/post-job-memory.js";
import {
  sendPostJobFlow,
  sendWhatsappReply,
} from "../services/whatsapp-reply.js";

const FAILURE_SEND_TIMEOUT_MS = 15_000;

export type PostingProcessorOptions = {
  kapsoApiKey: string;
  logger: FastifyBaseLogger;
};

/**
 * Runs one Posting and answers the Person about it. Everything inside the
 * workflow is retried by BullMQ; everything here is not, because a retried
 * send after a successful insert would publish the same Job twice.
 */
export function createPostingProcessor({
  kapsoApiKey,
  logger,
}: PostingProcessorOptions) {
  return async (job: Job<PostingJob>): Promise<void> => {
    const workflow = mastra.getWorkflow("postJob");
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: job.data,
      initialState: {
        eventId: job.data.eventId,
        personKey: job.data.personKey,
        title: job.data.details.title,
      },
    });

    if (result.status === "success") {
      const { jobId, title } = result.result;
      const published = postJobPublished(title);
      let sent = false;

      try {
        await sendWhatsappReply(
          job.data,
          { kind: "text", body: published },
          kapsoApiKey,
          logger,
          AbortSignal.timeout(FAILURE_SEND_TIMEOUT_MS),
        );
        sent = true;
      } catch (error) {
        // The Job is live; retrying for a message would insert it again.
        logger.error(
          { err: error, eventId: job.data.eventId, jobId },
          "Job published but the notification could not be sent",
        );
      }

      logger.info(
        { eventId: job.data.eventId, jobId },
        "Published job posting",
      );
      await recordPostingNotes(
        job.data.personKey,
        {
          user: publishedNote(title, jobId),
          assistant: sent ? published : undefined,
        },
        logger,
      );
      return;
    }

    const error =
      result.status === "failed"
        ? result.error
        : new Error(`Posting ended with status ${result.status}`);

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 < attempts) throw error;

    logger.error(
      { err: error, eventId: job.data.eventId, jobId: job.id },
      "Posting failed after every attempt; asking the Person to try again",
    );

    const title = job.data.details.title;
    let sent = false;
    try {
      await sendPostJobFlow(
        job.data,
        { body: POST_JOB_FAILED_BODY, prefill: job.data.details },
        kapsoApiKey,
        logger,
        AbortSignal.timeout(FAILURE_SEND_TIMEOUT_MS),
      );
      sent = true;
    } catch (sendError) {
      logger.error(
        { err: sendError, eventId: job.data.eventId },
        "Could not send the posting failure message",
      );
    }

    await recordPostingNotes(
      job.data.personKey,
      {
        user: failedNote(title, error.message),
        assistant: sent ? POST_JOB_FAILED_BODY : undefined,
      },
      logger,
    );
  };
}
