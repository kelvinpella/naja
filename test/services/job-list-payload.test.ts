import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getJobById,
  listJobs,
  LIST_DESCRIPTION_CAP,
  setJobsDataSource,
} from "../../src/services/jobs/job-repository.js";
import { JOB_FETCH_SIZE } from "../../src/services/jobs/job-types.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    created_at: "2026-10-02T10:00:00Z",
    title: "Mpishi",
    description: "x".repeat(500),
    area: "Mbezi",
    budget: 150000,
    job_image: null,
    reviewed: true,
    skills: ["kupika"],
    created_by_phone: "+255798765432",
    ...overrides,
  };
}

function listClient(rows: unknown[]) {
  const terminal: Record<string, unknown> = { data: rows, error: null };
  const chain = {
    or: () => chain,
    order: () => chain,
    range: () => terminal,
  };
  return {
    from: () => ({ select: () => ({ eq: () => chain }) }),
  } as unknown as SupabaseClient;
}

function lookupClient(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

afterEach(() => setJobsDataSource(null));

describe("list payload trim", () => {
  it("caps list descriptions above the card excerpt maximum, keeping paging intact", async () => {
    const rows = Array.from({ length: JOB_FETCH_SIZE }, (_, i) =>
      jobRow({ id: `job-${i}` }),
    );
    const page = await listJobs(0, {}, listClient(rows));

    assert.equal(page.jobs.length, 9);
    assert.equal(page.hasMore, true);
    for (const job of page.jobs) {
      assert.ok(
        (job.description ?? "").length <= LIST_DESCRIPTION_CAP,
        `list description capped, got ${(job.description ?? "").length}`,
      );
    }
  });

  it("keeps full descriptions on the single-job read", async () => {
    const job = await getJobById("job-1", lookupClient(jobRow()));

    assert.equal(job?.description?.length, 500);
  });
});
