import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveJobsReply } from "../../src/services/jobs/jobs-reply.js";
import type { ModelReply } from "../../src/services/whatsapp-reply-contract.js";
import { silentLogger } from "../helpers/fakes.js";

type Row = {
  id: string;
  created_at: string;
  title: string;
  description: string;
  area: string;
  budget: number;
  job_image: string | null;
};

function row(id: string): Row {
  return {
    id,
    created_at: "2026-11-01T08:00:00Z",
    title: `Kazi ${id}`,
    description: "Maelezo",
    area: "Mbezi",
    budget: 50_000,
    job_image: null,
  };
}

const jobsReply: ModelReply = {
  kind: "jobs",
  body: "Hizi ndizo kazi zinazofanana",
  jobIds: ["job-2", "job-1"],
};

function clientReturning(rows: Row[] | Error): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        in: async () => {
          if (rows instanceof Error) throw rows;
          return { data: rows, error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("resolveJobsReply", () => {
  it("builds cards in the order the reply asked for them", async () => {
    const resolved = await resolveJobsReply(
      jobsReply,
      silentLogger,
      clientReturning([row("job-1"), row("job-2")]),
    );

    assert.equal(resolved.kind, "carousel");
    if (resolved.kind !== "carousel") return;
    assert.equal(resolved.body, jobsReply.body);
    assert.deepEqual(
      resolved.cards.map((card) => card.buttons.map((b) => b.id)),
      [
        ["job_apply:job-2", "job_detail:job-2"],
        ["job_apply:job-1", "job_detail:job-1"],
      ],
    );
  });

  it("passes a non-jobs reply straight through", async () => {
    const text: ModelReply = { kind: "text", body: "Sawa" };
    assert.equal(await resolveJobsReply(text, silentLogger), text);
  });

  it("sends a single Job as text, because a carousel needs two cards", async () => {
    const resolved = await resolveJobsReply(
      { ...jobsReply, jobIds: ["job-1"] },
      silentLogger,
      clientReturning([row("job-1")]),
    );

    assert.equal(resolved.kind, "text");
    if (resolved.kind !== "text") return;
    assert.ok(resolved.body.startsWith(jobsReply.body));
    assert.ok(resolved.body.includes("*Kazi job-1*"));
    assert.ok(resolved.body.includes("Tsh 50,000"));
  });

  it("falls back to text when no id resolves", async () => {
    const resolved = await resolveJobsReply(
      jobsReply,
      silentLogger,
      clientReturning([]),
    );
    assert.deepEqual(resolved, { kind: "text", body: jobsReply.body });
  });

  it("falls back to text when the lookup fails", async () => {
    const resolved = await resolveJobsReply(
      jobsReply,
      silentLogger,
      clientReturning(new Error("supabase is down")),
    );
    assert.deepEqual(resolved, { kind: "text", body: jobsReply.body });
  });
});
