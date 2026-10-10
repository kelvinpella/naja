import { Zernio } from "@zernio/node";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import { STAGE_MESSAGES, type StageId } from "./whatsapp-stages.js";
import { getFindJobSearchFlowId } from "./stages/find-job/flow.js";
import { getPostJobFlowId } from "./stages/post-job/flow.js";
import type { CarouselCard } from "./jobs/job-carousel.js";

const zernioClients = new Map<string, Zernio>();
function getZernio(apiKey: string): Zernio {
  let client = zernioClients.get(apiKey);
  if (!client) {
    client = new Zernio({ apiKey });
    zernioClients.set(apiKey, client);
  }
  return client;
}

type WarnLogger = { warn: (...args: unknown[]) => void };
function warnLog(logger: WarnLogger | undefined, ...args: unknown[]): void {
  if (logger) logger.warn(...args);
  else console.warn(...args);
}

function truncateTitle(title: string, max = 20): string {
  return Array.from(title).slice(0, max).join("");
}

export async function sendStageMessage(
  stage: StageId,
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
  opts?: { prefill?: Record<string, unknown>; logger?: WarnLogger },
): Promise<void> {
  const definition = STAGE_MESSAGES[stage];
  const zernio = getZernio(apiKey);
  // Flow token is conversation-scoped (Meta ≤200 chars), not the idempotency key.
  const flowToken = `naja-${job.conversationId}-${stage}`.slice(0, 200);

  if (definition.flow) {
    const flowId =
      stage === "tangaza_kazi"
        ? getPostJobFlowId()
        : getFindJobSearchFlowId();
    if (flowId) {
      try {
        const { error } = await zernio.messages.sendInboxMessage({
          path: { conversationId: job.conversationId },
          body: {
            accountId: job.accountId,
            message: definition.body,
            interactive: {
              type: "flow",
              body: { text: definition.body },
              action: {
                name: "flow",
                parameters: {
                  flow_token: flowToken,
                  flow_id: flowId,
                  flow_cta: definition.flow.cta,
                  flow_action: "navigate",
                  flow_action_payload: {
                    screen: definition.flow.screen,
                    ...(opts?.prefill
                      ? { data: opts.prefill }
                      : {}),
                  },
                  mode: "draft",
                },
              },
            },
          },
          headers: { "Idempotency-Key": idempotencyKey },
          signal,
        });

        if (error) {
          throw new Error("Zernio flow message send failed", { cause: error });
        }
        return;
      } catch (error) {
        // Flow sends depend on WABA/Flow health (e.g. Meta 139000 Blocked by
        // Integrity). Fall back to the plain Stage message so the menu keeps
        // working; the failure is still logged upstream via the thrown job
        // error path. Re-throw only if fallback also fails below.
        // Log redacted cause, then continue to buttons fallback.
        warnLog(
          opts?.logger,
          `[whatsapp-stage-messages] Flow send failed for stage ${stage}, falling back to buttons:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    // No flow configured (testing without a DRAFT): fall through to buttons.
  }

  const sendButtons = async (withImage: boolean, key: string): Promise<void> => {
    const { error } = await zernio.messages.sendInboxMessage({
      path: { conversationId: job.conversationId },
      body: {
        accountId: job.accountId,
        message: definition.body,
        ...(withImage && definition.imageUrl
          ? {
              attachmentUrl: definition.imageUrl,
              attachmentType: definition.imageType ?? "image",
            }
          : {}),
        buttons: definition.buttons,
      },
      headers: { "Idempotency-Key": key },
      signal,
    });

    if (error) {
      throw new Error("Zernio message send failed", { cause: error });
    }
  };

  if (!definition.imageUrl) {
    // Distinct key from the Flow attempt above — same payload type, different channel.
    await sendButtons(false, `${idempotencyKey}:fallback`);
    return;
  }

  // A dead banner must never brick the menu: on image failure (bad URL,
  // unreachable host) fall back to the text-only message.
  try {
    await sendButtons(true, idempotencyKey);
  } catch (error) {
    warnLog(
      opts?.logger,
      `[whatsapp-stage-messages] Image send failed for stage ${stage}, falling back to text-only:`,
      error instanceof Error ? error.message : error,
    );
    await sendButtons(false, `${idempotencyKey}:noimg`);
  }
}

export async function sendJobCarousel(
  heading: string,
  cards: CarouselCard[],
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<void> {
  const zernio = getZernio(apiKey);
  const { error } = await zernio.messages.sendInboxMessage({
    path: { conversationId: job.conversationId },
    body: {
      accountId: job.accountId,
      message: heading,
      interactive: {
        type: "carousel",
        body: { text: heading },
        action: {
          cards: cards.map((card, index) => ({
            // Meta carousel card_index is 0-based.
            card_index: index,
            type: "cta_url",
            header: { type: "image", image: { link: card.imageUrl } },
            body: { text: card.body },
            action: {
              buttons: card.buttons.map((button) => ({
                type: "quick_reply",
                quick_reply: { id: button.id, title: truncateTitle(button.title) },
              })),
            },
          })),
        },
      },
    },
    headers: { "Idempotency-Key": idempotencyKey },
    signal,
  });

  if (error) {
    throw new Error("Zernio carousel send failed", { cause: error });
  }
}

export async function sendJobText(
  body: string,
  buttons: { title: string; payload: string }[],
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
  opts?: { imageUrl?: string; imageType?: "image" | "video" | "audio" | "file" },
): Promise<void> {
  const zernio = getZernio(apiKey);
  let imageUrl: string | undefined;
  if (opts?.imageUrl) {
    try {
      const parsed = new URL(opts.imageUrl);
      if (parsed.protocol === "https:" && parsed.hostname) imageUrl = opts.imageUrl;
    } catch {
      imageUrl = undefined;
    }
  }
  const { error } = await zernio.messages.sendInboxMessage({
    path: { conversationId: job.conversationId },
      body: {
        accountId: job.accountId,
        message: body,
        ...(imageUrl
          ? {
              attachmentUrl: imageUrl,
              attachmentType: opts?.imageType ?? "image",
            }
          : {}),
      // No buttons: plain text message (e.g. terminal confirmations after
      // state is cleared, where a tap would have nowhere to resume to).
      ...(buttons.length > 0
        ? {
            buttons: buttons.map((button) => ({
              type: "postback" as const,
              ...button,
            })),
          }
        : {}),
    },
    headers: { "Idempotency-Key": idempotencyKey },
    signal,
  });

  if (error) {
    throw new Error("Zernio message send failed", { cause: error });
  }
}
