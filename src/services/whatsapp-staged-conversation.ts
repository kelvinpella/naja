import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import {
  saveConversationState,
  clearConversationState,
  stageIdempotencyKey,
  type ConversationState,
} from "./whatsapp-conversation-state.js";
import {
  STAGE_MESSAGES,
  isStageId,
} from "./whatsapp-stages.js";
import {
  sendJobCarousel,
  sendJobText,
  sendStageMessage,
} from "./whatsapp-stage-messages.js";
import { parseFindJobSearchResponse } from "./stages/find-job/flow.js";
import {
  parsePostJobResponse,
  type PostJobSubmit,
} from "./stages/post-job/flow.js";
import {
  deletePostJobImage,
  normalizePostJobMedia,
  uploadPostJobImage,
} from "./jobs/job-image-storage.js";
import {
  createJob,
  getJobById,
  listJobs,
  searchJobs,
} from "./jobs/job-repository.js";
import {
  APPLY_BUTTON_TITLE,
  DETAIL_BUTTON_TITLE,
  EMPTY_MIXED_BODY,
  JOB_CARD_IMAGE_URL,
  MORE_BATCH_HEADING,
  MIXED_HEADING,
  applyConfirmationBody,
  applyPayload,
  buildJobListView,
  detailPayload,
  emptySearchBody,
  fullDetailBody,
  parseJobPayload,
  fitTitle,
  parseMorePayload,
  searchHeading,
  type ListOrigin,
} from "./jobs/job-carousel.js";
import type { JobPage } from "./jobs/job-types.js";

export type StagedConversationContext = {
  job: WhatsappIncomingMessageJob;
  redis: Redis;
  apiKey: string;
  logger: FastifyBaseLogger;
  signal: AbortSignal;
  key: string;
  state: ConversationState;
};

function responseLabel(stage: ConversationState["stage"]): string {
  const definition = STAGE_MESSAGES[stage];
  const button = definition.buttons.find((item) => item.payload === stage);
  if (button) return button.title;
  if (stage === "get_started") return "Get started";
  if (stage === "tafuta_kazi") return "Tafuta kazi";
  if (stage === "tafuta_kazi_search") return "Andika jina la kazi";
  if (stage === "tafuta_kazi_mixed") return "Kazi mpya mchanganyiko";
  if (stage === "tangaza_kazi") return "Tangaza kazi";
  if (stage === "vigezo_na_masharti") return "Vigezo na Masharti";
  if (stage === "job_detail") return "Soma zaidi";
  if (stage === "job_apply") return "Omba";
  return stage;
}

function now(): string {
  return new Date().toISOString();
}

async function pushResponse(
  redis: Redis,
  key: string,
  state: ConversationState,
  entry: { stage: ConversationState["stage"]; response: string; eventId: string },
): Promise<void> {
  if (!Array.isArray(state.responses)) {
    state.responses = [];
  }
  state.responses.push({ ...entry, receivedAt: now() });
  // Cap history over the 7-day TTL to bound Redis memory.
  if (state.responses.length > 100) {
    state.responses = state.responses.slice(-100);
  }
  await saveConversationState(redis, key, state);
}

async function sendJobPage(
  page: JobPage,
  origin: ListOrigin,
  offset: number,
  heading: string,
  emptyBody: string,
  ctx: StagedConversationContext,
  eventId: string,
): Promise<{ selectedJobId?: string }> {
  const { job, apiKey, logger, signal } = ctx;
  const view = buildJobListView(page, origin, offset, heading);
  if (view.kind === "empty") {
    await sendJobText(
      emptyBody,
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      apiKey,
      stageIdempotencyKey(ctx.state.stage, `${eventId}:empty`),
      signal,
    );
    logger.info({ eventId, origin }, "Sent empty job list message");
    return {};
  }
  if (view.kind === "single") {
    // One job can't form a carousel (Meta requires 2-10 cards), so it goes
    // out as a reply-buttons message with the same image header the cards
    // carry, keeping the look consistent across result counts.
    await sendJobText(
      fullDetailBody(view.job),
      [
        { title: APPLY_BUTTON_TITLE, payload: applyPayload(view.job.id) },
        { title: "Rudi nyuma", payload: "get_started" },
      ],
      job,
      apiKey,
      stageIdempotencyKey(ctx.state.stage, `${eventId}:single:${view.job.id}`),
      signal,
      { imageUrl: view.job.jobImage ?? JOB_CARD_IMAGE_URL },
    );
    logger.info({ eventId, jobId: view.job.id }, "Sent single job message");
    return { selectedJobId: view.job.id };
  }
  await sendJobCarousel(
    view.heading,
    view.cards,
    job,
    apiKey,
    stageIdempotencyKey(ctx.state.stage, `${eventId}:page:${offset}`),
    signal,
  );
  logger.info(
    { eventId, cards: view.cards.length, offset },
    "Sent job carousel",
  );
  return {};
}

function resolveFlowPayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>)["response_json"] === "object" &&
      (parsed as Record<string, unknown>)["response_json"] !== null &&
      !Array.isArray((parsed as Record<string, unknown>)["response_json"])
    ) {
      return (parsed as Record<string, unknown>)["response_json"];
    }
    return parsed;
  } catch {
    return raw;
  }
}

async function handlePostJobSubmit(
  ctx: StagedConversationContext,
  raw: unknown,
): Promise<void> {
  const { job, apiKey, logger, signal, redis, key, state } = ctx;
  let submit: PostJobSubmit;
  try {
    submit = parsePostJobResponse(resolveFlowPayload(raw));
  } catch (error) {
    logger.error({ err: error, eventId: job.eventId }, "Invalid Tangaza kazi Flow payload");
    await sendJobText(
      "Samahani, hatukuweza kusoma fomu yako. Tafadhali jaribu tena.",
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      apiKey,
      stageIdempotencyKey(state.stage, `${job.eventId}:invalid-payload`),
      signal,
    );
    return;
  }
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
      flowResponse: raw,
    },
    "Received Tangaza kazi Flow response",
  );

  const prefill = {
    init_values: { title, description, area, budget: budgetRaw },
  };
  const fail = async (reason: string): Promise<void> => {
    // Save first so an abort between the two sends doesn't lose validation state.
    state.promptEventId = job.eventId;
    state.promptSent = true;
    await saveConversationState(redis, key, state);
    await sendJobText(
      reason,
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      apiKey,
      stageIdempotencyKey(state.stage, `${job.eventId}:invalid`),
      signal,
    );
    signal.throwIfAborted();
    await sendStageMessage(
      "tangaza_kazi",
      job,
      apiKey,
      stageIdempotencyKey(state.stage, `${job.eventId}:resend`),
      signal,
      { prefill },
    );
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
    const digits = (job.senderPhone ?? "").replace(/\D/g, "");
    if (!digits) {
      logger.error({ eventId: job.eventId }, "Missing senderPhone for job posting");
      return fail("Samahani, hatukuweza kupata namba yako ya simu. Tafadhali jaribu tena.");
    }
    const created = await createJob({
      title: title.slice(0, 80),
      description: description.slice(0, 500),
      area: area.slice(0, 80),
      budget: Math.floor(budget),
      jobImage,
      // jobs.created_by_phone has an E.164 check constraint: senderPhone
      // arrives digits-only from the mapper, so re-add the leading +.
      posterPhone: digits ? `+${digits}` : null,
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
      stageIdempotencyKey("tangaza_kazi", `${job.eventId}:created:${created.id}`),
      signal,
    );
    signal.throwIfAborted();
    logger.info({ eventId: job.eventId, jobId: created.id }, "Created job posting");
    try {
      await clearConversationState(redis, key);
    } catch (error) {
      logger.error({ err: error, eventId: job.eventId }, "Failed to clear state after posting; retrying once");
      await clearConversationState(redis, key).catch((retryError: unknown) =>
        logger.error({ err: retryError, eventId: job.eventId }, "State clear retry failed after posting"),
      );
    }
    logger.info(
      { eventId: job.eventId, jobId: created.id },
      "Cleared conversation state after job posting",
    );
  } catch (error) {
    logger.error({ err: error, eventId: job.eventId }, "Job insert failed");
    if (jobImagePath) {
      try {
        await deletePostJobImage(jobImagePath);
      } catch (cleanupError) {
        logger.error({ err: cleanupError, eventId: job.eventId }, "Failed to clean up job image after insert failure");
      }
    }
    await sendJobText(
      "Samahani, imeshindikana kutangaza kazi. Jaribu tena.",
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      apiKey,
      stageIdempotencyKey(state.stage, `${job.eventId}:error`),
      signal,
    );
    signal.throwIfAborted();
    await sendStageMessage(
      "tangaza_kazi",
      job,
      apiKey,
      stageIdempotencyKey(state.stage, `${job.eventId}:resend`),
      signal,
      { prefill },
    );
    signal.throwIfAborted();
    await saveConversationState(redis, key, state);
  }
}

export async function handleStagedConversation({
  job,
  redis,
  apiKey,
  logger,
  signal,
  key,
  state,
}: StagedConversationContext): Promise<void> {
  const ctx: StagedConversationContext = {
    job,
    redis,
    apiKey,
    logger,
    signal,
    key,
    state,
  };

  // No prompt sent yet (new conversation race or migrated state): send current stage.
  // Use the current eventId for idempotency — the stored promptEventId may already
  // have been sent, which would dedupe this resend to a no-op.
  if (!state.promptSent) {
    // Dynamic detail stages can't replay statically — re-render from selection.
    if ((state.stage === "job_detail" || state.stage === "job_apply") && state.selectedJobId) {
      const listing = await getJobById(state.selectedJobId).catch((error: unknown) => {
        logger.error({ err: error, eventId: job.eventId }, "Job re-render failed");
        return null;
      });
      if (listing) {
        await sendJobText(
          fullDetailBody(listing),
          [
            { title: APPLY_BUTTON_TITLE, payload: applyPayload(listing.id) },
            { title: "Rudi nyuma", payload: "get_started" },
          ],
          job,
          apiKey,
          stageIdempotencyKey("job_detail", `${job.eventId}:${listing.id}`),
          signal,
          { imageUrl: listing.jobImage ?? JOB_CARD_IMAGE_URL },
        );
        signal.throwIfAborted();
        state.promptSent = true;
        state.promptEventId = job.eventId;
        await saveConversationState(redis, key, state);
        return;
      }
    }
    await sendStageMessage(
      state.stage,
      { ...job, eventId: state.promptEventId },
      apiKey,
      stageIdempotencyKey(state.stage, job.eventId),
      signal,
    );
    signal.throwIfAborted();
    state.promptSent = true;
    state.promptEventId = job.eventId;
    await saveConversationState(redis, key, state);
    logger.info(
      { eventId: state.promptEventId, stage: state.stage },
      "Sent WhatsApp stage message",
    );
    return;
  }

  // Flow submission (nfm_reply): tangaza_kazi posts a job, otherwise search.
  if (job.interactiveType === "nfm_reply") {
    if (state.stage === "tangaza_kazi") {
      await handlePostJobSubmit(ctx, job.flowResponseData ?? job.flowResponseJson);
      return;
    }
    let parsed: { keyword?: unknown };
    try {
      parsed = parseFindJobSearchResponse(
        job.flowResponseData ?? job.flowResponseJson,
      );
    } catch (error) {
      logger.error({ err: error, eventId: job.eventId }, "Invalid Tafuta kazi Flow payload");
      await sendJobText(
        "Samahani, hatukuweza kusoma ulichoandika. Tafadhali jaribu tena.",
        [{ title: "Rudi nyuma", payload: "get_started" }],
        job,
        apiKey,
        stageIdempotencyKey(state.stage, `${job.eventId}:invalid-payload`),
        signal,
      );
      return;
    }
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
        apiKey,
        stageIdempotencyKey(state.stage, `${job.eventId}:empty`),
        signal,
      );
      signal.throwIfAborted();
      await saveConversationState(redis, key, state);
      return;
    }
    try {
      const page = await searchJobs(keyword, 0, {
        excludePhone: job.senderPhone,
      });
      signal.throwIfAborted();
      const { selectedJobId } = await sendJobPage(
        page,
        { kind: "search", keyword },
        0,
        searchHeading(keyword),
        emptySearchBody(keyword),
        ctx,
        job.eventId,
      );
      signal.throwIfAborted();
      state.listKeyword = keyword;
      state.listOffset = 0;
      if (selectedJobId) state.selectedJobId = selectedJobId;
      state.stage = "tafuta_kazi_search";
      state.promptSent = true;
      await pushResponse(redis, key, state, {
        stage: "tafuta_kazi_search",
        response: keyword,
        eventId: job.eventId,
      });
      logger.info(
        { eventId: job.eventId, keyword, results: page.jobs.length },
        "Sent job search results",
      );
    } catch (error) {
      // User-facing error reply: intentionally no retry (job succeeds).
      logger.error(
        { err: error, eventId: job.eventId, keyword },
        "Job search failed",
      );
      await sendJobText(
        "Samahani, imeshindikana kupakia kazi. Jaribu tena.",
        [{ title: "Rudi nyuma", payload: "get_started" }],
        job,
        apiKey,
        stageIdempotencyKey(state.stage, `${job.eventId}:error`),
        signal,
      );
      signal.throwIfAborted();
      await saveConversationState(redis, key, state);
    }
    return;
  }

  // Dynamic job payloads: Soma zaidi / Omba per job card.
  const jobRoute = parseJobPayload(job.interactiveId);
  if (jobRoute) {
    try {
      const listing = await getJobById(jobRoute.jobId);
      signal.throwIfAborted();
      if (!listing) {
        await sendJobText(
          "Samahani, kazi hiyo haikupatikana.",
          [{ title: "Rudi nyuma", payload: "get_started" }],
          job,
          apiKey,
          stageIdempotencyKey(state.stage, `${job.eventId}:missing`),
          signal,
        );
        signal.throwIfAborted();
        await saveConversationState(redis, key, state);
        return;
      }
      if (jobRoute.stage === "detail") {
        await sendJobText(
          fullDetailBody(listing),
          [
            { title: APPLY_BUTTON_TITLE, payload: applyPayload(listing.id) },
            { title: "Rudi nyuma", payload: "get_started" },
          ],
          job,
          apiKey,
          stageIdempotencyKey("job_detail", `${job.eventId}:${listing.id}`),
          signal,
          { imageUrl: listing.jobImage ?? JOB_CARD_IMAGE_URL },
        );
        signal.throwIfAborted();
        state.stage = "job_detail";
        state.promptSent = true;
        state.selectedJobId = listing.id;
        await pushResponse(redis, key, state, {
          stage: "job_detail",
          response: `${DETAIL_BUTTON_TITLE}: ${listing.title ?? listing.id}`,
          eventId: job.eventId,
        });
        logger.info(
          { eventId: job.eventId, jobId: listing.id },
          "Sent job detail",
        );
        return;
      }
      // Omba ends the stage: share the poster's contact, then clear state so
      // the next free-text message starts a fresh get-started menu. No
      // buttons: with state gone a tap would have nowhere to resume to.
      // Old card buttons keep working statelessly through their payload ids.
      if (!listing.posterPhone) {
        logger.error({ eventId: job.eventId, jobId: listing.id }, "Job listing missing posterPhone");
        await sendJobText(
          "Samahani, hatukuweza kupata mawasiliano ya muajiri. Jaribu kazi nyingine.",
          [{ title: "Rudi nyuma", payload: "get_started" }],
          job,
          apiKey,
          stageIdempotencyKey("job_apply", `${job.eventId}:${listing.id}:nopohone`),
          signal,
        );
        signal.throwIfAborted();
        await saveConversationState(redis, key, state);
        return;
      }
      await sendJobText(
        applyConfirmationBody(listing.posterPhone),
        [],
        job,
        apiKey,
        stageIdempotencyKey("job_apply", `${job.eventId}:${listing.id}`),
        signal,
      );
      signal.throwIfAborted();
      logger.info(
        { eventId: job.eventId, jobId: listing.id, personKey: job.personKey },
        "Logged job application",
      );
      try {
        await clearConversationState(redis, key);
      } catch (error) {
        logger.error({ err: error, eventId: job.eventId }, "Failed to clear state after apply; retrying once");
        await clearConversationState(redis, key).catch((retryError: unknown) =>
          logger.error({ err: retryError, eventId: job.eventId }, "State clear retry failed after apply"),
        );
      }
      logger.info(
        { eventId: job.eventId, jobId: listing.id },
        "Cleared conversation state after job application",
      );
    } catch (error) {
      logger.error(
        { err: error, eventId: job.eventId },
        "Job detail/apply handling failed",
      );
      await sendJobText(
        "Samahani, imeshindikana kupakia kazi. Jaribu tena.",
        [{ title: "Rudi nyuma", payload: "get_started" }],
        job,
        apiKey,
        stageIdempotencyKey(state.stage, `${job.eventId}:detail-error`),
        signal,
      ).catch(() => undefined);
      throw error;
    }
    return;
  }

  // Pagination: Tizama kazi zaidi loads the next batch.
  const more = parseMorePayload(job.interactiveId);
  if (more) {
    // Validate cursor from tap: clamp offset, cap keyword length.
    const safeOffset = Math.min(Math.max(0, more.offset), 10_000);
    const origin: ListOrigin =
      more.origin.kind === "search"
        ? { kind: "search", keyword: more.origin.keyword.slice(0, 100) }
        : more.origin;
    try {
      const page =
        origin.kind === "search"
          ? await searchJobs(origin.keyword, safeOffset, {
              excludePhone: job.senderPhone,
            })
          : await listJobs(safeOffset, { excludePhone: job.senderPhone });
      signal.throwIfAborted();
      const { selectedJobId } = await sendJobPage(
        page,
        origin,
        safeOffset,
        MORE_BATCH_HEADING,
        origin.kind === "search"
          ? emptySearchBody(origin.keyword)
          : EMPTY_MIXED_BODY,
        ctx,
        job.eventId,
      );
      signal.throwIfAborted();
      state.listOffset = safeOffset;
      if (origin.kind === "search") state.listKeyword = origin.keyword;
      if (selectedJobId) state.selectedJobId = selectedJobId;
      await pushResponse(redis, key, state, {
        stage: state.stage,
        response: `Tizama kazi zaidi (offset ${more.offset})`,
        eventId: job.eventId,
      });
      logger.info(
        { eventId: job.eventId, offset: more.offset },
        "Sent next job batch",
      );
    } catch (error) {
      logger.error(
        { err: error, eventId: job.eventId },
        "Job pagination failed",
      );
      await sendJobText(
        "Samahani, imeshindikana kupakia kazi zaidi. Jaribu tena.",
        [{ title: "Rudi nyuma", payload: "get_started" }],
        job,
        apiKey,
        stageIdempotencyKey(state.stage, `${job.eventId}:more-error`),
        signal,
      ).catch(() => undefined);
      throw error;
    }
    return;
  }

  // Last tap wins: any recognized Stage payload moves to that Stage.
  if (isStageId(job.interactiveId)) {
    const target = job.interactiveId;
    // Kazi mchanganyiko entry renders the live job list carousel.
    if (target === "tafuta_kazi_mixed") {
      try {
        const page = await listJobs(0, { excludePhone: job.senderPhone });
        signal.throwIfAborted();
        state.stage = target;
        state.promptSent = true;
        state.listOffset = 0;
        state.listKeyword = undefined;
        const { selectedJobId } = await sendJobPage(
          page,
          { kind: "mixed" },
          0,
          MIXED_HEADING,
          EMPTY_MIXED_BODY,
          ctx,
          job.eventId,
        );
        signal.throwIfAborted();
        if (selectedJobId) state.selectedJobId = selectedJobId;
        await pushResponse(redis, key, state, {
          stage: target,
          response: responseLabel(target),
          eventId: job.eventId,
        });
        logger.info(
          { eventId: job.eventId, stage: target, results: page.jobs.length },
          "Sent mixed job list",
        );
      } catch (error) {
        logger.error(
          { err: error, eventId: job.eventId },
          "Mixed job list failed",
        );
        await sendJobText(
          "Samahani, imeshindikana kupakia kazi. Jaribu tena.",
          [{ title: "Rudi nyuma", payload: "get_started" }],
          job,
          apiKey,
          stageIdempotencyKey(target, `${job.eventId}:error`),
          signal,
        );
        signal.throwIfAborted();
        state.stage = target;
        state.promptSent = true;
        await saveConversationState(redis, key, state);
      }
      return;
    }
    // Terms Stage is terminal like Omba / Tangaza submit: respond with the
    // T&C, then clear state so the next message starts a fresh get-started
    // menu. The Rudi nyuma Option still works statelessly
    // (processWhatsappMessage enters any requested Stage with no stored
    // state), as do taps on other old messages.
    if (target === "vigezo_na_masharti") {
      await sendStageMessage(
        target,
        job,
        apiKey,
        stageIdempotencyKey(target, job.eventId),
        signal,
      );
      signal.throwIfAborted();
      await clearConversationState(redis, key).catch((error: unknown) =>
        logger.error({ err: error, eventId: job.eventId }, "Failed to clear state after terms; will retry on next message"),
      );
      logger.info(
        { eventId: job.eventId, stage: target },
        "Cleared conversation state after terms stage",
      );
      return;
    }
    await sendStageMessage(
      target,
      job,
      apiKey,
      stageIdempotencyKey(target, job.eventId),
      signal,
    );
    signal.throwIfAborted();
    state.stage = target;
    state.promptSent = true;
    await pushResponse(redis, key, state, {
      stage: target,
      response: responseLabel(target),
      eventId: job.eventId,
    });
    logger.info(
      { eventId: job.eventId, stage: target },
      "Received WhatsApp stage selection",
    );
    return;
  }

  // Free text or unknown payload: replay current Stage (7-day resume included).
  // Dynamic job stages re-render from the stored selection.
  if ((state.stage === "job_detail" || state.stage === "job_apply") && state.selectedJobId) {
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
          stageIdempotencyKey(state.stage, job.eventId),
          signal,
          state.stage === "job_detail"
            ? { imageUrl: listing.jobImage ?? JOB_CARD_IMAGE_URL }
            : undefined,
        );
        signal.throwIfAborted();
        await saveConversationState(redis, key, state);
        logger.info(
          { eventId: job.eventId, stage: state.stage },
          "Replayed job stage message",
        );
        return;
      }
      // Selected job was deleted — tell the user instead of falling through to a static stage.
      await sendJobText(
        "Samahani, kazi hiyo haikupatikana tena. Chagua kazi nyingine.",
        [{ title: "Rudi nyuma", payload: "get_started" }],
        job,
        apiKey,
        stageIdempotencyKey(state.stage, `${job.eventId}:deleted`),
        signal,
      );
      signal.throwIfAborted();
      state.selectedJobId = undefined;
      await saveConversationState(redis, key, state);
      return;
    } catch (error) {
      logger.error({ err: error, eventId: job.eventId }, "Job replay failed");
    }
  }
  // Search/mixed stages carry list context — re-render the carousel, don't replay a static stage.
  if (state.stage === "tafuta_kazi_search" || state.stage === "tafuta_kazi_mixed") {
    try {
      const keyword = (state.listKeyword ?? "").slice(0, 100);
      const offset = Math.min(Math.max(0, state.listOffset ?? 0), 10_000);
      const page =
        state.stage === "tafuta_kazi_search" && keyword
          ? await searchJobs(keyword, offset, { excludePhone: job.senderPhone })
          : await listJobs(offset, { excludePhone: job.senderPhone });
      signal.throwIfAborted();
      const origin: ListOrigin =
        state.stage === "tafuta_kazi_search" && keyword ? { kind: "search", keyword } : { kind: "mixed" };
      const { selectedJobId } = await sendJobPage(
        page,
        origin,
        offset,
        state.stage === "tafuta_kazi_search" ? searchHeading(keyword) : MIXED_HEADING,
        state.stage === "tafuta_kazi_search" ? emptySearchBody(keyword) : EMPTY_MIXED_BODY,
        ctx,
        job.eventId,
      );
      signal.throwIfAborted();
      if (selectedJobId) state.selectedJobId = selectedJobId;
      await saveConversationState(redis, key, state);
      logger.info({ eventId: job.eventId, stage: state.stage }, "Re-rendered job list for free text");
      return;
    } catch (error) {
      logger.error({ err: error, eventId: job.eventId }, "List re-render failed, falling back to static replay");
    }
  }
  // Terms Stage is terminal: a lingering saved terms stage replays the T&C
  // once, then clears so the next message starts fresh (same as selection).
  if (state.stage === "vigezo_na_masharti") {
    await sendStageMessage(
      state.stage,
      job,
      apiKey,
      stageIdempotencyKey(state.stage, job.eventId),
      signal,
    );
    signal.throwIfAborted();
    await clearConversationState(redis, key).catch((error: unknown) =>
      logger.error({ err: error, eventId: job.eventId }, "Failed to clear terms state; will retry on next message"),
    );
    logger.info(
      { eventId: job.eventId, stage: state.stage },
      "Cleared conversation state after terms replay",
    );
    return;
  }
  // All outbound is through defined interactive messages.
  await sendStageMessage(
    state.stage,
    job,
    apiKey,
    stageIdempotencyKey(state.stage, job.eventId),
    signal,
  );
  signal.throwIfAborted();
  await saveConversationState(redis, key, state);
  logger.info(
    { eventId: job.eventId, stage: state.stage },
    "Replayed current WhatsApp stage message",
  );
}
