import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  searchJobs,
  setJobsDataSource,
} from "../../src/services/jobs/job-repository.js";
import { JOB_FETCH_SIZE, JOB_PAGE_SIZE } from "../../src/services/jobs/job-types.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    created_at: "2026-10-02T10:00:00Z",
    title: "Mpishi",
    description: "Tunatafuta mpishi wa kupika chakula cha asili.",
    area: "Mbezi",
    budget: 150000,
    job_image: null,
    reviewed: true,
    skills: ["kupika"],
    created_by_phone: "+255798765432",
    ...overrides,
  };
}

function rpcClient(rows: unknown[], seen: Record<string, unknown>) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      seen.fn = fn;
      seen.args = args;
      return { data: rows, error: null };
    },
  } as unknown as SupabaseClient;
}

afterEach(() => setJobsDataSource(null));

describe("ranked job search via rpc", () => {
  it("routes keyword search through search_jobs preserving rank order and paging", async () => {
    const rows = Array.from({ length: JOB_FETCH_SIZE }, (_, i) =>
      jobRow({ id: `job-${i}`, title: `Kazi ${i}` }),
    );
    const seen: Record<string, unknown> = {};
    const page = await searchJobs("mpishi", 0, {}, rpcClient(rows, seen));
    assert.equal(seen.fn, "search_jobs");
    assert.deepEqual(seen.args, {
      p_keyword: "mpishi",
      p_exclude_phone: null,
      p_offset: 0,
      p_limit: JOB_FETCH_SIZE,
    });
    assert.equal(page.jobs.length, JOB_PAGE_SIZE);
    assert.equal(page.hasMore, true);
    assert.equal(page.jobs[0].id, "job-0");
  });

  it("falls back to text match when the rpc is not deployed yet", async () => {
    const row = jobRow({ id: "legacy-1" });
    const terminal: Record<string, unknown> = {
      data: [row],
      error: null,
    };
    terminal.or = () => terminal;
    const chain = {
      or: () => chain,
      order: () => chain,
      range: () => terminal,
    };
    const client = {
      rpc: async () => ({
        data: null,
        error: { code: "PGRST202", message: "function missing" },
      }),
      from: () => ({ select: () => ({ eq: () => chain }) }),
    } as unknown as SupabaseClient;
    const page = await searchJobs("mpishi", 0, {}, client);
    assert.equal(page.jobs.length, 1);
    assert.equal(page.jobs[0].id, "legacy-1");
    assert.equal(page.hasMore, false);
  });

  it("short-circuits empty keywords without touching the database", async () => {
    let touched = false;
    const client = {
      rpc: async () => {
        touched = true;
        return { data: [], error: null };
      },
      from: () => {
        touched = true;
        throw new Error("must not query");
      },
    } as unknown as SupabaseClient;
    const page = await searchJobs("   ", 0, {}, client);
    assert.deepEqual(page, { jobs: [], hasMore: false });
    assert.equal(touched, false);
  });

  it("sends sanitized keyword, phone digits, and paging to the rpc", async () => {
    const seen: Record<string, unknown> = {};
    await searchJobs(
      "  Mpishi (mzoefu)! ",
      9,
      { excludePhone: "+255 712-345-678" },
      rpcClient([], seen),
    );
    assert.deepEqual(seen.args, {
      p_keyword: "Mpishi mzoefu!",
      p_exclude_phone: "255712345678",
      p_offset: 9,
      p_limit: JOB_FETCH_SIZE,
    });
  });

  it("degrades to a query error, never a crash, on hostile input", async () => {
    const terminal: Record<string, unknown> = {
      data: null,
      error: { code: "XX000", message: "boom" },
    };
    terminal.or = () => terminal;
    const chain = {
      or: () => chain,
      order: () => chain,
      range: () => terminal,
    };
    const client = {
      rpc: async () => ({ data: null, error: { code: "XX000", message: "boom" } }),
      from: () => ({ select: () => ({ eq: () => chain }) }),
    } as unknown as SupabaseClient;
    await assert.rejects(searchJobs("((mpishi''))", 0, {}, client), /failed/);
  });
});
