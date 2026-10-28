import type { FastifyBaseLogger } from "fastify";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { STAGE_MESSAGES, getStageFlowId, type StageId } from "./whatsapp-stages.js";
import { getKapsoClient, recipientTarget, withAbort } from "./kapso-client.js";
import type { CarouselCard } from "./jobs/job-carousel.js";
import type { StageMessage } from "./stages/stage-types.js";

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

// Kapso (like the underlying Graph API) has no idempotency header, so retries
// can re-send. The callback data is echoed on status webhooks, which keeps a
// duplicate or late send attributable to the job that produced it.
function trace(idempotencyKey: string): { bizOpaqueCallbackData: string } {
  return { bizOpaqueCallbackData: idempotencyKey.slice(0, 512) };
}

type MediaType = StageMessage["imageType"];

function mediaHeader(url: string, type: MediaType) {
  if (type === "video") return { type: "video" as const, video: { link: url } };
  if (type === "file") {
    return { type: "document" as const, document: { link: url } };
  }
  return { type: "image" as const, image: { link: url } };
}

export async function sendStageMessage(
  stage: StageId,
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
  opts?: { prefill?: Record<string, unknown>; logger?: Logger },
): Promise<StageSendResult> {
  const definition = STAGE_MESSAGES[stage];
  const kapso = getKapsoClient(apiKey);
  const target = recipientTarget(job);
  const warn = (message: string, cause: unknown): void => {
    const logTarget = opts?.logger?.warn;
    // Test fakes only stub info/error: fall back to console when warn is absent.
    if (typeof logTarget === "function") {
      Reflect.apply(logTarget, opts?.logger, [{ err: cause, stage }, message]);
    } else {
      console.warn(`[whatsapp-stage-messages] ${message}`, cause);
    }
  };

  if (definition.flow) {
    const flowId = getStageFlowId(stage);
    if (flowId) {
      try {
        await withAbort(
          kapso.messages.sendInteractiveFlow({
            phoneNumberId: job.phoneNumberId,
            ...target,
            bodyText: definition.body,
            parameters: {
              flowId,
              flowCta: definition.flow.cta,
              flowToken: idempotencyKey.slice(0, 200),
              flowAction: "navigate",
              flowActionPayload: {
                screen: definition.flow.screen,
                ...(opts?.prefill ? { data: opts.prefill } : {}),
              },
              // Testing only: the Flow stays DRAFT and is never published.
              mode: "draft",
            },
            ...trace(idempotencyKey),
          }),
          signal,
        );
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
    await withAbort(
      kapso.messages.sendInteractiveButtons({
        phoneNumberId: job.phoneNumberId,
        ...target,
        bodyText: definition.body,
        ...(withImage && definition.imageUrl
          ? { header: mediaHeader(definition.imageUrl, definition.imageType) }
          : {}),
        buttons: definition.buttons.map((button) => ({
          id: button.payload,
          title: button.title,
        })),
        ...trace(idempotencyKey),
      }),
      signal,
    );
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
  const kapso = getKapsoClient(apiKey);
  try {
    await withAbort(
      kapso.messages.sendInteractiveCarousel({
        phoneNumberId: job.phoneNumberId,
        ...recipientTarget(job),
        bodyText: heading,
        cards: cards.map((card, index) => ({
          cardIndex: index,
          header: { type: "image" as const, image: { link: card.imageUrl } },
          bodyText: card.body,
          action: {
            buttons: card.buttons.map((button) => ({
              id: button.id,
              title: button.title,
            })),
          },
        })),
        ...trace(idempotencyKey),
      }),
      signal,
    );
  } catch (error) {
    throw new Error("Kapso carousel send failed", { cause: error });
  }
  return { sentAs: "carousel" };
}

async function sendMediaMessage(
  kapso: ReturnType<typeof getKapsoClient>,
  job: WhatsappIncomingMessageJob,
  imageUrl: string,
  imageType: MediaType,
  caption: string,
  callbackData: string,
  signal: AbortSignal,
): Promise<void> {
  const base = {
    phoneNumberId: job.phoneNumberId,
    ...recipientTarget(job),
    ...trace(callbackData),
  };

  if (imageType === "video") {
    await withAbort(
      kapso.messages.sendVideo({
        ...base,
        video: { link: imageUrl, caption },
      }),
      signal,
    );
    return;
  }
  if (imageType === "file") {
    await withAbort(
      kapso.messages.sendDocument({
        ...base,
        document: { link: imageUrl, caption },
      }),
      signal,
    );
    return;
  }
  await withAbort(
    kapso.messages.sendImage({
      ...base,
      image: { link: imageUrl, caption },
    }),
    signal,
  );
}

export async function sendJobText(
  body: string,
  buttons: { title: string; payload: string }[],
  job: WhatsappIncomingMessageJob,
  apiKey: string,
  idempotencyKey: string,
  signal: AbortSignal,
  opts?: { imageUrl?: string; imageType?: MediaType },
): Promise<TextSendResult> {
  const kapso = getKapsoClient(apiKey);
  const imageType = opts?.imageType ?? "image";

  try {
    if (buttons.length > 0) {
      await withAbort(
        kapso.messages.sendInteractiveButtons({
          phoneNumberId: job.phoneNumberId,
          ...recipientTarget(job),
          bodyText: body,
          ...(opts?.imageUrl
            ? { header: mediaHeader(opts.imageUrl, imageType) }
            : {}),
          buttons: buttons.map((button) => ({
            id: button.payload,
            title: button.title,
          })),
          ...trace(idempotencyKey),
        }),
        signal,
      );
      return { sentAs: "buttons" };
    }

    // No buttons: terminal confirmations go out as text, with the photo as a
    // captioned media message when one is configured.
    if (opts?.imageUrl) {
      await sendMediaMessage(
        kapso,
        job,
        opts.imageUrl,
        imageType,
        body,
        idempotencyKey,
        signal,
      );
      return { sentAs: "text" };
    }

    await withAbort(
      kapso.messages.sendText({
        phoneNumberId: job.phoneNumberId,
        ...recipientTarget(job),
        body,
        ...trace(idempotencyKey),
      }),
      signal,
    );
    return { sentAs: "text" };
  } catch (error) {
    throw new Error("Kapso message send failed", { cause: error });
  }
}
