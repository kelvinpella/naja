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
    const job = toWhatsappMessageJob({
      ...basePayload(),
      message: { ...basePayload().message, from: "+255 712 345 678" },
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

describe("toWhatsappMessageJob tap routing", () => {
  it("reads menu button taps from button_reply", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "tafuta_kazi", title: "Tafuta kazi" },
        },
      },
    });
    assert.equal(job?.interactiveId, "tafuta_kazi");
    assert.equal(job?.interactiveType, "button_reply");
  });

  it("captures carousel quick-reply taps from button_reply", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "job_more:mixed:9", title: "Zaidi" },
        },
      },
    });
    assert.equal(job?.interactiveId, "job_more:mixed:9");
  });

  it("falls back to the legacy button payload", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "button",
        button: { payload: "get_started", text: "Rudi" },
      },
    });
    assert.equal(job?.interactiveId, "get_started");
  });

  it("prefers button_reply when both tap fields are present", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        button: { payload: "job_more:mixed:9" },
        interactive: {
          type: "button_reply",
          button_reply: { id: "get_started" },
        },
      },
    });
    assert.equal(job?.interactiveId, "get_started");
  });
});

describe("toWhatsappMessageJob flow responses", () => {
  it("captures nfm_reply response_json", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        interactive: {
          type: "nfm_reply",
          nfm_reply: {
            name: "flow",
            body: "Sent",
            response_json: '{"keyword":"mpishi"}',
          },
        },
      },
    });
    assert.equal(job?.interactiveType, "nfm_reply");
    assert.equal(job?.flowResponseJson, '{"keyword":"mpishi"}');
    assert.equal(job?.flowResponseData, undefined);
  });

  it("prefers Kapso's decoded flow_response object", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        type: "interactive",
        interactive: {
          type: "nfm_reply",
          nfm_reply: { response_json: '{"keyword":"mpishi"}' },
        },
        kapso: {
          direction: "inbound",
          flow_response: { keyword: "mpishi" },
        },
      },
    });
    assert.deepEqual(job?.flowResponseData, { keyword: "mpishi" });
  });

  it("accepts a stringified flow_response", () => {
    const payload = basePayload();
    const job = toWhatsappMessageJob({
      ...payload,
      message: {
        ...payload.message,
        kapso: {
          direction: "inbound",
          flow_response: '{"keyword":"dereva"}',
        },
      },
    });
    assert.equal(job?.flowResponseJson, '{"keyword":"dereva"}');
  });
});
