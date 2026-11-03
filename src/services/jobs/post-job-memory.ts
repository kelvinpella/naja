import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { najaMemory } from "../../mastra/agents/naja.js";
import { MEMORY_RESOURCE_ID } from "../../mastra/thread-identity.js";
import type { PostJobFields } from "../flows/post-job-flow.js";

// The stored-message shape, taken from Memory rather than imported from a
// package path Mastra does not export.
type ThreadMessage = Parameters<
  typeof najaMemory.saveMessages
>[0]["messages"][number];

function memoryMessage(
  role: "user" | "assistant",
  text: string,
  personKey: string,
): ThreadMessage {
  return {
    id: randomUUID(),
    role,
    threadId: personKey,
    resourceId: MEMORY_RESOURCE_ID,
    createdAt: new Date(),
    content: { format: 2, parts: [{ type: "text", text }] },
  };
}

/**
 * The user-side half of a Posting note. Bracketed, as `[tapped option]` is, so
 * the model reads it as a record of something that happened rather than as
 * words the Person typed.
 */
export function submissionNote(details: PostJobFields): string {
  return [
    "[completed the post job Form]",
    `title: "${details.title}"`,
    `description: "${details.description}"`,
    `area: "${details.area}"`,
    `budget: ${details.budget}`,
  ].join("\n");
}

export function publishedNote(title: string, jobId: string): string {
  return [`[job published] job: ${jobId}`, `title: "${title}"`].join("\n");
}

export function failedNote(title: string, reason: string): string {
  return [
    "[job publishing failed]",
    `title: "${title}"`,
    `reason: ${reason}`,
  ].join("\n");
}

/**
 * Appends what happened to the Person's Thread. The assistant half is only
 * passed when that message really went out, so Memory never claims Naja said
 * something nobody received (ADR 0007).
 *
 * Never throws: Memory is how the next Turn knows a Job exists, not something
 * the Person is waiting on.
 */
export async function recordPostingNotes(
  personKey: string,
  note: { user: string; assistant?: string },
  logger: FastifyBaseLogger,
): Promise<void> {
  const messages = [memoryMessage("user", note.user, personKey)];
  if (note.assistant) {
    messages.push(memoryMessage("assistant", note.assistant, personKey));
  }

  try {
    await najaMemory.saveMessages({ messages });
  } catch (error) {
    logger.warn(
      { err: error, personKey },
      "Failed to record the Posting in the Thread",
    );
  }
}
