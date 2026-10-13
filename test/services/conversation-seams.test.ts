import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  normalizePhoneDigits,
  toE164Phone,
} from "../../src/services/phone.js";
import { unwrapFlowPayload } from "../../src/services/stages/flow-payload.js";
import { parseFindJobFlowPayload } from "../../src/services/stages/find-job/flow.js";
import { parsePostJobFlowPayload } from "../../src/services/stages/post-job/flow.js";
import {
  idempotencyKeyFor,
  stageIdempotencyKey,
} from "../../src/services/whatsapp-conversation-state.js";
import {
  getStageFlowId,
  isStageId,
} from "../../src/services/whatsapp-stages.js";
import {
  getJobById,
  listJobs,
  renderView,
  searchJobs,
} from "../../src/services/jobs/jobs.js";
import { setJobsDataSource } from "../../src/services/jobs/job-repository.js";
import type { JobListing } from "../../src/services/jobs/job-types.js";

const STUB: JobListing = {
  id: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-10-02T10:00:00Z",
  title: "Mpishi",
  description: "Tunatafuta mpishi.",
  area: "Mbezi",
  budget: 150000,
  jobImage: null,
  reviewed: true,
  skills: ["kupika"],
  posterPhone: "+255712345678",
};

describe("Phone seam", () => {
  it("normalizes to digits and re-adds E.164", () => {
    assert.equal(normalizePhoneDigits("+255 712-345 678"), "255712345678");
    assert.equal(toE164Phone("255712345678"), "+255712345678");
    assert.equal(toE164Phone(null), null);
  });
});

describe("Flow payload adapters", () => {
  it("unwrap response_json strings before parsing", () => {
    const raw = JSON.stringify({ response_json: { keyword: "mpishi" } });
    assert.deepEqual(unwrapFlowPayload(raw), (JSON.parse(raw) as Record<string, unknown>)["response_json"]);
    assert.equal(parseFindJobFlowPayload(raw).keyword, "mpishi");
    const post = JSON.stringify({
      response_json: { title: "X", description: "Y", area: "Z", budget: "5" },
    });
    assert.equal(parsePostJobFlowPayload(post).title, "X");
  });
});

describe("stable idempotency keys", () => {
  it("one scheme per purpose, stable per event", () => {
    assert.equal(
      idempotencyKeyFor("tafuta_kazi", "evt-1", "empty"),
      idempotencyKeyFor("tafuta_kazi", "evt-1", "empty"),
    );
    assert.notEqual(
      idempotencyKeyFor("tafuta_kazi", "evt-1", "empty"),
      idempotencyKeyFor("tafuta_kazi", "evt-1", "error"),
    );
    assert.ok(stageIdempotencyKey("tafuta_kazi", "evt-1").startsWith("naja-tafuta_kazi-"));
  });
});

describe("Stage registry seam", () => {
  it("derives isStageId from the registry, no duplicated set", () => {
    for (const stage of [
      "get_started",
      "tafuta_kazi",
      "tafuta_kazi_search",
      "tafuta_kazi_mixed",
      "tangaza_kazi",
      "vigezo_na_masharti",
      "job_detail",
      "job_apply",
    ]) {
      assert.equal(isStageId(stage), true);
    }
    assert.equal(isStageId("nope"), false);
    assert.equal(isStageId(undefined), false);
  });

  it("resolves Flow ids per stage through one table", () => {
    process.env["ZERNIO_TANGAZA_FLOW_ID"] = "flow-tangaza";
    process.env["ZERNIO_FIND_JOB_FLOW_ID"] = "flow-search";
    try {
      assert.equal(getStageFlowId("tangaza_kazi"), "flow-tangaza");
      assert.equal(getStageFlowId("tafuta_kazi_search"), "flow-search");
      assert.equal(getStageFlowId("tafuta_kazi"), undefined);
      assert.equal(getStageFlowId("get_started"), undefined);
    } finally {
      delete process.env["ZERNIO_TANGAZA_FLOW_ID"];
      delete process.env["ZERNIO_FIND_JOB_FLOW_ID"];
    }
  });
});

describe("Jobs module seam", () => {
  beforeEach(() => {
    setJobsDataSource({
      listJobs: async () => ({ jobs: [STUB], hasMore: false }),
      searchJobs: async () => ({ jobs: [STUB], hasMore: false }),
      getJobById: async (id: string) => (id === STUB.id ? STUB : null),
    });
  });

  afterEach(() => {
    setJobsDataSource(null);
  });

  it("delegates data calls through one interface", async () => {
    assert.equal((await listJobs(0)).jobs.length, 1);
    assert.equal((await searchJobs("mpishi", 0)).jobs.length, 1);
    assert.equal((await getJobById(STUB.id))?.title, "Mpishi");
    assert.equal(await getJobById("missing"), null);
  });

  it("renders empty / single / carousel views", () => {
    assert.equal(
      renderView({ jobs: [], hasMore: false }, { kind: "mixed" }, 0, "H").kind,
      "empty",
    );
    const single = renderView(
      { jobs: [STUB], hasMore: false },
      { kind: "mixed" },
      0,
      "H",
    );
    assert.equal(single.kind, "single");
    const carousel = renderView(
      { jobs: [STUB, { ...STUB, id: "22222222-2222-2222-2222-222222222222" }], hasMore: false },
      { kind: "mixed" },
      0,
      "H",
    );
    assert.equal(carousel.kind, "carousel");
  });
});
