import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { getKapsoClient, recipientTarget, withAbort } from "./kapso-client.js";

// Bilingual on purpose: the notice goes out before the job finder has read the
// Person's words, and the fallback apology is bilingual for the same reason.
export const SEARCH_NOTICE =
  "Natafuta kazi zinazofaa…\nSearching for jobs that fit…";

// The search itself has the Turn's budget; the notice is worth five seconds of
// it at most, because a notice that arrives late is worse than none.
const NOTICE_TIMEOUT_MS = 5_000;

// Distinct from the Turn's reply key, so a search notice and the reply it
// precedes are distinguishable in delivery traces.
export function searchNoticeCallbackData(eventId: string): string {
  const hash = createHash("sha256").update(eventId).digest("hex");
  return `naja-search-notice-${hash}`;
}

/**
 * Tells the Person a search is underway, the moment the Turn delegates
 * (ADR 0010). Best effort: a failed notice must never fail the Turn, so this
 * logs and returns instead of throwing.
 */
export async function sendSearchNotice(
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  logger: FastifyBaseLogger,
): Promise<void> {
  try {
    await withAbort(
      getKapsoClient(apiKey).messages.sendText({
        phoneNumberId: job.phoneNumberId,
        ...recipientTarget(job),
        body: SEARCH_NOTICE,
        bizOpaqueCallbackData: searchNoticeCallbackData(job.eventId),
      }),
      AbortSignal.timeout(NOTICE_TIMEOUT_MS),
    );
  } catch (error) {
    logger.warn(
      { err: error, eventId: job.eventId },
      "Search notice could not be sent",
    );
  }
}
