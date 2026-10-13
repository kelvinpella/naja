// Find-Job module: keyword search submit, mixed-list entry, pagination.
// Owns listKeyword / listOffset transitions behind its seam.
import { sendJobText } from "../whatsapp-stage-messages.js";
import { idempotencyKeyFor } from "../whatsapp-conversation-state.js";
import { parseFindJobFlowPayload } from "../stages/find-job/flow.js";
import { selectFlowRaw } from "../stages/flow-payload.js";
import {
  EMPTY_MIXED_BODY,
  MIXED_HEADING,
  MORE_BATCH_HEADING,
  emptySearchBody,
  searchHeading,
  type ListOrigin,
} from "../jobs/job-carousel.js";
import { listJobs, searchJobs } from "../jobs/jobs.js";
import {
  pushResponse,
  sendJobPage,
  type HandlerContext,
  type HandlerResult,
} from "./handler-context.js";

export async function handleFindJobSubmit(
  ctx: HandlerContext,
): Promise<HandlerResult> {
  const { job, signal, state, logger } = ctx;
  const parsed = parseFindJobFlowPayload(selectFlowRaw(job));
  const keyword =
    typeof parsed.keyword === "string" ? parsed.keyword.trim() : "";
  logger.info(
    {
      eventId: job.eventId,
      stage: state.stage,
      keyword,
      flowResponse: job.flowResponseData ?? job.flowResponseJson,
    },
    "Received WhatsApp Flow response",
  );
  if (!keyword) {
    await sendJobText(
      emptySearchBody(keyword),
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      ctx.apiKey,
      idempotencyKeyFor(state.stage, job.eventId, "empty"),
      signal,
    );
    signal.throwIfAborted();
    return { clear: false };
  }
  try {
    const page = await searchJobs(keyword, 0, {
      excludePhone: job.senderPhone,
    });
    signal.throwIfAborted();
    state.listKeyword = keyword;
    state.listOffset = 0;
    await sendJobPage(
      page,
      { kind: "search", keyword },
      0,
      searchHeading(keyword),
      emptySearchBody(keyword),
      ctx,
      job.eventId,
    );
    signal.throwIfAborted();
    state.stage = "tafuta_kazi_search";
    state.promptSent = true;
    pushResponse(state, {
      stage: "tafuta_kazi_search",
      response: keyword,
      eventId: job.eventId,
    });
    logger.info(
      { eventId: job.eventId, keyword, results: page.jobs.length },
      "Sent job search results",
    );
  } catch (error) {
    logger.error(
      { err: error, eventId: job.eventId, keyword },
      "Job search failed",
    );
    await sendJobText(
      "Samahani, imeshindikana kupakia kazi. Jaribu tena.",
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      ctx.apiKey,
      idempotencyKeyFor(state.stage, job.eventId, "error"),
      signal,
    );
    signal.throwIfAborted();
  }
  return { clear: false };
}

export async function handleMixedEntry(
  ctx: HandlerContext,
): Promise<HandlerResult> {
  const { job, signal, state, logger } = ctx;
  const target = "tafuta_kazi_mixed" as const;
  try {
    const page = await listJobs(0, { excludePhone: job.senderPhone });
    signal.throwIfAborted();
    state.stage = target;
    state.promptSent = true;
    state.listOffset = 0;
    state.listKeyword = undefined;
    await sendJobPage(
      page,
      { kind: "mixed" },
      0,
      MIXED_HEADING,
      EMPTY_MIXED_BODY,
      ctx,
      job.eventId,
    );
    signal.throwIfAborted();
    pushResponse(state, {
      stage: target,
      response: "Kazi mpya mchanganyiko",
      eventId: job.eventId,
    });
    logger.info(
      { eventId: job.eventId, stage: target, results: page.jobs.length },
      "Sent mixed job list",
    );
  } catch (error) {
    logger.error({ err: error, eventId: job.eventId }, "Mixed job list failed");
    await sendJobText(
      "Samahani, imeshindikana kupakia kazi. Jaribu tena.",
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      ctx.apiKey,
      idempotencyKeyFor(target, job.eventId, "error"),
      signal,
    );
    signal.throwIfAborted();
    state.stage = target;
    state.promptSent = true;
  }
  return { clear: false };
}

export async function handlePagination(
  ctx: HandlerContext,
  origin: ListOrigin,
  offset: number,
): Promise<HandlerResult> {
  const { job, signal, state, logger } = ctx;
  try {
    const page =
      origin.kind === "search"
        ? await searchJobs(origin.keyword, offset, {
            excludePhone: job.senderPhone,
          })
        : await listJobs(offset, { excludePhone: job.senderPhone });
    signal.throwIfAborted();
    state.listOffset = offset;
    if (origin.kind === "search") state.listKeyword = origin.keyword;
    await sendJobPage(
      page,
      origin,
      offset,
      MORE_BATCH_HEADING,
      origin.kind === "search"
        ? emptySearchBody(origin.keyword)
        : EMPTY_MIXED_BODY,
      ctx,
      job.eventId,
    );
    signal.throwIfAborted();
    state.promptSent = true;
    pushResponse(state, {
      stage: state.stage,
      response: `Tizama kazi zaidi (offset ${offset})`,
      eventId: job.eventId,
    });
    logger.info({ eventId: job.eventId, offset }, "Sent next job batch");
  } catch (error) {
    logger.error({ err: error, eventId: job.eventId }, "Job pagination failed");
    throw error;
  }
  return { clear: false };
}
