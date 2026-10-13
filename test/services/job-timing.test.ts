import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { setJobsDataSource } from "../../src/services/jobs/job-repository.js";
import {
  getJobById,
  listJobs,
  resetJobsTimingSink,
  setJobsTimingSink,
  type JobsTimingRecord,
} from "../../src/services/jobs/jobs.js";
import type { JobListing, JobPage } from "../../src/services/jobs/job-types.js";

function listing(overrides: Partial<JobListing> = {}): JobListing {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    createdAt: "2026-10-02T10:00:00Z",
    title: "Mpishi",
    description: "Tunatafuta mpishi wa kupika chakula cha asili.",
    area: "Mbezi",
    budget: 150000,
    jobImage: null,
    reviewed: true,
    skills: ["kupika"],
    posterPhone: "+255798765432",
    ...overrides,
  };
}

afterEach(() => {
  setJobsDataSource(null);
  resetJobsTimingSink();
});

describe("job read timing", () => {
  it("records duration and answer size for list reads without changing the answer", async () => {
    const page: JobPage = { jobs: [listing(), listing()], hasMore: true };
    setJobsDataSource({
      listJobs: async () => page,
      searchJobs: async () => ({ jobs: [], hasMore: false }),
      getJobById: async () => null,
    });
    const seen: JobsTimingRecord[] = [];
    setJobsTimingSink((record) => {
      seen.push(record);
    });

    const result = await listJobs(0);

    assert.deepEqual(result, page);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.op, "list");
    assert.equal(typeof seen[0]?.ms, "number");
    assert.ok((seen[0]?.bytes ?? 0) > 0);
    assert.equal(seen[0]?.count, 2);
  });

  it("records duration and answer size for single-job reads", async () => {
    const job = listing();
    setJobsDataSource({
      listJobs: async () => ({ jobs: [], hasMore: false }),
      searchJobs: async () => ({ jobs: [], hasMore: false }),
      getJobById: async () => job,
    });
    const seen: JobsTimingRecord[] = [];
    setJobsTimingSink((record) => {
      seen.push(record);
    });

    const result = await getJobById(job.id);

    assert.deepEqual(result, job);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.op, "get-by-id");
    assert.equal(typeof seen[0]?.ms, "number");
    assert.ok((seen[0]?.bytes ?? 0) > 0);
    assert.equal(seen[0]?.count, 1);
  });
});
