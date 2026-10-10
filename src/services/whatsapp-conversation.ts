import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import {
  conversationKey,
  loadConversationState,
  saveConversationState,
} from "./whatsapp-conversation-state.js";
import { handleNewConversation } from "./whatsapp-new-conversation.js";
import { handleStagedConversation } from "./whatsapp-staged-conversation.js";
import { isStageId } from "./whatsapp-stages.js";
import { parseJobPayload, parseMorePayload } from "./jobs/job-carousel.js";
import { sendTypingIndicator } from "./zernio-typing-indicator.js";

export async function processWhatsappMessage(
  job: WhatsappIncomingMessageJob,
  redis: Redis,
  apiKey: string,
  logger: FastifyBaseLogger,
  signal: AbortSignal,
): Promise<void> {
  if (job.standby) {
    logger.info({ eventId: job.eventId }, "Skipping WhatsApp standby message");
    return;
  }

  // Typing is best-effort — don't block state load. Fire-and-forget with timeout
  // handled inside sendTypingIndicator (2s) + swallowed errors.
  void sendTypingIndicator(
    job.conversationId,
    job.accountId,
    apiKey,
    logger,
    signal,
  ).catch(() => undefined);

  const key = conversationKey(job.personKey, job.accountId);
  // Serialized per-person by withPersonLock in the worker — load-then-save is safe.
  const state = await loadConversationState(redis, key);
  signal.throwIfAborted();

  if (!state) {
    // Job payloads are self-contained (job id / offset travel in the tap),
    // so old card buttons keep working after state was cleared by Omba.
    if (
      parseJobPayload(job.interactiveId) ||
      parseMorePayload(job.interactiveId) ||
      job.interactiveType === "nfm_reply"
    ) {
      logger.info(
        { eventId: job.eventId },
        "Handling job tap without stored state",
      );
      const syntheticState = {
        stage: "tafuta_kazi" as const,
        promptSent: true,
        promptEventId: job.eventId,
        responses: [],
      };
      // Persist synthetic state so the staged handler's saves don't resurrect null-state races.
      await saveConversationState(redis, key, syntheticState);
      await handleStagedConversation({
        job,
        redis,
        apiKey,
        logger,
        signal,
        key,
        state: syntheticState,
      });
      return;
    }
    // Old message buttons after a cleared stage (tangaza close, tafuta
    // apply-close, terms close alike): a Stage tap always enters the requested stage, even
    // with no stored state. Plain text (no tap) still starts get-started below.
    if (job.interactiveId && isStageId(job.interactiveId)) {
      logger.info(
        { eventId: job.eventId, stage: job.interactiveId },
        "Entering requested stage without stored state",
      );
      const enteredState = {
        stage: job.interactiveId,
        promptSent: true,
        promptEventId: job.eventId,
        responses: [],
      };
      await saveConversationState(redis, key, enteredState);
      await handleStagedConversation({
        job,
        redis,
        apiKey,
        logger,
        signal,
        key,
        state: enteredState,
      });
      return;
    }
    await handleNewConversation({ job, redis, apiKey, logger, signal, key });
    return;
  }

  await handleStagedConversation({
    job,
    redis,
    apiKey,
    logger,
    signal,
    key,
    state,
  });
}
