// Job-browse module: detail / apply payloads + replay of the dynamic Job
// Stages. Owns selectedJobId transitions behind its seam.
import { sendJobText } from "../whatsapp-stage-messages.js";
import { idempotencyKeyFor } from "../whatsapp-conversation-state.js";
import { getJobById } from "../jobs/jobs.js";
import {
  APPLY_BUTTON_TITLE,
  DETAIL_BUTTON_TITLE,
  JOB_CARD_IMAGE_URL,
  applyConfirmationBody,
  applyPayload,
  fitTitle,
  fullDetailBody,
} from "../jobs/job-carousel.js";
import {
  pushResponse,
  type HandlerContext,
  type HandlerResult,
} from "./handler-context.js";

export async function handleJobRoute(
  ctx: HandlerContext,
  route: { stage: "detail"; jobId: string } | { stage: "apply"; jobId: string },
): Promise<HandlerResult> {
  const { job, apiKey, signal, state, logger } = ctx;
  try {
    const listing = await getJobById(route.jobId);
    signal.throwIfAborted();
    if (!listing) {
      await sendJobText(
        "Samahani, kazi hiyo haikupatikana.",
        [{ title: "Rudi nyuma", payload: "get_started" }],
        job,
        apiKey,
        idempotencyKeyFor(state.stage, job.eventId, "missing"),
        signal,
      );
      signal.throwIfAborted();
      return { clear: false };
    }
    if (route.stage === "detail") {
      await sendJobText(
        fullDetailBody(listing),
        [
          { title: APPLY_BUTTON_TITLE, payload: applyPayload(listing.id) },
          { title: "Rudi nyuma", payload: "get_started" },
        ],
        job,
        apiKey,
        idempotencyKeyFor("job_detail", job.eventId, "send", listing.id),
        signal,
        { imageUrl: listing.jobImage ?? JOB_CARD_IMAGE_URL },
      );
      signal.throwIfAborted();
      state.stage = "job_detail";
      state.promptSent = true;
      state.selectedJobId = listing.id;
      pushResponse(state, {
        stage: "job_detail",
        response: `${DETAIL_BUTTON_TITLE}: ${listing.title ?? listing.id}`,
        eventId: job.eventId,
      });
      logger.info({ eventId: job.eventId, jobId: listing.id }, "Sent job detail");
      return { clear: false };
    }
    // Omba ends the stage: share the poster's contact, then clear state so
    // the next free-text message starts a fresh get-started menu. No
    // buttons: with state gone a tap would have nowhere to resume to.
    // Old card buttons keep working statelessly through their payload ids.
    await sendJobText(
      applyConfirmationBody(listing.posterPhone ?? ""),
      [],
      job,
      apiKey,
      idempotencyKeyFor("job_apply", job.eventId, "send", listing.id),
      signal,
    );
    signal.throwIfAborted();
    logger.info(
      { eventId: job.eventId, jobId: listing.id, personKey: job.personKey },
      "Logged job application",
    );
    logger.info(
      { eventId: job.eventId, jobId: listing.id },
      "Cleared conversation state after job application",
    );
    return { clear: true };
  } catch (error) {
    logger.error(
      { err: error, eventId: job.eventId },
      "Job detail/apply handling failed",
    );
    throw error;
  }
}

export async function handleJobReplay(
  ctx: HandlerContext,
): Promise<HandlerResult | null> {
  const { job, apiKey, signal, state, logger } = ctx;
  if (
    (state.stage !== "job_detail" && state.stage !== "job_apply") ||
    !state.selectedJobId
  ) {
    return null;
  }
  try {
    const listing = await getJobById(state.selectedJobId);
    signal.throwIfAborted();
    if (listing) {
      await sendJobText(
        state.stage === "job_detail"
          ? fullDetailBody(listing)
          : `Omba limepokelewa kwa *${fitTitle(listing.title, 80)}*. Tutakujulisha hatua zinazofuata.`,
        state.stage === "job_detail"
          ? [
              { title: APPLY_BUTTON_TITLE, payload: applyPayload(listing.id) },
              { title: "Rudi nyuma", payload: "get_started" },
            ]
          : [{ title: "Rudi nyuma", payload: "get_started" }],
        job,
        apiKey,
        idempotencyKeyFor(state.stage, job.eventId, "send"),
        signal,
        state.stage === "job_detail"
          ? { imageUrl: listing.jobImage ?? JOB_CARD_IMAGE_URL }
          : undefined,
      );
      signal.throwIfAborted();
      logger.info(
        { eventId: job.eventId, stage: state.stage },
        "Replayed job stage message",
      );
      return { clear: false };
    }
  } catch (error) {
    logger.error({ err: error, eventId: job.eventId }, "Job replay failed");
  }
  return null;
}
