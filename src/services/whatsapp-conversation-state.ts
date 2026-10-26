import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { StageId } from "./whatsapp-stages.js";

const STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type ConversationStage = StageId;

export type ConversationResponse = {
  stage: ConversationStage;
  response: string;
  eventId: string;
  receivedAt: string;
};

export type ConversationState = {
  stage: ConversationStage;
  promptSent: boolean;
  promptEventId: string;
  responses: ConversationResponse[];
  selectedJobId?: string;
  listOffset?: number;
  listKeyword?: string;
};

export function conversationKey(personKey: string, phoneNumberId: string): string {
  const stateHash = createHash("sha256")
    .update(`${phoneNumberId}:${personKey}`)
    .digest("hex");
  return `naja:whatsapp:conversation:${stateHash}`;
}

export function getStartedIdempotencyKey(eventId: string): string {
  const eventHash = createHash("sha256").update(eventId).digest("hex");
  return `naja-get-started-${eventHash}`;
}

export function stageIdempotencyKey(
  stage: ConversationStage,
  eventId: string,
): string {
  return idempotencyKeyFor(stage, eventId);
}

// Stable scheme (Q6): one function owns every purpose suffix so call sites
// pass a fixed purpose instead of ad-hoc string interpolation.
// Stable scheme (Q6): fixed purposes, no ad-hoc interpolation at call
// sites. Dynamic ids (job id, offset) travel in `scope`, composed here.
export type IdempotencyPurpose =
  | "send"
  | "empty"
  | "single"
  | "page"
  | "invalid"
  | "resend"
  | "created"
  | "error"
  | "missing";

export function idempotencyKeyFor(
  stage: ConversationStage,
  eventId: string,
  purpose: IdempotencyPurpose = "send",
  scope?: string,
): string {
  if (stage === "get_started" && purpose === "send" && !scope) {
    return getStartedIdempotencyKey(eventId);
  }
  const suffix = scope ? `${purpose}:${scope}` : purpose;
  const eventHash = createHash("sha256")
    .update(`${eventId}:${suffix}`)
    .digest("hex");
  return `naja-${stage}-${eventHash}`;
}

export async function loadConversationState(
  redis: Redis,
  key: string,
): Promise<ConversationState | null> {
  const value = await redis.get(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as ConversationState;
  } catch {
    return null;
  }
}

// Stateless entry: old card buttons keep working after state was cleared
// (Omba close, Tangaza close, terms close alike) — job taps are
// self-contained (id / offset travel in the tap), so entry starts mid-flow.
export function statelessJobTapState(
  eventId: string,
): ConversationState {
  return {
    stage: "tafuta_kazi",
    promptSent: true,
    promptEventId: eventId,
    responses: [],
  };
}

// Stateless entry: a Stage tap always enters the requested stage, even with
// no stored state. Plain text (no tap) still starts get-started.
export function statelessStageState(
  stage: ConversationStage,
  eventId: string,
): ConversationState {
  return { stage, promptSent: true, promptEventId: eventId, responses: [] };
}

export async function saveConversationState(
  redis: Redis,
  key: string,
  state: ConversationState,
): Promise<void> {
  await redis.set(key, JSON.stringify(state), "EX", STATE_TTL_SECONDS);
}

export async function clearConversationState(
  redis: Redis,
  key: string,
): Promise<void> {
  await redis.del(key);
}
