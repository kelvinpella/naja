import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { setJobsDataSource } from "../../src/services/jobs/job-repository.js";
import {
  createJob,
  getJobById,
  listJobs,
  resetJobsCache,
  resetJobsTimingSink,
  searchJobs,
  setJobsCacheRedis,
} from "../../src/services/jobs/jobs.js";
import type { JobListing, JobPage } from "../../src/services/jobs/job-types.js";

type FakeRedis = {
  store: Map<string, string>;
  sets: { key: string; ttl: number }[];
  dels: string[][];
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    mode: string,
    ttl: number,
  ) => Promise<string>;
  del: (...keys: string[]) => Promise<number>;
  scan: (
    cursor: string,
    ...args: (string | number)[]
  ) => Promise<[string, string[]]>;
};

function fakeRedis(): FakeRedis {
  const store = new Map<string, string>();
  const redis: FakeRedis = {
    store,
    sets: [],
    dels: [],
    get: async (key) => store.get(key) ?? null,
    set: async (key, value, _mode, ttl) => {
      store.set(key, value);
      redis.sets.push({ key, ttl });
      return "OK";
    },
    del: async (...keys) => {
      redis.dels.push(keys);
      let n = 0;
      for (const key of keys) if (store.delete(key)) n++;
      return n;
    },
    scan: async (cursor, ...args) => {
      const match = String(args[args.indexOf("MATCH") + 1] ?? "*");
      const prefix = match.replace(/\*.*$/, "");
      void cursor;
      return [
        "0",
        [...store.keys()].filter((key) => key.startsWith(prefix)),
      ];
    },
  };
  return redis;
}

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
  resetJobsCache();
  resetJobsTimingSink();
});

describe("job result cache", () => {
  it("serves repeat lists from the copy with the word cache in the key", async () => {
    const page: JobPage = { jobs: [listing()], hasMore: false };
    let calls = 0;
    setJobsDataSource({
      listJobs: async () => {
        calls++;
        return page;
      },
      searchJobs: async () => ({ jobs: [], hasMore: false }),
      getJobById: async () => null,
    });
    const redis = fakeRedis();
    setJobsCacheRedis(redis as never);

    const first = await listJobs(0);
    const second = await listJobs(0);

    assert.deepEqual(first, page);
    assert.deepEqual(second, page);
    assert.equal(calls, 1);
    assert.ok(redis.sets.some((s) => s.key.includes(":cache:")));
    assert.ok(redis.sets.some((s) => s.ttl === 90));
  });

  it("keeps separate copies per viewer and job id", async () => {
    const page: JobPage = { jobs: [listing()], hasMore: false };
    const job = listing();
    let listCalls = 0;
    setJobsDataSource({
      listJobs: async () => {
        listCalls++;
        return page;
      },
      searchJobs: async () => ({ jobs: [], hasMore: false }),
      getJobById: async () => job,
    });
    const redis = fakeRedis();
    setJobsCacheRedis(redis as never);

    await listJobs(0, { excludePhone: "+255700000001" });
    await listJobs(0, { excludePhone: "+255700000002" });
    await getJobById(job.id);
    await getJobById(job.id);

    assert.equal(listCalls, 2);
    const idSets = redis.sets.filter((s) => s.key.endsWith(job.id));
    assert.equal(idSets.length, 1);
    assert.equal(idSets[0]?.ttl, 90);
  });

  it("treats the same viewer phone in different shapes as one copy", async () => {
    const page: JobPage = { jobs: [listing()], hasMore: false };
    let listCalls = 0;
    setJobsDataSource({
      listJobs: async () => {
        listCalls++;
        return page;
      },
      searchJobs: async () => ({ jobs: [], hasMore: false }),
      getJobById: async () => null,
    });
    const redis = fakeRedis();
    setJobsCacheRedis(redis as never);

    await listJobs(0, { excludePhone: "+255700000001" });
    await listJobs(0, { excludePhone: "255700000001" });

    assert.equal(listCalls, 1);
  });

  it("throws away list copies when someone posts, and never caches search", async () => {
    const page: JobPage = { jobs: [listing()], hasMore: false };
    const posted = listing({ id: "new-job" });
    let listCalls = 0;
    let searchCalls = 0;
    setJobsDataSource({
      listJobs: async () => {
        listCalls++;
        return page;
      },
      searchJobs: async () => {
        searchCalls++;
        return page;
      },
      getJobById: async () => null,
      createJob: async () => posted,
    });
    const redis = fakeRedis();
    setJobsCacheRedis(redis as never);

    await listJobs(0);
    assert.equal(listCalls, 1);
    await createJob({
      title: "T",
      description: "D",
      area: "A",
      budget: 1,
      jobImage: null,
      posterPhone: null,
    });
    await listJobs(0);
    await searchJobs("mpishi", 0);
    await searchJobs("mpishi", 0);

    assert.equal(listCalls, 2);
    assert.equal(searchCalls, 2);
    assert.ok(redis.dels.length > 0);
  });
});
