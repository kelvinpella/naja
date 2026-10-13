import type { FastifyBaseLogger } from "fastify";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import { STAGE_MESSAGES, getStageFlowId, type StageId } from "./whatsapp-stages.js";
import { getZernioClient } from "./zernio-client.js";
import type { CarouselCard } from "./jobs/job-carousel.js";

export type StageSendResult = {
  sentAs: "flow" | "buttons" | "text";
};

export type CarouselSendResult = {
  sentAs: "carousel";
};

export type TextSendResult = {
  sentAs: "buttons" | "text";
};

type Logger = Pick<FastifyBaseLogger, "warn" | "info">;

export async function sendStageMessage(
  stage: StageId,
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
  opts?: { prefill?: Record<string, unknown>; logger?: Logger },
): Promise<StageSendResult> {
  const definition = STAGE_MESSAGES[stage];
  const zernio = getZernioClient(apiKey);
  const warn = (message: string, cause: unknown): void => {
    const target = opts?.logger?.warn;
    // Test fakes only stub info/error: fall back to console when warn is absent.
    if (typeof target === "function") {
      Reflect.apply(target, opts?.logger, [{ err: cause, stage }, message]);
    } else {
      console.warn(`[whatsapp-stage-messages] ${message}`, cause);
    }
  };

  if (definition.flow) {
    const flowId = getStageFlowId(stage);
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
                  flow_token: idempotencyKey.slice(0, 200),
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
        return { sentAs: "flow" };
      } catch (error) {
        // Flow sends depend on WABA/Flow health (e.g. Meta 139000 Blocked by
        // Integrity). Fall back to the plain Stage message so the menu keeps
        // working; the failure is still logged upstream via the thrown job
        // error path. Re-throw only if fallback also fails below.
        warn(`Flow send failed for stage ${stage}, falling back to buttons`, error);
      }
    }
    // No flow configured (testing without a DRAFT): fall through to buttons.
  }

  const sendButtons = async (withImage: boolean): Promise<void> => {
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
      headers: { "Idempotency-Key": idempotencyKey },
      signal,
    });

    if (error) {
      throw new Error("Zernio message send failed", { cause: error });
    }
  };

  if (!definition.imageUrl) {
    await sendButtons(false);
    return { sentAs: "buttons" };
  }

  // A dead banner must never brick the menu: on image failure (bad URL,
  // unreachable host) fall back to the text-only message.
  try {
    await sendButtons(true);
    return { sentAs: "buttons" };
  } catch (error) {
    warn(`Image send failed for stage ${stage}, falling back to text-only`, error);
    await sendButtons(false);
    return { sentAs: "text" };
  }
}

export async function sendJobCarousel(
  heading: string,
  cards: CarouselCard[],
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<CarouselSendResult> {
  const zernio = getZernioClient(apiKey);
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
            card_index: index,
            type: "cta_url",
            header: { type: "image", image: { link: card.imageUrl } },
            body: { text: card.body },
            action: {
              buttons: card.buttons.map((button) => ({
                type: "quick_reply",
                quick_reply: { id: button.id, title: button.title },
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
  return { sentAs: "carousel" };
}

export async function sendJobText(
  body: string,
  buttons: { title: string; payload: string }[],
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
  opts?: { imageUrl?: string; imageType?: "image" | "video" | "audio" | "file" },
): Promise<TextSendResult> {
  const zernio = getZernioClient(apiKey);
  const { error } = await zernio.messages.sendInboxMessage({
    path: { conversationId: job.conversationId },
    body: {
      accountId: job.accountId,
      message: body,
      ...(opts?.imageUrl
        ? {
            attachmentUrl: opts.imageUrl,
            attachmentType: opts.imageType ?? "image",
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
  return { sentAs: buttons.length > 0 ? "buttons" : "text" };
}
