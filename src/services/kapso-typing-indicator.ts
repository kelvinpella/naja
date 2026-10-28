import type { FastifyBaseLogger } from "fastify";
import { getKapsoClient, withAbort } from "./kapso-client.js";

// Kapso/Meta show the typing bubble by marking the inbound message read with
// `typing_indicator`. It dismisses on send or after ~25s.
export async function sendTypingIndicator(
  phoneNumberId: string,
  messageId: string,
  apiKey: string,
  logger: FastifyBaseLogger,
  signal: AbortSignal,
): Promise<void> {
  const kapso = getKapsoClient(apiKey);

  try {
    await withAbort(
      kapso.messages.markRead({
        phoneNumberId,
        messageId,
        typingIndicator: { type: "text" },
      }),
      signal,
    );
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    logger.warn(
      { err: error, messageId, phoneNumberId },
      "Failed to send typing indicator",
    );
  }
}
