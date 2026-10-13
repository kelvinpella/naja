// Shared handler context: handlers own their transition (Q4) — they mutate
// the state draft, perform sends, and return whether the router should clear.
// The router saves/clears exactly once per message.
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { WhatsappIncomingMessageJob } from "../../queues/zernio-events.js";
import type { ConversationState } from "../whatsapp-conversation-state.js";
import { idempotencyKeyFor } from "../whatsapp-conversation-state.js";
import { sendJobCarousel, sendJobText } from "../whatsapp-stage-messages.js";
import { renderView } from "../jobs/jobs.js";
import {
  APPLY_BUTTON_TITLE,
  JOB_CARD_IMAGE_URL,
  applyPayload,
  fullDetailBody,
  type ListOrigin,
} from "../jobs/job-carousel.js";
import type { JobPage } from "../jobs/job-types.js";

export type HandlerContext = {
  job: WhatsappIncomingMessageJob;
  redis: Redis;
  apiKey: string;
  logger: FastifyBaseLogger;
  signal: AbortSignal;
  key: string;
  state: ConversationState;
};

export type HandlerResult = {
  clear: boolean;
};

export function pushResponse(
  state: ConversationState,
  entry: { stage: ConversationState["stage"]; response: string; eventId: string },
): void {
  state.responses.push({ ...entry, receivedAt: new Date().toISOString() });
}

export async function sendJobPage(
  page: JobPage,
  origin: ListOrigin,
  offset: number,
  heading: string,
  emptyBody: string,
  ctx: HandlerContext,
  eventId: string,
): Promise<void> {
  const { job, apiKey, signal, state } = ctx;
  const view = renderView(page, origin, offset, heading);
  if (view.kind === "empty") {
    await sendJobText(
      emptyBody,
      [{ title: "Rudi nyuma", payload: "get_started" }],
      job,
      apiKey,
      idempotencyKeyFor(state.stage, eventId, "empty"),
      signal,
    );
    ctx.logger.info({ eventId, origin }, "Sent empty job list message");
    return;
  }
  if (view.kind === "single") {
    // One job can't form a carousel (Meta requires 2-10 cards), so it goes
    // out as a reply-buttons message with the same image header the cards
    // carry, keeping the look consistent across result counts.
    await sendJobText(
      fullDetailBody(view.job),
      [
        { title: APPLY_BUTTON_TITLE, payload: applyPayload(view.job.id) },
        { title: "Rudi nyuma", payload: "get_started" },
      ],
      job,
      apiKey,
      idempotencyKeyFor(state.stage, eventId, "single", view.job.id),
      signal,
      { imageUrl: view.job.jobImage ?? JOB_CARD_IMAGE_URL },
    );
    ctx.state.selectedJobId = view.job.id;
    ctx.logger.info({ eventId, jobId: view.job.id }, "Sent single job message");
    return;
  }
  await sendJobCarousel(
    view.heading,
    view.cards,
    job,
    apiKey,
    idempotencyKeyFor(state.stage, eventId, "page", String(offset)),
    signal,
  );
  ctx.logger.info(
    { eventId, cards: view.cards.length, offset },
    "Sent job carousel",
  );
}
