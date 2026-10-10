import { createHash } from "node:crypto";
import type { WhatsappIncomingMessageJob } from "../queues/zernio-events.js";
import type { ZernioWebhookPayload } from "./zernio-events.js";

export function toWhatsappMessageJob(
  payload: ZernioWebhookPayload,
): WhatsappIncomingMessageJob | null {
  const sender = payload.message?.sender;
  const phoneNumber = sender?.phoneNumber?.replace(/\D/g, "") ?? "";
  // Prefer stable phone number — businessScopedUserId can rotate and orphan state.
  const senderIdentity = phoneNumber || sender?.businessScopedUserId || sender?.id;
  const accountId = payload.account?.accountId;
  const conversationId = payload.conversation?.id;
  const eventId = payload.id;

  if (
    !senderIdentity ||
    senderIdentity.length < 5 ||
    !accountId ||
    !conversationId ||
    !eventId
  ) {
    return null;
  }

  const personKey = createHash("sha256").update(senderIdentity).digest("hex");
  const interactiveId = payload.metadata?.interactiveId;
  const buttonPayload = payload.metadata?.buttonPayload;
  const interactiveType = payload.metadata?.interactiveType;
  const flowResponseData = payload.metadata?.flowResponseData;
  let flowResponseJson = payload.metadata?.flowResponseJson;

  // Cap unbounded flow JSON in job data (Redis memory).
  if (typeof flowResponseJson === "string" && flowResponseJson.length > 20_000) {
    flowResponseJson = flowResponseJson.slice(0, 20_000);
  }

  // Both can be present: interactiveId (menu) + buttonPayload (carousel).
  // Prefer buttonPayload when it carries a job/more route, else interactiveId.
  const tapId =
    typeof buttonPayload === "string" && buttonPayload.length > 0 &&
    (/^(job_detail|job_apply|more):/.test(buttonPayload) || typeof interactiveId !== "string")
      ? buttonPayload
      : typeof interactiveId === "string"
        ? interactiveId
        : typeof buttonPayload === "string"
          ? buttonPayload
          : undefined;

  return {
    eventId,
    personKey,
    accountId,
    conversationId,
    senderPhone: phoneNumber || undefined,
    interactiveId: tapId,
    interactiveType:
      typeof interactiveType === "string" ? interactiveType : undefined,
    flowResponseData:
      typeof flowResponseData === "object" && flowResponseData !== null
        ? (flowResponseData as Record<string, unknown>)
        : undefined,
    flowResponseJson:
      typeof flowResponseJson === "string" ? flowResponseJson : undefined,
    standby:
      payload.metadata?.standby === true ||
      payload.metadata?.standby === "true" ||
      payload.metadata?.standby === 1,
  };
}