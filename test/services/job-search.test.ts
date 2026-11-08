import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cleanKeywords,
  getJobPosterContact,
  listRecentJobs,
  publishJob,
  searchJobsHybrid,
} from "../../src/services/jobs/job-repository.js";
import {
  JOB_PAGE_SIZE,
  type JobListing,
} from "../../src/services/jobs/job-types.js";

type Row = {
  id: string;
  created_at: string;
  title: string | null;
  description: string | null;
  area: string | null;
  budget: number | null;
};

function row(index: number): Row {
  return {
    id: `job-${index}`,
    created_at: `2026-11-0${(index % 9) + 1}T08:00:00Z`,
    title: `Kazi ${index}`,
    description: "Maelezo",
    area: "Mbezi",
    budget: 50_000,
  };
}

function fakeRpcClient(result: { data?: unknown[]; error?: unknown }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return result;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function fakeRowClient(result: { data?: unknown; error?: unknown }) {
  const calls = {
    table: "",
    select: "",
    eqs: [] as [string, unknown][],
  };
  const builder = {
    select(columns: string) {
      calls.select = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eqs.push([column, value]);
      return builder;
    },
    async maybeSingle() {
      return result;
    },
  };
  const client = {
    from(table: string) {
      calls.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const keywords = { swahili: ["mpishi"], english: ["cook"] };

describe("cleanKeywords", () => {
  it("dedupes case-insensitively and drops blanks", () => {
    assert.deepEqual(
      cleanKeywords(["mpishi", " Mpishi ", "", "kupika", "KUPIKA"]),
      ["mpishi", "kupika"],
    );
  });

  it("caps how much one query may contribute", () => {
    assert.equal(cleanKeywords(["a", "b", "c", "d", "e", "f"]).length, 5);
  });
});

describe("searchJobsHybrid", () => {
  it("sends both keyword lists and the query vector to one RPC", async () => {
    const { client, calls } = fakeRpcClient({ data: [row(1)] });

    const outcome = await searchJobsHybrid(
      { query: "nahitaji mpishi", keywords, excludePhone: "+255 712 345 678" },
      { client, embed: async () => [0.1, 0.2] },
    );

    assert.equal(outcome.kind, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.fn, "hybrid_search_jobs");
    assert.deepEqual(calls[0]?.args["p_keywords_swahili"], ["mpishi"]);
    assert.deepEqual(calls[0]?.args["p_keywords_english"], ["cook"]);
    assert.deepEqual(calls[0]?.args["p_query_embedding"], [0.1, 0.2]);
    assert.equal(calls[0]?.args["p_exclude_phone"], "255712345678");
    assert.equal(calls[0]?.args["p_offset"], 0);
  });

  it("maps rows and probes for a next page", async () => {
    const rows = Array.from({ length: JOB_PAGE_SIZE + 1 }, (_, index) =>
      row(index),
    );
    const { client } = fakeRpcClient({ data: rows });

    const outcome = await searchJobsHybrid(
      { query: "mpishi", keywords },
      { client, embed: async () => [1] },
    );

    assert.equal(outcome.kind, "ok");
    if (outcome.kind !== "ok") return;
    assert.equal(outcome.jobs.length, JOB_PAGE_SIZE);
    assert.equal(outcome.hasMore, true);
    assert.deepEqual(outcome.jobs[0], {
      id: "job-0",
      createdAt: "2026-11-01T08:00:00Z",
      title: "Kazi 0",
      description: "Maelezo",
      area: "Mbezi",
      budget: 50_000,
      jobImage: null,
    } satisfies JobListing);
  });

  it("does not search when the query cannot be embedded", async () => {
    const { client, calls } = fakeRpcClient({ data: [] });

    const outcome = await searchJobsHybrid(
      { query: "mpishi", keywords },
      { client, embed: async () => null },
    );

    assert.deepEqual(outcome, { kind: "unavailable" });
    assert.equal(calls.length, 0);
  });

  it("returns nothing without asking the provider when there are no keywords", async () => {
    const { client, calls } = fakeRpcClient({ data: [] });
    let embedded = false;

    const outcome = await searchJobsHybrid(
      { query: "mpishi", keywords: { swahili: [], english: [] } },
      {
        client,
        embed: async () => {
          embedded = true;
          return [1];
        },
      },
    );

    assert.deepEqual(outcome, { kind: "ok", jobs: [], hasMore: false });
    assert.equal(embedded, false);
    assert.equal(calls.length, 0);
  });
});

describe("listRecentJobs", () => {
  it("pages the newest Jobs through list_recent_jobs", async () => {
    const { client, calls } = fakeRpcClient({ data: [row(1), row(2)] });

    const page = await listRecentJobs(9, { excludePhone: "0712345678" }, client);

    assert.equal(page.jobs.length, 2);
    assert.equal(page.hasMore, false);
    assert.deepEqual(calls[0]?.args, {
      p_exclude_phone: "0712345678",
      p_offset: 9,
      p_limit: JOB_PAGE_SIZE + 1,
    });
  });
});

describe("getJobPosterContact", () => {
  it("reads the poster's phone from the published Job row", async () => {
    const { client, calls } = fakeRowClient({
      data: { title: "Mpishi", created_by_phone: "+255712345678" },
    });

    const contact = await getJobPosterContact("job-1", client);

    assert.deepEqual(contact, {
      title: "Mpishi",
      posterPhone: "+255712345678",
    });
    assert.equal(calls.table, "jobs");
    assert.equal(calls.select, "title,created_by_phone");
    assert.deepEqual(calls.eqs, [
      ["id", "job-1"],
      ["reviewed", true],
    ]);
  });

  it("returns null for a Job that is missing or unpublished", async () => {
    const { client } = fakeRowClient({ data: null });
    assert.equal(await getJobPosterContact("job-1", client), null);
  });

  it("throws when the lookup fails, so the tool can report the Job gone", async () => {
    const { client } = fakeRowClient({ data: null, error: new Error("boom") });
    await assert.rejects(() => getJobPosterContact("job-1", client));
  });
});

describe("publishJob", () => {
  it("carries the embedding in the same insert as the publication", async () => {
    const inserted: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        insert: (value: Record<string, unknown>) => {
          inserted.push(value);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "job-1", title: value["title"] },
                error: null,
              }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    await publishJob(
      {
        title: "Mpishi",
        description: "Weekend",
        area: "Mbezi",
        budget: 50_000,
        jobImage: null,
        posterPhone: "+255712345678",
        embedding: [0.1, 0.2],
      },
      client,
    );

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]?.["reviewed"], true);
    assert.deepEqual(inserted[0]?.["embedding"], [0.1, 0.2]);
  });

  it("publishes a Job whose embedding failed", async () => {
    const inserted: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        insert: (value: Record<string, unknown>) => {
          inserted.push(value);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "job-1", title: value["title"] },
                error: null,
              }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    await publishJob(
      {
        title: "Mpishi",
        description: "Weekend",
        area: "Mbezi",
        budget: 50_000,
        jobImage: null,
        posterPhone: null,
        embedding: null,
      },
      client,
    );

    assert.equal(inserted[0]?.["embedding"], null);
    assert.equal(inserted[0]?.["reviewed"], true);
  });
});
