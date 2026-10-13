// Post-Job module: Tangaza submit — validate + media + create + cleanup.
// Owns the whole publish transition behind its seam.
import { sendJobText, sendStageMessage } from "../whatsapp-stage-messages.js";
import { idempotencyKeyFor } from "../whatsapp-conversation-state.js";
import { parsePostJobFlowPayload } from "../stages/post-job/flow.js";
import { selectFlowRaw } from "../stages/flow-payload.js";
import { toE164Phone } from "../phone.js";
import {
  createJob,
  deletePostJobImage,
  normalizePostJobMedia,
  uploadPostJobImage,
} from "../jobs/jobs.js";
import type {
  HandlerContext,
  HandlerResult,
} from "./handler-context.js";

export async function handlePostJobSubmit(
  ctx: HandlerContext,
): Promise<HandlerResult> {
  const { job, apiKey, logger, signal, state } = ctx;
  const submit = parsePostJobFlowPayload(selectFlowRaw(job));
  const title = typeof submit.title === "string" ? submit.title.trim() : "";
  const description =
    typeof submit.description === "string" ? submit.description.trim() : "";
  const area = typeof submit.area === "string" ? submit.area.trim() : "";
  const budgetRaw =
    typeof submit.budget === "string" || typeof submit.budget === "number"
      ? String(submit.budget).trim()
      : "";
  const budget = Number(budgetRaw);
  logger.info(
    {
      eventId: job.eventId,
      stage: state.stage,
      hasImage: submit.job_image != null,
      flowResponse: selectFlowRaw(job),
    },
    "Received Tangaza kazi Flow response",
  );

  const prefill = {
    init_values: { title, description, area, budget: budgetRaw },
  };
  const fail = async (reason: string): Promise<HandlerResult> => {
    await sendJobText(
      reason,
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      apiKey,
      idempotencyKeyFor(state.stage, job.eventId, "invalid"),
      signal,
    );
    signal.throwIfAborted();
    await sendStageMessage(
      "tangaza_kazi",
      job,
      apiKey,
      idempotencyKeyFor(state.stage, job.eventId, "resend"),
      signal,
      { prefill, logger },
    );
    signal.throwIfAborted();
    return { clear: false };
  };

  if (!title || title.length > 80)
    return fail("Samahani, jina la kazi haliko sahihi (herufi 1-80). Tafadhali jaribu tena.");
  if (!description || description.length > 500)
    return fail("Samahani, maelezo hayako sahihi (herufi 1-500). Tafadhali jaribu tena.");
  if (!area || area.length > 80)
    return fail("Samahani, eneo haliko sahihi (herufi 1-80). Tafadhali jaribu tena.");
  if (!budgetRaw || !Number.isFinite(budget) || budget <= 0 || budget > 999999999)
    return fail("Samahani, bajeti (Tsh) si sahihi. Andika namba, mfano 50000.");

  let jobImage: string | null = null;
  let jobImagePath: string | null = null;
  const media = normalizePostJobMedia(submit.job_image);
  if (media) {
    try {
      const uploaded = await uploadPostJobImage(media, {
        userPhone: job.senderPhone,
        personKey: job.personKey,
        accountId: job.accountId,
        apiKey,
        signal,
      });
      signal.throwIfAborted();
      jobImage = uploaded.url;
      jobImagePath = uploaded.path;
    } catch (error) {
      logger.error({ err: error, eventId: job.eventId }, "Job image upload failed");
      return fail("Samahani, imeshindikana kupakia picha (jpg/png, max 5MB). Jaribu tena.");
    }
  }

  try {
    // jobs.created_by_phone has an E.164 check constraint: senderPhone
    // arrives digits-only from the mapper, so re-add the leading +.
    const created = await createJob({
      title: title.slice(0, 80),
      description: description.slice(0, 500),
      area: area.slice(0, 80),
      budget: Math.floor(budget),
      jobImage,
      posterPhone: toE164Phone(job.senderPhone),
    });
    signal.throwIfAborted();
    const confirmedTitle = (created.title ?? title).slice(0, 80);
    // Terminal stage like job_apply: plain-text confirmation with no buttons,
    // then clear state so the next message starts a fresh get-started menu.
    await sendJobText(
      `✅ Tumepokea tangazo lako: *${confirmedTitle}*. Litachapishwa baada ya ukaguzi.`,
      [],
      job,
      apiKey,
      idempotencyKeyFor("tangaza_kazi", job.eventId, "created", created.id),
      signal,
    );
    signal.throwIfAborted();
    logger.info({ eventId: job.eventId, jobId: created.id }, "Created job posting");
    logger.info(
      { eventId: job.eventId, jobId: created.id },
      "Cleared conversation state after job posting",
    );
    return { clear: true };
  } catch (error) {
    logger.error({ err: error, eventId: job.eventId }, "Job insert failed");
    if (jobImagePath) await deletePostJobImage(jobImagePath);
    await sendJobText(
      "Samahani, imeshindikana kutangaza kazi. Jaribu tena.",
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      apiKey,
      idempotencyKeyFor(state.stage, job.eventId, "error"),
      signal,
    );
    signal.throwIfAborted();
    await sendStageMessage(
      "tangaza_kazi",
      job,
      apiKey,
      idempotencyKeyFor(state.stage, job.eventId, "resend"),
      signal,
      { prefill, logger },
    );
    signal.throwIfAborted();
    return { clear: false };
  }
}
