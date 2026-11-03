import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { WhatsappIncomingMessageJob } from "../../src/queues/whatsapp-events.js";
import {
  FlowCompletionUnavailableError,
  hydrateFlowCompletion,
  isFlowCompletion,
  readFlowCompletion,
} from "../../src/services/whatsapp-flow-completion.js";
import { makeJob, silentLogger } from "../helpers/fakes.js";

function completion(overrides: Partial<WhatsappIncomingMessageJob> = {}) {
  return makeJob({
    messageType: "interactive",
    interactiveType: "nfm_reply",
    text: undefined,
    ...overrides,
  });
}

const silent = silentLogger;
const options = (getMessage: (input: unknown) => Promise<unknown>) => ({
  apiKey: "key",
  logger: silent,
  signal: new AbortController().signal,
  deps: { getMessage },
});

describe("isFlowCompletion", () => {
  it("is true only for an nfm_reply", () => {
    assert.equal(isFlowCompletion(completion()), true);
    assert.equal(
      isFlowCompletion(completion({ interactiveType: "button_reply" })),
      false,
    );
    assert.equal(isFlowCompletion(makeJob({ messageType: "text" })), false);
  });

  it("is true whenever a Flow payload is present", () => {
    assert.equal(
      isFlowCompletion(
        makeJob({
          messageType: "interactive",
          interactiveType: "button_reply",
          flowResponse: { title: "Mpishi" },
        }),
      ),
      true,
    );
  });
});

describe("readFlowCompletion", () => {
  it("reads Kapso's camel-cased fields", () => {
    const read = readFlowCompletion({
      kapso: {
        flowToken: "post_job:person-1",
        flowResponse: { title: "Mpishi", budget: "50000" },
      },
    });
    assert.equal(read.flowToken, "post_job:person-1");
    assert.deepEqual(read.flowResponse, { title: "Mpishi", budget: "50000" });
  });

  it("falls back to Meta's response_json and the token inside it", () => {
    const read = readFlowCompletion({
      interactive: {
        nfmReply: {
          responseJson: JSON.stringify({
            title: "Mpishi",
            flow_token: "post_job:person-1",
          }),
        },
      },
    });
    assert.equal(read.flowToken, "post_job:person-1");
    assert.deepEqual(read.flowResponse, {
      title: "Mpishi",
      flow_token: "post_job:person-1",
    });
  });
});

describe("hydrateFlowCompletion", () => {
  it("reads a stripped-down completion back by its message id", async () => {
    const calls: unknown[] = [];
    const job = await hydrateFlowCompletion(
      completion({ eventId: "wamid.1", phoneNumberId: "pn-1" }),
      options(async (input) => {
        calls.push(input);
        return {
          kapso: {
            flowToken: "post_job:person-1",
            flowResponse: { title: "Mpishi", budget: "50000" },
          },
        };
      }),
    );

    assert.deepEqual(calls, [
      {
        phoneNumberId: "pn-1",
        messageId: "wamid.1",
        fields: "kapso(flow_response,flow_token)",
      },
    ]);
    assert.equal(job.flowToken, "post_job:person-1");
    assert.deepEqual(job.flowResponse, { title: "Mpishi", budget: "50000" });
  });

  it("does not call Kapso for a button tap", async () => {
    let called = false;
    const job = completion({ interactiveType: "button_reply" });
    assert.equal(
      await hydrateFlowCompletion(job, options(async () => {
        called = true;
        return {};
      })),
      job,
    );
    assert.equal(called, false);
  });

  it("does not call Kapso when the webhook already had the answers and the token", async () => {
    let called = false;
    const job = completion({
      flowToken: "post_job:person-1",
      flowResponse: { title: "Mpishi" },
    });
    assert.equal(
      await hydrateFlowCompletion(job, options(async () => {
        called = true;
        return {};
      })),
      job,
    );
    assert.equal(called, false);
  });

  it("takes the token from the answers when Kapso sent only those", async () => {
    // The production shape: `kapso.flow_response` arrives, `kapso.flow_token`
    // does not, and the token is inside the payload instead.
    let called = false;
    const hydrated = await hydrateFlowCompletion(
      completion({
        flowResponse: {
          title: "I hope works",
          flow_token: "post_job:person-1",
        },
      }),
      options(async () => {
        called = true;
        return {};
      }),
    );
    assert.equal(hydrated.flowToken, "post_job:person-1");
    assert.equal(called, false);
  });

  it("keeps the token it already had when the webhook carried one", async () => {
    const hydrated = await hydrateFlowCompletion(
      completion({ flowToken: "post_job:person-1" }),
      options(async () => ({
        kapso: {
          flowToken: "post_job:person-1",
          flowResponse: { title: "Mpishi" },
        },
      })),
    );
    assert.equal(hydrated.flowToken, "post_job:person-1");
    assert.deepEqual(hydrated.flowResponse, { title: "Mpishi" });
  });

  it("throws so a failed read-back is retried before anything is sent", async () => {
    await assert.rejects(
      () =>
        hydrateFlowCompletion(
          completion(),
          options(async () => {
            throw new Error("not found yet");
          }),
        ),
      FlowCompletionUnavailableError,
    );
  });
});
