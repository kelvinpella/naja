import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getPostJobFlowId,
  isPostJobFlowToken,
  parsePostJobResponse,
  POST_JOB_FAILED_BODY,
  postJobFlowPrefill,
  postJobFlowToken,
  postJobPublished,
  postJobReceipt,
  validatePostJobSubmission,
} from "../../src/services/flows/post-job-flow.js";

const validPayload = {
  title: "  Mpishi wa pilau anahitajika  ",
  description: "Nahitaji mpishi wa pilau weekend",
  area: "Mbezi, Dar es Salaam",
  budget: "50000",
  jobImage: [{ id: "media-1", mime_type: "image/jpeg" }],
};

describe("post job flow token", () => {
  it("carries the person key and recognises its own completions", () => {
    const token = postJobFlowToken("person-1");
    assert.equal(token, "post_job:person-1");
    assert.equal(isPostJobFlowToken(token), true);
  });

  it("does not claim a completion from another Flow or a missing token", () => {
    assert.equal(isPostJobFlowToken("find_job:person-1"), false);
    assert.equal(isPostJobFlowToken(undefined), false);
  });
});

describe("parsePostJobResponse", () => {
  it("reads the camelCase photo field the current Flow sends", () => {
    const parsed = parsePostJobResponse(validPayload);
    assert.equal(parsed.title, "  Mpishi wa pilau anahitajika  ");
    assert.deepEqual(parsed.jobImage, validPayload.jobImage);
  });

  it("still reads the snake_case photo field of an older draft", () => {
    const parsed = parsePostJobResponse({
      ...validPayload,
      jobImage: undefined,
      job_image: [{ id: "media-2" }],
    });
    assert.deepEqual(parsed.jobImage, [{ id: "media-2" }]);
  });

  it("parses a payload that arrives as a JSON string", () => {
    const parsed = parsePostJobResponse(JSON.stringify(validPayload));
    assert.equal(parsed.area, "Mbezi, Dar es Salaam");
    assert.equal(parsed.budget, "50000");
  });

  it("treats a non-object payload as empty instead of throwing", () => {
    assert.equal(parsePostJobResponse("not json").title, undefined);
    assert.equal(parsePostJobResponse(null).description, undefined);
  });
});

describe("validatePostJobSubmission", () => {
  it("trims the text fields and floors the budget", () => {
    const details = validatePostJobSubmission({
      ...validPayload,
      budget: "50000.9",
    });
    assert.equal(details?.title, "Mpishi wa pilau anahitajika");
    assert.equal(details?.budget, 50000);
  });

  it("rejects a payload missing a required field", () => {
    assert.equal(
      validatePostJobSubmission({ ...validPayload, area: "   " }),
      null,
    );
  });

  it("rejects text over the limits the Flow enforces", () => {
    assert.equal(
      validatePostJobSubmission({ ...validPayload, description: "a".repeat(501) }),
      null,
    );
  });

  it("rejects a budget that is not a positive number", () => {
    for (const budget of ["", "abc", "0", "-5", "1000000000"]) {
      assert.equal(
        validatePostJobSubmission({ ...validPayload, budget }),
        null,
        `budget ${JSON.stringify(budget)} should be rejected`,
      );
    }
  });

  it("keeps a submission with no photo", () => {
    const details = validatePostJobSubmission({
      ...validPayload,
      jobImage: undefined,
    });
    assert.equal(details?.jobImage, undefined);
  });
});

describe("posting messages", () => {
  it("names the title in the receipt and promises the outcome", () => {
    assert.equal(
      postJobReceipt("Mpishi wa pilau"),
      "✅ Tumepokea tangazo lako: *Mpishi wa pilau*.\nTunaliangalia; tutakujulisha likishachapishwa.",
    );
  });

  it("names the title when it is published, and only then", () => {
    assert.equal(
      postJobPublished("Mpishi wa pilau"),
      "🎉 Tangazo lako *Mpishi wa pilau* limechapishwa.",
    );
  });

  it("keeps the failure body free of any claim that it was posted", () => {
    assert.match(POST_JOB_FAILED_BODY, /halikuchapishwa/);
    assert.match(POST_JOB_FAILED_BODY, /jaribu tena/);
  });
});

describe("postJobFlowPrefill", () => {
  it("sends the typed fields back as strings the Form can bind", () => {
    assert.deepEqual(
      postJobFlowPrefill({
        title: "Mpishi wa pilau",
        description: "Weekend tu",
        area: "Mbezi",
        budget: 50000,
      }),
      {
        title: "Mpishi wa pilau",
        description: "Weekend tu",
        area: "Mbezi",
        budget: "50000",
      },
    );
  });
});

describe("getPostJobFlowId", () => {
  it("returns the configured draft id and ignores a blank one", () => {
    const previous = process.env["KAPSO_POST_JOB_FLOW_ID"];
    try {
      process.env["KAPSO_POST_JOB_FLOW_ID"] = " flow-1 ";
      assert.equal(getPostJobFlowId(), "flow-1");
      process.env["KAPSO_POST_JOB_FLOW_ID"] = "  ";
      assert.equal(getPostJobFlowId(), undefined);
    } finally {
      if (previous === undefined) delete process.env["KAPSO_POST_JOB_FLOW_ID"];
      else process.env["KAPSO_POST_JOB_FLOW_ID"] = previous;
    }
  });
});
