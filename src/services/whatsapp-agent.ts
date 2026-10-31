import type { FastifyBaseLogger } from "fastify";
import { mastra } from "../mastra/index.js";
import { najaMemory } from "../mastra/agents/naja.js";
import {
  MEMORY_RESOURCE_ID,
  personThreadTitle,
  syncPersonThreadTitle,
} from "../mastra/thread-identity.js";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { toAgentInput } from "./whatsapp-message-input.js";
import {
  replySchema,
  toWhatsappReply,
  type WhatsappReply,
} from "./whatsapp-reply-contract.js";

/**
 * Runs one agent turn for an inbound message. `personKey` is the Thread, so a
 * person keeps one continuous history across numbers and days; every Person
 * shares the memory resource, which is what lets Studio list their Threads.
 */
export async function generateWhatsappReply(
  job: WhatsappIncomingMessageJob,
  signal: AbortSignal,
  logger: FastifyBaseLogger,
): Promise<WhatsappReply | null> {
  const input = toAgentInput(job);

  try {
    await syncPersonThreadTitle(
      najaMemory,
      job.personKey,
      personThreadTitle(job),
    );
  } catch (error) {
    // A Thread labelled with an old number is a readability problem, not a
    // reason to lose the reply the person is waiting for.
    logger.warn(
      { err: error, personKey: job.personKey },
      "Failed to sync the Person's Thread title",
    );
  }

  const result = await mastra.getAgent("naja").generate(input, {
    memory: { thread: job.personKey, resource: MEMORY_RESOURCE_ID },
    abortSignal: signal,
    // Native response_format where the model supports it, injected JSON where
    // it does not: the FreeLLMAPI router can pick a different model per Turn,
    // so the choice cannot be made once at boot.
    structuredOutput: {
      schema: replySchema,
      jsonPromptInjection: "auto",
    },
  });

  return toWhatsappReply(result.object, result.text);
}
