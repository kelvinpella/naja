import type { FastifyBaseLogger } from "fastify";
import { buildKapsoMessageFields } from "@kapso/whatsapp-cloud-api";
import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";
import { getKapsoClient, withAbort } from "./kapso-client.js";

// Kapso forwards Meta's webhook as-is for a Flow completion: the message has
// `interactive.type: "nfm_reply"` and nothing else. The token and the answers
// are only on Kapso's own record of the message, so the completion has to be
// read back before it can be routed (see ADR 0006).
const FLOW_FIELDS = buildKapsoMessageFields("flow_response", "flow_token");

export class FlowCompletionUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Flow completion could not be read back from Kapso", { cause });
  }
}

/**
 * A Flow completion, as opposed to a tapped button or list row. A payload in
 * hand is proof enough, even if the webhook left `interactive.type` out: a
 * completion must never be mistaken for a chat message.
 */
export function isFlowCompletion(
  job: Pick<
    WhatsappIncomingMessageJob,
    "messageType" | "interactiveType" | "flowResponse"
  >,
): boolean {
  if (job.flowResponse !== undefined) return true;
  return (
    job.messageType === "interactive" && job.interactiveType === "nfm_reply"
  );
}

type ReadBackMessage = {
  interactive?: { nfmReply?: { responseJson?: unknown } };
  kapso?: { flowToken?: unknown; flowResponse?: unknown };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return asRecord(parsed);
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The completion's token and answers, whichever place Kapso put them in. The
 * SDK camel-cases its own fields, while the echoed `response_json` is Meta's
 * snake_case payload, which still carries `flow_token` inside it.
 */
export function readFlowCompletion(
  message: ReadBackMessage,
): { flowToken?: string; flowResponse?: unknown } {
  const response =
    asRecord(message.kapso?.flowResponse) ??
    asRecord(message.interactive?.nfmReply?.responseJson) ??
    undefined;

  const token =
    typeof message.kapso?.flowToken === "string"
      ? message.kapso.flowToken
      : typeof response?.["flow_token"] === "string"
        ? (response["flow_token"] as string)
        : undefined;

  return { flowToken: token, flowResponse: response };
}

export type HydrateFlowCompletionOptions = {
  apiKey: string;
  logger: FastifyBaseLogger;
  signal: AbortSignal;
  // Injected so the routing can be tested without Kapso.
  deps?: {
    getMessage?: (input: {
      phoneNumberId: string;
      messageId: string;
      fields: string;
    }) => Promise<unknown>;
  };
};

/**
 * Fills in a Flow completion's token and answers from Kapso before the worker
 * routes it. A message that already carries them (or is not a Flow completion)
 * is returned untouched, so this stays one round trip only where it is needed.
 *
 * A failed read-back throws, and BullMQ retries the message: nothing has been
 * sent to the Person yet, so a retry is invisible.
 */
export async function hydrateFlowCompletion(
  job: WhatsappIncomingMessageJob,
  { apiKey, logger, signal, deps = {} }: HydrateFlowCompletionOptions,
): Promise<WhatsappIncomingMessageJob> {
  if (!isFlowCompletion(job)) return job;

  // Kapso sometimes enriches the webhook with the answers but not the token,
  // which still travels inside the payload as `flow_token`. Read it out of the
  // answers rather than spending a round trip.
  if (job.flowResponse !== undefined) {
    if (job.flowToken) return job;
    const { flowToken } = readFlowCompletion({
      kapso: { flowResponse: job.flowResponse },
    });
    return flowToken ? { ...job, flowToken } : job;
  }

  const getMessage =
    deps.getMessage ??
    ((input) => getKapsoClient(apiKey).messages.get(input));

  let message: unknown;
  try {
    message = await withAbort(
      getMessage({
        phoneNumberId: job.phoneNumberId,
        messageId: job.eventId,
        fields: FLOW_FIELDS,
      }),
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    throw new FlowCompletionUnavailableError(error);
  }

  const { flowToken, flowResponse } = readFlowCompletion(
    (message ?? {}) as ReadBackMessage,
  );

  if (flowResponse === undefined) {
    // A Flow that is not ours, or one that completed without answers. The
    // model still sees `[completed a form]`, it just cannot act on it.
    logger.warn(
      { eventId: job.eventId, flowToken },
      "Flow completion came back without a payload",
    );
    return flowToken ? { ...job, flowToken } : job;
  }

  return { ...job, flowToken, flowResponse };
}
