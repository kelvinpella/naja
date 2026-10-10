import { Zernio } from "@zernio/node";
import type { FastifyBaseLogger } from "fastify";

export async function sendTypingIndicator(
  conversationId: string,
  accountId: string,
  apiKey: string,
  logger: FastifyBaseLogger,
  signal: AbortSignal,
): Promise<void> {
  const zernio = new Zernio({ apiKey });

  const timeout = new Promise<never>((_resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Typing indicator timed out")), 2000);
    signal.addEventListener("abort", () => { clearTimeout(t); }, { once: true });
  });

  try {
    const { data, error } = await Promise.race([
      zernio.messages.sendTypingIndicator({
        path: { conversationId },
        body: { accountId },
        signal,
      }),
      timeout,
    ]);

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
    // Typing is best-effort — never fail the job, including on abort.
    if (signal.aborted) {
      logger.debug({ conversationId }, "Typing indicator aborted (best-effort)");
      return;
    }
    logger.warn({ err: error, conversationId }, "Failed to send typing indicator");
  }
}
