import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toWhatsappMessageJob } from "../../src/services/kapso-event-mapper.js";

function basePayload() {
  return {
    event: "whatsapp.message.received",
    phone_number_id: "pn-1",
    conversation: { id: "conv-1" },
    message: {
      id: "wamid.1",
      from: "255712345678",
      from_user_id: "US.abc123",
      type: "text",
      text: { body: "Habari, nahitaji msaidizi" },
      kapso: { direction: "inbound" },
    },
  };
}

describe("toWhatsappMessageJob identity", () => {
  it("keys the job on the message id and phone number id", () => {
    const job = toWhatsappMessageJob(basePayload());
    assert.equal(job?.eventId, "wamid.1");
    assert.equal(job?.phoneNumberId, "pn-1");
  });

  it("sends to the wa_id and keeps digits only", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: { ...payload.message, from: "+255 712 345 678" },
    });
    assert.equal(job?.recipient, "255712345678");
    assert.equal(job?.recipientType, "phone");
    assert.equal(job?.senderPhone, "255712345678");
  });

  it("falls back to the BSUID when no phone number is present", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: { ...payload.message, from: undefined },
    });
    assert.equal(job?.recipient, "US.abc123");
    assert.equal(job?.recipientType, "bsuid");
    assert.equal(job?.senderPhone, undefined);
  });

  it("keys BSUID contacts consistently across phone-number changes", () => {
    const payload = basePayload();
    const first = toWhatsappMessageJob(payload);
    const second = toWhatsappMessageJob({
      ...payload,
      message: { ...payload.message, from: "255799999999" },
    });
    assert.equal(first?.personKey, second?.personKey);
  });

  it("ignores outbound echoes of our own messages", () => {
    const payload = basePayload();
    assert.equal(
      toWhatsappMessageJob({
        ...payload,
        message: { ...payload.message, kapso: { direction: "outbound" } },
      }),
      null,
    );
  });

  it("rejects payloads without id, phone number id, or sender", () => {
    assert.equal(toWhatsappMessageJob({}), null);
    assert.equal(
      toWhatsappMessageJob({ ...basePayload(), phone_number_id: undefined }),
      null,
    );
    const payload = basePayload();
    assert.equal(
      toWhatsappMessageJob({
        ...payload,
        message: { ...payload.message, from: undefined, from_user_id: undefined },
      }),
      null,
    );
  });
});

describe("toWhatsappMessageJob content", () => {
  it("carries the user's text", () => {
    const job = toWhatsappMessageJob(basePayload());
    assert.equal(job?.text, "Habari, nahitaji msaidizi");
    assert.equal(job?.messageType, "text");
  });

  it("carries an image caption and type, not a text body", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "image",
        text: undefined,
        image: { id: "media-1", caption: "Huyu ni msaidizi wangu" },
      },
    });
    assert.equal(job?.messageType, "image");
    assert.equal(job?.text, undefined);
    assert.equal(job?.caption, "Huyu ni msaidizi wangu");
  });

  it("keeps the type of media with no caption", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: { ...payload.message, type: "audio", text: undefined },
    });
    assert.equal(job?.messageType, "audio");
    assert.equal(job?.caption, undefined);
  });

  it("captures location coordinates", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "location",
        text: undefined,
        location: { latitude: -6.7924, longitude: 39.2083 },
      },
    });
    assert.deepEqual(job?.location, { latitude: -6.7924, longitude: 39.2083 });
  });

  it("carries a Flow completion's token and parsed payload", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        text: undefined,
        interactive: {
          type: "nfm_reply",
          nfm_reply: {
            name: "naja_post_job",
            response_json: JSON.stringify({ title: "Mpishi", budget: "50000" }),
          },
        },
        kapso: { direction: "inbound", flow_token: "post_job:person-1" },
      },
    });
    assert.equal(job?.messageType, "interactive");
    assert.equal(job?.flowToken, "post_job:person-1");
    assert.deepEqual(job?.flowResponse, {
      title: "Mpishi",
      budget: "50000",
    });
    assert.equal(job?.interactiveTitle, undefined);
  });

  it("keeps a Flow payload that Kapso already parsed", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        text: undefined,
        interactive: { type: "nfm_reply", nfm_reply: {} },
        kapso: {
          direction: "inbound",
          flow_token: "post_job:person-1",
          flow_response: { area: "Mbezi" },
        },
      },
    });
    assert.deepEqual(job?.flowResponse, { area: "Mbezi" });
  });

  it("marks a completion as nfm_reply so it can be read back", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        text: undefined,
        // Meta's webhook carries no answers and no token: only the type.
        interactive: { type: "nfm_reply" },
      },
    });
    assert.equal(job?.interactiveType, "nfm_reply");
    assert.equal(job?.flowResponse, undefined);
    assert.equal(job?.flowToken, undefined);
  });

  it("captures the title of a tapped button", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        text: undefined,
        interactive: {
          type: "button_reply",
          button_reply: { id: "old_menu", title: "Tafuta kazi" },
        },
      },
    });
    assert.equal(job?.interactiveTitle, "Tafuta kazi");
    // The payload is what identifies a carousel card's Job, so it is kept.
    assert.equal(job?.interactiveId, "old_menu");
    assert.equal(job?.interactiveType, "button_reply");
  });
});
