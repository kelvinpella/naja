// Shared fakes for service tests. See Fastify testing guidance: Test Factory Pattern.
import type { WhatsappIncomingMessageJob } from "../../src/queues/whatsapp-events.js";
import type { ConversationState } from "../../src/services/whatsapp-conversation-state.js";

export type FakeRedis = {
  store: Map<string, string>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ..._args: unknown[]) => Promise<string>;
};

export function makeFakeRedis(): FakeRedis {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
  };
}

export function makeJob(
  overrides: Partial<WhatsappIncomingMessageJob> = {},
): WhatsappIncomingMessageJob {
  return {
    eventId: "evt-1",
    personKey: "person-1",
    phoneNumberId: "pn-1",
    recipient: "255712345678",
    recipientType: "phone",
    senderPhone: "255712345678",
    ...overrides,
  };
}

export function makeState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return {
    stage: "get_started",
    promptSent: true,
    promptEventId: "evt-0",
    responses: [],
    ...overrides,
  };
}

export const silentLogger = {
  info: () => {},
  error: () => {},
} as unknown as import("fastify").FastifyBaseLogger;
