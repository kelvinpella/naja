import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { STAGE_MESSAGES as REGISTRY } from "../../src/services/whatsapp-stages.js";
import { setJobsDataSource } from "../../src/services/jobs/job-repository.js";
import type { JobListing } from "../../src/services/jobs/job-types.js";
import type {
  ConversationStage,
  ConversationState,
} from "../../src/services/whatsapp-conversation-state.js";
import { handleStagedConversation } from "../../src/services/whatsapp-staged-conversation.js";
import { processWhatsappMessage } from "../../src/services/whatsapp-conversation.js";
import { conversationKey } from "../../src/services/whatsapp-conversation-state.js";
import type { WhatsappIncomingMessageJob } from "../../src/queues/whatsapp-events.js";

const EXPECTED_STAGES: ConversationStage[] = [
  "get_started",
  "tafuta_kazi",
  "tafuta_kazi_search",
  "tafuta_kazi_mixed",
  "tangaza_kazi",
  "vigezo_na_masharti",
  "job_detail",
  "job_apply",
];

const STUB_JOBS: JobListing[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    createdAt: "2026-10-02T10:00:00Z",
    title: "Mpishi",
    description: "Tunatafuta mpishi mwenye uzoefu wa kupika chakula cha asili.",
    budget: 150000,
    skills: ["kupika"],
    posterPhone: "+255712345678",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    createdAt: "2026-10-01T10:00:00Z",
    title: "Dereva",
    description: "Dereva wa gari binafsi jijini.",
    budget: null,
    skills: ["kuendesha"],
    posterPhone: "+255798765432",
  },
];

function stubJobs() {
  setJobsDataSource({
    listJobs: async () => ({ jobs: STUB_JOBS, hasMore: false }),
    searchJobs: async (keyword: string) => ({
      jobs: STUB_JOBS.filter((job) =>
        `${job.title} ${job.description}`.toLowerCase().includes(keyword.toLowerCase()),
      ),
      hasMore: false,
    }),
    getJobById: async (id: string) =>
      STUB_JOBS.find((job) => job.id === id) ?? null,
  });
}

describe("STAGE_MESSAGES map", () => {
  it("contains get_started plus extensible stages", () => {
    assert.deepEqual(new Set(Object.keys(REGISTRY)), new Set(EXPECTED_STAGES));
  });

  it("gives every child stage a back path to get_started", () => {
    for (const stage of EXPECTED_STAGES.filter((s) => s !== "get_started")) {
      const buttons = REGISTRY[stage].buttons;
      assert.ok(
        buttons.some((b) => b.payload === "get_started"),
        `${stage} should include a back button to get_started`,
      );
    }
  });

  it("gives get_started three option buttons that are themselves stages", () => {
    const payloads = REGISTRY["get_started"].buttons.map((b) => b.payload);
    assert.deepEqual(new Set(payloads), new Set(["tafuta_kazi", "tangaza_kazi", "vigezo_na_masharti"]));
  });

  it("renders the get-started menu with banner and formatted options", () => {
    const menu = REGISTRY["get_started"];
    assert.equal(
      menu.imageUrl,
      "https://res.cloudinary.com/dpw2dpthx/image/upload/v1791069460/Naja_get_started_banner_caezkp.jpg",
    );
    assert.ok(menu.body.includes("Karibu! Naja ni kwa ajili ya matangazo"));
    assert.ok(menu.body.includes("*Tafuta kazi*"));
    assert.ok(menu.body.includes("*Tangaza kazi*"));
  });

  it("renders tafuta_kazi menu with banner, formatted body, and ordered options", () => {
    const tafuta = REGISTRY["tafuta_kazi"];
    assert.equal(
      tafuta.imageUrl,
      "https://res.cloudinary.com/dpw2dpthx/image/upload/v1791161180/tafuta_kazi_banner_iw3axp.jpg",
    );
    assert.ok(tafuta.body.includes("*Maelezo*"));
    assert.ok(tafuta.body.includes("*Andika jina la kazi*"));
    assert.ok(tafuta.body.includes("*Kazi mpya mchanganyiko*"));
    assert.ok(tafuta.body.includes("*Rudi nyuma*"));
    assert.deepEqual(
      tafuta.buttons.map((b) => b.payload),
      ["tafuta_kazi_search", "tafuta_kazi_mixed", "get_started"],
    );
    assert.deepEqual(
      tafuta.buttons.map((b) => b.title),
      ["Andika jina la kazi", "Kazi mchanganyiko", "Rudi nyuma"],
    );
  });

  it("keeps every menu button title within Meta's 20-char reply limit", () => {
    for (const [stage, message] of Object.entries(REGISTRY)) {
      for (const button of message.buttons) {
        assert.ok(
          button.title.length <= 20,
          `${stage} button "${button.title}" exceeds 20 chars`,
        );
      }
    }
  });
});

type FakeRedis = {
  store: Map<string, string>;
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    ..._args: unknown[]
  ) => Promise<string>;
  del: (key: string) => Promise<number>;
};

function makeRedis(): FakeRedis {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  };
}

function makeJob(
  overrides: Partial<WhatsappIncomingMessageJob> = {},
): WhatsappIncomingMessageJob {
  return {
    eventId: "evt-1",
    personKey: "person-1",
    phoneNumberId: "pn-1",
    recipient: "255712345678",
    recipientType: "phone",
    ...overrides,
  };
}

function makeState(
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

const silentLogger = {
  info: () => {},
  error: () => {},
} as unknown as import("fastify").FastifyBaseLogger;

describe("handleStagedConversation transitions", () => {
  let fetchCalls: { url: URL; body: Record<string, unknown> }[] = [];
  let originalFetch: typeof fetch;
  let originalFlowId: string | undefined;
  let originalLegacyFlowId: string | undefined;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    originalFlowId = process.env["KAPSO_FIND_JOB_FLOW_ID"];
    originalLegacyFlowId = process.env["KAPSO_TAFUTA_FLOW_ID"];
    delete process.env["KAPSO_FIND_JOB_FLOW_ID"];
    delete process.env["KAPSO_TAFUTA_FLOW_ID"];
    stubJobs();
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      let parsed: Record<string, unknown>;
      let url: URL;
      if (input instanceof Request) {
        url = new URL(input.url);
        const text = await input.text();
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } else {
        parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
        url = new URL(String(input));
      }
      fetchCalls.push({ url, body: parsed });
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setJobsDataSource(null);
    if (originalFlowId === undefined) delete process.env["KAPSO_FIND_JOB_FLOW_ID"];
    else process.env["KAPSO_FIND_JOB_FLOW_ID"] = originalFlowId;
    if (originalLegacyFlowId === undefined) delete process.env["KAPSO_TAFUTA_FLOW_ID"];
    else process.env["KAPSO_TAFUTA_FLOW_ID"] = originalLegacyFlowId;
  });

  it("selecting tafuta_kazi moves to that stage and sends its menu", async () => {
    const redis = makeRedis();
    const state = makeState();
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-select", interactiveId: "tafuta_kazi" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "tafuta_kazi");
    assert.equal(fetchCalls.length, 1);
    const menu = fetchCalls[0].body["interactive"] as {
      body: { text: string };
      action: { buttons: { reply: { id: string } }[] };
    };
    assert.ok(menu.body.text.includes("*Maelezo*"));
    assert.deepEqual(
      menu.action.buttons.map((b) => b.reply.id),
      ["tafuta_kazi_search", "tafuta_kazi_mixed", "get_started"],
    );
    const saved = JSON.parse(redis.store.get("k") as string) as ConversationState;
    assert.equal(saved.stage, "tafuta_kazi");
  });

  it("falls back to text-only when the banner image send fails", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls += 1;
      let parsed: Record<string, unknown>;
      let url: URL;
      if (input instanceof Request) {
        url = new URL(input.url);
        const text = await input.text();
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } else {
        parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
        url = new URL(String(input));
      }
      fetchCalls.push({ url, body: parsed });
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "bad image" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const redis = makeRedis();
    const state = makeState();
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-select", interactiveId: "tafuta_kazi" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "tafuta_kazi");
    assert.equal(calls, 2);
    assert.ok("header" in (fetchCalls[0].body["interactive"] as object));
    assert.ok(
      !("header" in (fetchCalls[1].body["interactive"] as object)),
    );
  });

  it("selecting tafuta_kazi_search moves to search and falls back to buttons without a flow id", async () => {
    const redis = makeRedis();
    const state = makeState({ stage: "tafuta_kazi" });
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-search", interactiveId: "tafuta_kazi_search" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "tafuta_kazi_search");
    assert.equal(fetchCalls.length, 1);
    const fallback = fetchCalls[0].body["interactive"] as {
      type: string;
      body: { text: string };
    };
    assert.equal(fallback.type, "button");
    assert.ok(fallback.body.text.length > 0);
  });

  it("selecting tafuta_kazi_mixed sends the live job carousel", async () => {
    const redis = makeRedis();
    const state = makeState({ stage: "tafuta_kazi" });
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-mixed", interactiveId: "tafuta_kazi_mixed" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "tafuta_kazi_mixed");
    assert.equal(fetchCalls.length, 1);
    const interactive = fetchCalls[0].body["interactive"] as {
      type: string;
      action: { cards: unknown[] };
    };
    assert.equal(interactive.type, "carousel");
    assert.equal(interactive.action.cards.length, 2);
  });

  it("nfm_reply flow responses search jobs and send the carousel", async () => {
    const redis = makeRedis();
    const logged: Record<string, unknown>[] = [];
    const logger = {
      info: (obj: Record<string, unknown>) => void logged.push(obj),
      error: () => {},
    } as unknown as import("fastify").FastifyBaseLogger;
    const state = makeState({ stage: "tafuta_kazi_search" });
    await handleStagedConversation({
      job: makeJob({
        eventId: "evt-flow",
        interactiveType: "nfm_reply",
        flowResponseData: { keyword: "a" },
      }),
      redis: redis as never,
      apiKey: "key",
      logger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "tafuta_kazi_search");
    assert.equal(state.listKeyword, "a");
    assert.equal(fetchCalls.length, 1);
    const interactive = fetchCalls[0].body["interactive"] as {
      type: string;
    };
    assert.equal(interactive.type, "carousel");
    assert.ok(logged.some((entry) => entry["keyword"] === "a"));
  });

  it("a single search hit sends a reply-buttons message with the card image", async () => {
    const redis = makeRedis();
    const state = makeState({ stage: "tafuta_kazi_search" });
    await handleStagedConversation({
      job: makeJob({
        eventId: "evt-flow-single",
        interactiveType: "nfm_reply",
        flowResponseData: { keyword: "mpishi" },
      }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body["type"], "interactive");
    const card = fetchCalls[0].body["interactive"] as {
      header: { type: string; image: { link: string } };
      body: { text: string };
      action: { buttons: { reply: { id: string } }[] };
    };
    assert.equal(card.header.type, "image");
    assert.ok(card.header.image.link.includes("kazi_mpya_kvncsh"));
    assert.ok(card.body.text.includes("mpishi mwenye uzoefu"));
    assert.ok(
      card.action.buttons.some((b) =>
        b.reply.id.startsWith(
          "job_apply:11111111-1111-1111-1111-111111111111",
        ),
      ),
    );
    assert.equal(state.selectedJobId, "11111111-1111-1111-1111-111111111111");
  });

  it("old card buttons still work after state was cleared by Omba", async () => {
    const redis = makeRedis();
    await processWhatsappMessage(
      makeJob({
        eventId: "evt-old-tap",
        interactiveId: "job_detail:11111111-1111-1111-1111-111111111111",
      }),
      redis as never,
      "key",
      silentLogger,
      AbortSignal.timeout(5000),
    );

    assert.ok(fetchCalls.length >= 1);
    const lastBody = fetchCalls[fetchCalls.length - 1].body;
    assert.ok(
      (
        (lastBody["interactive"] as { body: { text: string } }).body
          .text
      ).includes("mpishi mwenye uzoefu"),
    );
    const saved = JSON.parse(
      redis.store.get(
        [...redis.store.keys()].find((k) => k.startsWith("naja:")) as string,
      ) as string,
    ) as ConversationState;
    assert.equal(saved.stage, "job_detail");
  });

  it("does not wait for the typing indicator before doing handler work", async () => {
    const redis = makeRedis();
    redis.store.set(
      conversationKey("person-1", "pn-1"),
      JSON.stringify(makeState({ stage: "tafuta_kazi_mixed" })),
    );
    let releaseTyping!: (value: Response) => void;
    const typingGate = new Promise<Response>((resolve) => {
      releaseTyping = resolve;
    });
    const ok = () =>
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return typingGate;
      return ok();
    }) as typeof fetch;

    const pending = processWhatsappMessage(
      makeJob({ eventId: "evt-typing", interactiveId: "tafuta_kazi_mixed" }),
      redis as never,
      "key",
      silentLogger,
      AbortSignal.timeout(5000),
    );
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.ok(
      calls >= 2,
      `handler fetch attempted while typing pending, got ${calls} call(s)`,
    );
    releaseTyping(ok());
    await pending;
    assert.ok(calls >= 2);
  });

  it("tapping Soma zaidi sends the full job description", async () => {
    const redis = makeRedis();
    const state = makeState({ stage: "tafuta_kazi_mixed" });
    await handleStagedConversation({
      job: makeJob({
        eventId: "evt-detail",
        interactiveId: "job_detail:11111111-1111-1111-1111-111111111111",
      }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "job_detail");
    assert.equal(state.selectedJobId, "11111111-1111-1111-1111-111111111111");
    assert.equal(fetchCalls.length, 1);
    assert.ok(
      (
        (fetchCalls[0].body["interactive"] as { body: { text: string } })
          .body.text
      ).includes("mpishi mwenye uzoefu"),
    );
  });

  it("tapping Omba shares the poster contact and clears the stage", async () => {
    const redis = makeRedis();
    redis.store.set("k", JSON.stringify(makeState({ stage: "job_detail" })));
    const state = makeState({ stage: "job_detail" });
    await handleStagedConversation({
      job: makeJob({
        eventId: "evt-apply",
        interactiveId: "job_apply:11111111-1111-1111-1111-111111111111",
      }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(fetchCalls.length, 1);
    const text = fetchCalls[0].body["text"] as { body: string };
    assert.ok(text.body.startsWith("✅ Waweza wasiliana"));
    assert.ok(text.body.includes("Phone:+255712345678"));
    assert.equal(fetchCalls[0].body["type"], "text");
    assert.equal(redis.store.get("k"), undefined);
  });

  it("free text replays the current stage without changing it", async () => {
    const redis = makeRedis();
    const state = makeState({ stage: "tafuta_kazi" });
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-free" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "tafuta_kazi");
    assert.equal(fetchCalls.length, 1);
    assert.ok(
      (
        (fetchCalls[0].body["interactive"] as { body: { text: string } })
          .body.text
      ).includes("*Maelezo*"),
    );
  });

  it("last tap wins even from an old message", async () => {
    const redis = makeRedis();
    const state = makeState({ stage: "tafuta_kazi" });
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-switch", interactiveId: "tangaza_kazi" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "tangaza_kazi");
    assert.equal(
      (fetchCalls[0].body["interactive"] as { body: { text: string } }).body
        .text,
      REGISTRY["tangaza_kazi"].body,
    );
  });

  it("back button returns to get_started and re-sends the menu", async () => {
    const redis = makeRedis();
    const state = makeState({ stage: "tafuta_kazi" });
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-back", interactiveId: "get_started" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(state.stage, "get_started");
    assert.equal(
      (fetchCalls[0].body["interactive"] as { body: { text: string } }).body
        .text,
      REGISTRY["get_started"].body,
    );
  });

  it("selecting vigezo_na_masharti sends the terms and clears the stage", async () => {
    const redis = makeRedis();
    redis.store.set("k", JSON.stringify(makeState({ stage: "get_started" })));
    const state = makeState({ stage: "get_started" });
    await handleStagedConversation({
      job: makeJob({ eventId: "evt-terms", interactiveId: "vigezo_na_masharti" }),
      redis: redis as never,
      apiKey: "key",
      logger: silentLogger,
      signal: AbortSignal.timeout(5000),
      key: "k",
      state,
    });

    assert.equal(fetchCalls.length, 1);
    const terms = fetchCalls[0].body["interactive"] as {
      body: { text: string };
      action: { buttons: { reply: { title: string } }[] };
    };
    assert.ok(terms.body.text.includes("*Vigezo na Masharti ya Naja*"));
    assert.deepEqual(
      terms.action.buttons.map((b) => b.reply.title),
      ["Rudi nyuma"],
    );
    assert.equal(redis.store.get("k"), undefined);
  });

  it("tapping Vigezo on an old message without stored state still enters the terms stage", async () => {
    const redis = makeRedis();
    await processWhatsappMessage(
      makeJob({
        eventId: "evt-old-terms",
        interactiveId: "vigezo_na_masharti",
      }),
      redis as never,
      "key",
      silentLogger,
      AbortSignal.timeout(5000),
    );

    assert.ok(fetchCalls.length >= 1);
    const lastBody = fetchCalls[fetchCalls.length - 1].body;
    assert.ok(
      (
        (lastBody["interactive"] as { body: { text: string } }).body
          .text
      ).includes("*Vigezo na Masharti ya Naja*"),
    );
  });
});
