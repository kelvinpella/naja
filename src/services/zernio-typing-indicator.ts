import type { FastifyBaseLogger } from "fastify";
import { getZernioClient } from "./zernio-client.js";

export async function sendTypingIndicator(
  conversationId: string,
  accountId: string,
  apiKey: string,
  logger: FastifyBaseLogger,
  signal: AbortSignal,
): Promise<void> {
  const zernio = getZernioClient(apiKey);

  try {
    const { data, error } = await zernio.messages.sendTypingIndicator({
      path: { conversationId },
      body: { accountId },
      signal,
    });

    if (error) {
      logger.warn(
        { conversationId, err: error },
        "Zernio typing indicator request failed",
      );
      return;
    }

    if (data && data.success === false) {
      logger.debug(
        { conversationId },
        "Zernio typing indicator not delivered (best-effort)",
      );
    }
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    logger.warn({ err: error, conversationId }, "Failed to send typing indicator");
  }
}
