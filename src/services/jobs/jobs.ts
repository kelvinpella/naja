// Deep Jobs module: one interface over Job data + rendering + media.
// Callers learn search / list / get / create + renderListView; the
// repository fallback chain, Meta carousel limits, and HEIC normalize stay
// behind this seam as implementation.
import {
  createJob as repoCreateJob,
  getJobById as repoGetJobById,
  listJobs as repoListJobs,
  searchJobs as repoSearchJobs,
} from "./job-repository.js";
import {
  buildJobListView,
  parseJobPayload,
  parseMorePayload,
  type JobListView,
  type ListOrigin,
} from "./job-carousel.js";
import {
  deletePostJobImage,
  normalizePostJobMedia,
  uploadPostJobImage,
} from "./job-image-storage.js";
import type { JobListing, JobPage } from "./job-types.js";
import {
  connectJobsTimingToLogger,
  resetJobsTimingSink,
  setJobsTimingSink,
  timeJobRead,
  type JobsTimingRecord,
  type JobsTimingSink,
} from "./job-timing.js";
import {
  JOB_DETAIL_CACHE_TTL_SECONDS,
  JOB_LIST_CACHE_TTL_SECONDS,
  jobDetailCacheKey,
  jobListCacheKey,
  purgeJobListCopies,
  readCached,
  resetJobsCache,
  setJobsCacheRedis,
  writeCached,
} from "./job-cache.js";
import type { E164Phone } from "../phone.js";

export type { JobListing, JobPage, JobListView, ListOrigin };
export { parseJobPayload, parseMorePayload };
export {
  connectJobsTimingToLogger,
  resetJobsTimingSink,
  setJobsTimingSink,
  type JobsTimingRecord,
  type JobsTimingSink,
};
export { resetJobsCache, setJobsCacheRedis };

export type CreateJobInput = {
  title: string;
  description: string;
  area: string;
  budget: number;
  jobImage: string | null;
  posterPhone: E164Phone | null;
};

export async function searchJobs(
  keyword: string,
  offset: string | number,
  opts?: { excludePhone?: string | null },
): Promise<JobPage> {
  return repoSearchJobs(keyword, offset, opts);
}

export async function listJobs(
  offset: number,
  opts?: { excludePhone?: string | null },
): Promise<JobPage> {
  return timeJobRead(
    "list",
    (page) => page.jobs.length,
    async () => {
      const key = jobListCacheKey(offset, opts?.excludePhone);
      const hit = await readCached<JobPage>(key);
      if (hit) return hit;
      const page = await repoListJobs(offset, opts);
      await writeCached(key, page, JOB_LIST_CACHE_TTL_SECONDS);
      return page;
    },
  );
}

export async function getJobById(id: string): Promise<JobListing | null> {
  return timeJobRead(
    "get-by-id",
    (job) => (job ? 1 : 0),
    async () => {
      const key = jobDetailCacheKey(id);
      const hit = await readCached<JobListing | null>(key);
      if (hit !== null) return hit;
      const job = await repoGetJobById(id);
      if (job !== null) await writeCached(key, job, JOB_DETAIL_CACHE_TTL_SECONDS);
      return job;
    },
  );
}

export async function createJob(input: CreateJobInput): Promise<JobListing> {
  const created = await repoCreateJob(input);
  await purgeJobListCopies();
  return created;
}

export function renderView(
  page: JobPage,
  origin: ListOrigin,
  offset: number,
  heading: string,
): JobListView {
  return buildJobListView(page, origin, offset, heading);
}

export { normalizePostJobMedia, uploadPostJobImage, deletePostJobImage };
