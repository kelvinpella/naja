import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queue } from "bullmq";

import type { PostingJob } from "../../src/queues/postings.js";
import {
  handlePostJobSubmission,
  PostingEnqueueError,
} from "../../src/services/jobs/post-job-intake.js";
import { makeJob, silentLogger } from "../helpers/fakes.js";

const flowResponse = {
  title: "Mpishi wa pilau anahitajika",
  description: "Nahitaji mpishi wa pilau weekend",
  area: "Mbezi, Dar es Salaam",
  budget: "50000",
  jobImage: [{ id: "media-1", mime_type: "image/jpeg" }],
};

const completion = makeJob({
  messageType: "interactive",
  flowToken: "post_job:person-1",
  flowResponse,
  text: undefined,
});

type Added = { data: PostingJob; jobId?: string };

function makeQueue(calls: string[], fail = false) {
  const added: Added[] = [];
  const queue = {
    add: async (
      _name: string,
      data: PostingJob,
      opts: { jobId?: string } = {},
    ) => {
      if (fail) throw new Error("redis is down");
      calls.push("enqueue");
      added.push({ data, jobId: opts.jobId });
      return { id: opts.jobId };
    },
  } as unknown as Queue<PostingJob>;
  return { queue, added };
}

function deps(calls: string[]) {
  return {
    send: async () => {
      calls.push("send");
      return 1;
    },
    recordNotes: async () => {
      calls.push("notes");
    },
  } as unknown as NonNullable<
    Parameters<typeof handlePostJobSubmission>[0]["deps"]
  >;
}

describe("post job intake", () => {
  it("queues before it answers, and records the receipt last", async () => {
    const calls: string[] = [];
    const { queue, added } = makeQueue(calls);

    await handlePostJobSubmission({
      job: completion,
      apiKey: "key",
      logger: silentLogger,
      signal: new AbortController().signal,
      postings: queue,
      deps: deps(calls),
    });

    assert.deepEqual(calls, ["enqueue", "send", "notes"]);
    assert.equal(added.length, 1);
    assert.equal(added[0]?.data.personKey, "person-1");
    assert.deepEqual(added[0]?.data.details, {
      title: "Mpishi wa pilau anahitajika",
      description: "Nahitaji mpishi wa pilau weekend",
      area: "Mbezi, Dar es Salaam",
      budget: 50000,
    });
    assert.equal(added[0]?.data.media?.id, "media-1");
    // The id is the wamid, so a retried incoming job adds nothing new.
    assert.ok(added[0]?.jobId?.startsWith("posting-"));
  });

  it("answers an invalid Submission immediately and queues nothing", async () => {
    const calls: string[] = [];
    const { queue, added } = makeQueue(calls);

    await handlePostJobSubmission({
      job: makeJob({
        messageType: "interactive",
        flowToken: "post_job:person-1",
        flowResponse: { ...flowResponse, budget: "0" },
        text: undefined,
      }),
      apiKey: "key",
      logger: silentLogger,
      signal: new AbortController().signal,
      postings: queue,
      deps: deps(calls),
    });

    assert.deepEqual(calls, ["send"]);
    assert.equal(added.length, 0);
  });

  it("throws before sending anything when the queue is unavailable", async () => {
    const calls: string[] = [];
    const { queue } = makeQueue(calls, true);

    await assert.rejects(
      handlePostJobSubmission({
        job: completion,
        apiKey: "key",
        logger: silentLogger,
        signal: new AbortController().signal,
        postings: queue,
        deps: deps(calls),
      }),
      PostingEnqueueError,
    );

    // No receipt and no Memory note: the Person was told nothing, so the
    // apology after the retries is the only thing they hear.
    assert.deepEqual(calls, []);
  });
});
