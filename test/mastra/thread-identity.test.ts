import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { personThreadTitle } from "../../src/mastra/thread-identity.js";

describe("personThreadTitle", () => {
  it("labels a Thread with the Person's full phone number", () => {
    assert.equal(
      personThreadTitle({ senderPhone: "255754123456", recipient: "255754123456" }),
      "+255754123456",
    );
  });

  it("keeps the digits WhatsApp sent when they are already bare", () => {
    assert.equal(
      personThreadTitle({ senderPhone: "14155552671", recipient: "14155552671" }),
      "+14155552671",
    );
  });

  it("labels a BSUID-only Person with the BSUID, since there is no number", () => {
    assert.equal(
      personThreadTitle({ recipient: "US.13491208655302741918" }),
      "US.13491208655302741918",
    );
  });
});
