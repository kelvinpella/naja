import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_INTERACTIVE_BODY_LENGTH,
  renderReplyText,
  replyFromText,
  replySchema,
  toWhatsappReply,
  type WhatsappReply,
} from "../../src/services/whatsapp-reply-contract.js";

const welcome: WhatsappReply = {
  kind: "buttons",
  body: "Naja – Tangaza au omba kazi ndogo ndogo za nyumbani: upishi, usafi, ufundi n.k.",
  buttons: [
    { id: "tafuta", title: "Tafuta kazi" },
    { id: "tangaza", title: "Tangaza kazi" },
    { id: "vigezo", title: "Vigezo na masharti" },
  ],
};

describe("replySchema", () => {
  it("accepts the three Options as buttons", () => {
    const parsed = replySchema.safeParse(welcome);
    assert.equal(parsed.success, true);
  });

  it("rejects a fourth button, which Meta would refuse", () => {
    const parsed = replySchema.safeParse({
      ...welcome,
      buttons: [...(welcome as { buttons: unknown[] }).buttons, { id: "x", title: "Nyingine" }],
    });
    assert.equal(parsed.success, false);
  });

  it("rejects a body over the interactive limit so the Turn degrades to text", () => {
    const parsed = replySchema.safeParse({
      ...welcome,
      body: "a".repeat(MAX_INTERACTIVE_BODY_LENGTH + 1),
    });
    assert.equal(parsed.success, false);
  });
});

describe("renderReplyText", () => {
  it("numbers the buttons so a text reply keeps the same choices", () => {
    assert.equal(
      renderReplyText(welcome),
      `${welcome.body}\n\n1. Tafuta kazi\n2. Tangaza kazi\n3. Vigezo na masharti`,
    );
  });

  it("numbers the rows of a list", () => {
    const reply: WhatsappReply = {
      kind: "list",
      body: "Ni kazi gani?",
      buttonText: "Chagua",
      rows: [
        { id: "upishi", title: "Upishi" },
        { id: "usafi", title: "Usafi wa nyumba" },
      ],
    };
    assert.equal(renderReplyText(reply), "Ni kazi gani?\n\n1. Upishi\n2. Usafi wa nyumba");
  });

  it("keeps a plain text reply as it is", () => {
    const reply: WhatsappReply = { kind: "text", body: "Karibu Naja!" };
    assert.equal(renderReplyText(reply), "Karibu Naja!");
  });

  it("carries the URL of a link button into the text", () => {
    const reply: WhatsappReply = {
      kind: "cta_url",
      body: "Vigezo na masharti:",
      displayText: "Soma",
      url: "https://naja.example/terms",
    };
    assert.equal(
      renderReplyText(reply),
      "Vigezo na masharti:\n\nhttps://naja.example/terms",
    );
  });
});

describe("replyFromText", () => {
  it("recovers a reply from a fenced JSON envelope", () => {
    const recovered = replyFromText("```json\n" + JSON.stringify(welcome) + "\n```");
    assert.deepEqual(recovered, welcome);
  });

  it("returns nothing for prose", () => {
    assert.equal(replyFromText("Karibu Naja!"), null);
  });

  it("returns nothing for JSON that does not match the schema", () => {
    assert.equal(replyFromText('{"kind":"buttons"}'), null);
  });
});

describe("toWhatsappReply", () => {
  it("prefers the structured object over whatever text came with it", () => {
    assert.deepEqual(toWhatsappReply(welcome, "some raw text"), welcome);
  });

  it("sends prose as a text reply when the model ignored the schema", () => {
    assert.deepEqual(toWhatsappReply(undefined, "  Karibu Naja!  "), {
      kind: "text",
      body: "Karibu Naja!",
    });
  });

  it("never sends a broken envelope to a person", () => {
    assert.equal(toWhatsappReply(undefined, '{"kind":"buttons","body":'), null);
  });

  it("sends nothing when the model produced nothing", () => {
    assert.equal(toWhatsappReply(undefined, "   "), null);
  });
});
