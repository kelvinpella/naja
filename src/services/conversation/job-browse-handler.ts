// Job-browse module: detail / apply payloads + replay of the dynamic Job
// Stages. Owns selectedJobId transitions behind its seam.
import { sendJobText } from "../whatsapp-stage-messages.js";
import { idempotencyKeyFor } from "../whatsapp-conversation-state.js";
import { getJobById } from "../jobs/jobs.js";
import {
  azamPayMnoCheckout,
  buildExternalId,
  detectAzamPayProvider,
  loadAzamPayConfig,
  toAzamPayMsisdn,
} from "../payments/azampay.js";
import {
  APPLY_BUTTON_TITLE,
  DETAIL_BUTTON_TITLE,
  JOB_CARD_IMAGE_URL,
  applyPayload,
  fitTitle,
  fullDetailBody,
} from "../jobs/job-carousel.js";
import {
  pushResponse,
  type HandlerContext,
  type HandlerResult,
} from "./handler-context.js";

export async function buildOmbaCheckoutBody(
  ctx: HandlerContext,
  jobId: string,
): Promise<string> {
  const { job, logger } = ctx;
  const config = loadAzamPayConfig();
  if (!config) {
    logger.warn(
      { eventId: job.eventId },
      "Omba tap skipped AzamPay checkout: sandbox credentials missing",
    );
    return "Samahani, huduma ya malipo haijawekwa. Jaribu tena baadaye.";
  }
  const msisdn = toAzamPayMsisdn(job.senderPhone);
  if (!msisdn) {
    logger.warn(
      { eventId: job.eventId },
      "Omba tap skipped AzamPay checkout: no sender phone",
    );
    return "Samahani, hatukuona namba yako ya simu. Tuma ujumbe tena kisha bonyeza Omba.";
  }
  const provider = detectAzamPayProvider(msisdn);
  const externalId = buildExternalId(jobId, job.eventId);
  logger.info(
    { eventId: job.eventId, jobId, provider, externalId, amount: config.testAmount },
    "Firing AzamPay sandbox MNO checkout",
  );
  const result = await azamPayMnoCheckout(config, {
    accountNumber: msisdn,
    provider,
    externalId,
    amount: config.testAmount,
    jobId,
  });
  if (result.ok) {
    logger.info(
      { eventId: job.eventId, jobId, transactionId: result.transactionId },
      "AzamPay sandbox checkout accepted",
    );
    return (
      `💳 Ombi la malipo limetumwa (TZS ${config.testAmount}).\n\n` +
      `Angalia simu yako ${msisdn} na uweke PIN kukamilisha malipo.\n` +
      `Kumbukumbu: ${result.transactionId}`
    );
  }
  logger.warn(
    { eventId: job.eventId, jobId, message: result.message },
    "AzamPay sandbox checkout failed",
  );
  return `Samahani, ombi la malipo limeshindwa: ${result.message}. Jaribu tena.`;
}

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
    // Omba ends the stage. Sandbox (issue #24): fire an AzamPay MNO
    // checkout STK push at the tapper's own number before clearing, so we
    // can verify the wallet prompt opens on a real phone.
    // Old card buttons keep working statelessly through their payload ids.
    const azamPayBody = await buildOmbaCheckoutBody(ctx, listing.id);
    await sendJobText(
      azamPayBody,
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
