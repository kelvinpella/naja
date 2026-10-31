import type { Memory } from "@mastra/memory";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { toE164Phone } from "../services/phone.js";

// Studio lists Threads with `resourceId = agentId` (its sidebar hard-codes the
// agent id), so every Person shares this one resource and the Thread id alone
// identifies them. Memory features that scope to a resource — working memory,
// semantic recall, Observational Memory retrieval — must stay thread-scoped
// while this is shared. See docs/adr/0004-studio-read-only-console.md.
export const MEMORY_RESOURCE_ID = "naja";

/**
 * The title a Person's Thread carries in Studio: their full phone number, or
 * the BSUID when WhatsApp gave no number. Studio shows nothing else about who
 * a Thread belongs to, so an untitled Thread is an unreadable hash.
 */
export function personThreadTitle(
  job: Pick<WhatsappIncomingMessageJob, "senderPhone" | "recipient">,
): string {
  return toE164Phone(job.senderPhone) ?? job.recipient;
}

/**
 * Creates the Person's Thread with its title, or refreshes the title when the
 * number they write from has changed. A Person keeps one Thread for life, so
 * the title is a moving label rather than a birth certificate: a stale number
 * may already belong to someone else.
 *
 * Costs one read per Turn and a write only on the Turn where the number
 * changes; callers treat a failure as cosmetic.
 */
export async function syncPersonThreadTitle(
  memory: Memory,
  threadId: string,
  title: string,
): Promise<void> {
  const thread = await memory.getThreadById({ threadId });

  if (!thread) {
    await memory.createThread({ threadId, resourceId: MEMORY_RESOURCE_ID, title });
    return;
  }

  if (thread.title === title) return;

  await memory.updateThread({
    id: threadId,
    title,
    metadata: thread.metadata,
  });
}
