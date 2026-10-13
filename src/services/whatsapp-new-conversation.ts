import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import {
  idempotencyKeyFor,
  saveConversationState,
  type ConversationState,
} from "./whatsapp-conversation-state.js";
import { sendStageMessage } from "./whatsapp-stage-messages.js";

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
  const state: ConversationState = {
    stage: "get_started",
    promptSent: false,
    promptEventId: job.eventId,
    responses: [],
  };
  await saveConversationState(redis, key, state);

  await sendStageMessage(
    "get_started",
    { ...job, eventId: state.promptEventId },
    apiKey,
    idempotencyKeyFor("get_started", state.promptEventId),
    signal,
  );
  signal.throwIfAborted();
  state.promptSent = true;
  await saveConversationState(redis, key, state);
  logger.info({ eventId: state.promptEventId }, "Sent get-started WhatsApp menu");
}
