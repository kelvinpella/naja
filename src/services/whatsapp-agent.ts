import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { najaAgent } from "../mastra/agents/naja.js";
import { toAgentInput } from "./whatsapp-message-input.js";

/**
 * Runs one agent turn for an inbound message. `personKey` is both the resource
 * (the human) and the thread (their conversation), so a person keeps one
 * continuous history across numbers and days.
 */
export async function generateWhatsappReply(
  job: WhatsappIncomingMessageJob,
  signal: AbortSignal,
): Promise<string> {
  const input = toAgentInput(job);

  const result = await najaAgent.generate(input, {
    memory: { thread: job.personKey, resource: job.personKey },
    abortSignal: signal,
  });

  return result.text.trim();
}
