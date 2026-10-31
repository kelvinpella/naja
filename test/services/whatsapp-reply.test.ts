import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_REPLY_LENGTH, splitReply } from "../../src/services/whatsapp-reply.js";

describe("splitReply", () => {
  it("keeps a short reply as one message", () => {
    assert.deepEqual(splitReply("Karibu Naja!"), ["Karibu Naja!"]);
  });

  it("drops an empty reply instead of sending a blank message", () => {
    assert.deepEqual(splitReply("   \n  "), []);
  });

  it("splits above the WhatsApp limit and respects it", () => {
    const paragraph = "a".repeat(1000);
    const parts = splitReply(Array(6).fill(paragraph).join("\n\n"));
    assert.ok(parts.length > 1);
    for (const part of parts) {
      assert.ok(part.length <= MAX_REPLY_LENGTH);
    }
    assert.equal(parts.join("").replace(/\s/g, ""), "a".repeat(6000));
  });

  it("breaks on a newline when one is available", () => {
    const first = "x".repeat(3000);
    const second = "y".repeat(3000);
    const parts = splitReply(`${first}\n${second}`);
    assert.equal(parts[0], first);
    assert.equal(parts[1], second);
  });
});
