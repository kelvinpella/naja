import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  sendJobText,
  sendStageMessage,
} from "../../src/services/whatsapp-stage-messages.js";
import type { WhatsappIncomingMessageJob } from "../../src/queues/whatsapp-events.js";

function makeJob(overrides: Partial<WhatsappIncomingMessageJob> = {}) {
  return {
    eventId: "evt-1",
    personKey: "person-1",
    phoneNumberId: "pn-1",
    recipient: "255712345678",
    recipientType: "phone",
    senderPhone: "255712345678",
    ...overrides,
  } as WhatsappIncomingMessageJob;
}

const silentLogger = { info: () => {}, error: () => {}, warn: () => {} } as never;

function stubFetch(
  calls: unknown[],
  respond: (call: number) => { status: number; body: unknown },
) {
  let n = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    n += 1;
    let parsed: Record<string, unknown>;
    if (input instanceof Request) {
      const text = await input.text();
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } else {
      parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
    }
    calls.push({ input: String(input), body: parsed });
    const { status, body } = respond(n);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("sender Results", () => {
  let originalFetch: typeof fetch;
  let originalFlowId: string | undefined;
  let calls: unknown[];

  beforeEach(() => {
    calls = [];
    originalFetch = globalThis.fetch;
    originalFlowId = process.env["KAPSO_TANGAZA_FLOW_ID"];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalFlowId === undefined) delete process.env["KAPSO_TANGAZA_FLOW_ID"];
    else process.env["KAPSO_TANGAZA_FLOW_ID"] = originalFlowId;
  });

  it("reports flow when the Flow send succeeds", async () => {
    process.env["KAPSO_TANGAZA_FLOW_ID"] = "flow-1";
    stubFetch(calls, () => ({ status: 200, body: { success: true, data: {} } }));
    const result = await sendStageMessage(
      "tangaza_kazi",
      makeJob(),
      "key",
      "idem-1",
      AbortSignal.timeout(5000),
      { logger: silentLogger },
    );
    assert.equal(result.sentAs, "flow");
    assert.equal(calls.length, 1);
  });

  it("reports buttons when the Flow send falls back", async () => {
    process.env["KAPSO_TANGAZA_FLOW_ID"] = "flow-1";
    stubFetch(calls, (n) =>
      n === 1
        ? { status: 400, body: { error: { message: "blocked" } } }
        : { status: 200, body: { success: true, data: {} } },
    );
    const result = await sendStageMessage(
      "tangaza_kazi",
      makeJob(),
      "key",
      "idem-1",
      AbortSignal.timeout(5000),
      { logger: silentLogger },
    );
    assert.equal(result.sentAs, "buttons");
    assert.equal(calls.length, 2);
  });

  it("reports text when the banner image send falls back", async () => {
    delete process.env["KAPSO_TANGAZA_FLOW_ID"];
    stubFetch(calls, (n) =>
      n === 1
        ? { status: 400, body: { error: { message: "bad image" } } }
        : { status: 200, body: { success: true, data: {} } },
    );
    const result = await sendStageMessage(
      "tafuta_kazi",
      makeJob(),
      "key",
      "idem-1",
      AbortSignal.timeout(5000),
      { logger: silentLogger },
    );
    assert.equal(result.sentAs, "text");
    assert.equal(calls.length, 2);
  });

  it("reports buttons vs text for job messages", async () => {
    stubFetch(calls, () => ({ status: 200, body: { success: true, data: {} } }));
    const withButtons = await sendJobText(
      "hi",
      [{ title: "Rudi nyuma", payload: "get_started" }],
      makeJob(),
      "key",
      "idem-1",
      AbortSignal.timeout(5000),
    );
    const plain = await sendJobText(
      "done",
      [],
      makeJob(),
      "key",
      "idem-2",
      AbortSignal.timeout(5000),
    );
    assert.equal(withButtons.sentAs, "buttons");
    assert.equal(plain.sentAs, "text");
  });
});
