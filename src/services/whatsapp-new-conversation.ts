import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import {
  getStartedIdempotencyKey,
  loadConversationState,
  saveConversationState,
  type ConversationState,
} from "./whatsapp-conversation-state.js";
import { sendGetStartedMessage } from "./whatsapp-get-started.js";

export type NewConversationContext = {
  job: WhatsappIncomingMessageJob;
  redis: Redis;
  apiKey: string;
  logger: FastifyBaseLogger;
  signal: AbortSignal;
  key: string;
};

export async function handleNewConversation({
  job,
  redis,
  apiKey,
  logger,
  signal,
  key,
}: NewConversationContext): Promise<void> {
  // Per-person lock serializes handlers, but double-check for races (e.g. synthetic-state save).
  const existing = await loadConversationState(redis, key);
  if (existing?.promptSent) {
    logger.info({ eventId: job.eventId }, "Menu already sent, skipping duplicate get-started");
    return;
  }
  const state: ConversationState = {
    stage: "get_started",
    promptSent: false,
    promptEventId: job.eventId,
    responses: [],
  };
  // SET NX guard: if another handler won the race, skip the duplicate send.
  const setResult = await redis.set(key, JSON.stringify(state), "EX", 7 * 24 * 60 * 60, "NX");
  if (setResult !== "OK") {
    logger.info({ eventId: job.eventId }, "Menu already claimed by concurrent handler");
    return;
  }

  await sendGetStartedMessage(
    { ...job, eventId: state.promptEventId },
    apiKey,
    getStartedIdempotencyKey(state.promptEventId),
    signal,
  );
  signal.throwIfAborted();
  // Reload before final save so concurrent mutations aren't clobbered.
  const fresh = await loadConversationState(redis, key);
  const merged: ConversationState = { ...(fresh ?? state), promptSent: true, promptEventId: state.promptEventId };
  await saveConversationState(redis, key, merged);
  logger.info({ eventId: state.promptEventId }, "Sent get-started WhatsApp menu");
}
