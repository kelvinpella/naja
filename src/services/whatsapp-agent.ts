import type { FastifyBaseLogger } from "fastify";
import { RequestContext } from "@mastra/core/request-context";
import { mastra } from "../mastra/index.js";
import { najaMemory } from "../mastra/agents/naja.js";
import { SENDER_PHONE_CONTEXT_KEY } from "../mastra/request-context-keys.js";
import {
  MEMORY_RESOURCE_ID,
  personThreadTitle,
  syncPersonThreadTitle,
} from "../mastra/thread-identity.js";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { sendSearchNotice } from "./search-notice.js";
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
  kapsoApiKey: string,
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

  // The search tools exclude the Jobs this Person posted themselves, so their
  // phone travels with the Turn instead of through the model.
  const requestContext = new RequestContext([
    [SENDER_PHONE_CONTEXT_KEY, job.senderPhone ?? ""],
  ]);

  // At most one notice per Turn, however many times the model delegates.
  let searchNoticeSent = false;

  const result = await mastra.getAgent("naja").generate(input, {
    memory: { thread: job.personKey, resource: MEMORY_RESOURCE_ID },
    abortSignal: signal,
    requestContext,
    delegation: {
      onDelegationStart: async ({ primitiveId }) => {
        if (primitiveId !== "search" || searchNoticeSent) return;
        searchNoticeSent = true;
        await sendSearchNotice(job, kapsoApiKey, logger);
      },
    },
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
