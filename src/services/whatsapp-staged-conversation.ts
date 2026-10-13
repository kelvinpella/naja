// Thin router over the deep conversation modules: find-Job, post-Job,
// job-browse. Owns only prompt-send, generic Stage moves, and free-text
// replay of plain Stages; every Job transition lives behind its own seam.
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import {
  clearConversationState,
  saveConversationState,
  stageIdempotencyKey,
  type ConversationState,
} from "./whatsapp-conversation-state.js";
import {
  STAGE_MESSAGES,
  isStageId,
} from "./whatsapp-stages.js";
import { sendStageMessage } from "./whatsapp-stage-messages.js";
import { parseJobPayload, parseMorePayload } from "./jobs/jobs.js";
import {
  handleFindJobSubmit,
  handleMixedEntry,
  handlePagination,
} from "./conversation/find-job-handler.js";
import { handlePostJobSubmit } from "./conversation/post-job-handler.js";
import {
  handleJobReplay,
  handleJobRoute,
} from "./conversation/job-browse-handler.js";
import { pushResponse } from "./conversation/handler-context.js";

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
  return "Vigezo na Masharti";
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
  if (!state.promptSent) {
    await sendStageMessage(
      state.stage,
      { ...job, eventId: state.promptEventId },
      apiKey,
      stageIdempotencyKey(state.stage, state.promptEventId),
      signal,
      { logger },
    );
    signal.throwIfAborted();
    state.promptSent = true;
    await saveConversationState(redis, key, state);
    logger.info(
      { eventId: state.promptEventId, stage: state.stage },
      "Sent WhatsApp stage message",
    );
    return;
  }

  // Flow submission (nfm_reply): tangaza_kazi posts a job, otherwise search.
  if (job.interactiveType === "nfm_reply") {
    const result =
      state.stage === "tangaza_kazi"
        ? await handlePostJobSubmit(ctx)
        : await handleFindJobSubmit(ctx);
    if (result.clear) {
      await clearConversationState(redis, key);
    } else {
      await saveConversationState(redis, key, state);
    }
    return;
  }

  // Dynamic job payloads: Soma zaidi / Omba per job card.
  const jobRoute = parseJobPayload(job.interactiveId);
  if (jobRoute) {
    const result = await handleJobRoute(ctx, jobRoute);
    if (result.clear) {
      await clearConversationState(redis, key);
    } else {
      await saveConversationState(redis, key, state);
    }
    return;
  }

  // Pagination: Tizama kazi zaidi loads the next batch.
  const more = parseMorePayload(job.interactiveId);
  if (more) {
    await handlePagination(ctx, more.origin, more.offset);
    await saveConversationState(redis, key, state);
    return;
  }

  // Last tap wins: any recognized Stage payload moves to that Stage.
  if (isStageId(job.interactiveId)) {
    const target = job.interactiveId;
    // Kazi mchanganyiko entry renders the live job list carousel.
    if (target === "tafuta_kazi_mixed") {
      await handleMixedEntry(ctx);
      await saveConversationState(redis, key, state);
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
        { logger },
      );
      signal.throwIfAborted();
      await clearConversationState(redis, key);
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
      { logger },
    );
    signal.throwIfAborted();
    state.stage = target;
    state.promptSent = true;
    pushResponse(state, {
      stage: target,
      response: responseLabel(target),
      eventId: job.eventId,
    });
    await saveConversationState(redis, key, state);
    logger.info(
      { eventId: job.eventId, stage: target },
      "Received WhatsApp stage selection",
    );
    return;
  }

  // Free text or unknown payload: replay current Stage (7-day resume included).
  // Dynamic job stages re-render from the stored selection.
  const replayed = await handleJobReplay(ctx);
  if (replayed) {
    await saveConversationState(redis, key, state);
    return;
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
      { logger },
    );
    signal.throwIfAborted();
    await clearConversationState(redis, key);
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
    { logger },
  );
  signal.throwIfAborted();
  await saveConversationState(redis, key, state);
  logger.info(
    { eventId: job.eventId, stage: state.stage },
    "Replayed current WhatsApp stage message",
  );
}
