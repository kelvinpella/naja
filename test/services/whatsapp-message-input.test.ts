import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toAgentInput } from "../../src/services/whatsapp-message-input.js";
import { makeJob } from "../helpers/fakes.js";

describe("toAgentInput", () => {
  it("passes text through, trimmed", () => {
    assert.equal(
      toAgentInput(makeJob({ text: "  Nahitaji mpishi  " })),
      "Nahitaji mpishi",
    );
  });

  it("describes an image with its caption", () => {
    assert.equal(
      toAgentInput(
        makeJob({ text: undefined, messageType: "image", caption: "Msaidizi" }),
      ),
      '[image] caption: "Msaidizi"',
    );
  });

  it("describes an image without a caption", () => {
    assert.equal(
      toAgentInput(makeJob({ text: undefined, messageType: "image" })),
      "[image]",
    );
  });

  it("names voice notes so the agent can explain it cannot listen", () => {
    assert.equal(
      toAgentInput(makeJob({ text: undefined, messageType: "audio" })),
      "[voice note]",
    );
  });

  it("includes location coordinates", () => {
    assert.equal(
      toAgentInput(
        makeJob({
          text: undefined,
          messageType: "location",
          location: { latitude: -6.7924, longitude: 39.2083 },
        }),
      ),
      "[location] -6.7924, 39.2083",
    );
  });

  it("uses the tapped option's title", () => {
    assert.equal(
      toAgentInput(
        makeJob({
          text: undefined,
          messageType: "interactive",
          interactiveTitle: "Tafuta kazi",
        }),
      ),
      "[tapped option] Tafuta kazi",
    );
  });

  it("falls back to the raw type for anything unrecognised", () => {
    assert.equal(
      toAgentInput(makeJob({ text: undefined, messageType: "contacts" })),
      "[contact card]",
    );
    assert.equal(
      toAgentInput(makeJob({ text: undefined, messageType: "unknown_kind" })),
      "[unknown_kind message]",
    );
  });
});
