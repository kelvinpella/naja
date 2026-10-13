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
import type { E164Phone } from "../phone.js";

export type { JobListing, JobPage, JobListView, ListOrigin };
export { parseJobPayload, parseMorePayload };

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
  return repoListJobs(offset, opts);
}

export async function getJobById(id: string): Promise<JobListing | null> {
  return repoGetJobById(id);
}

export async function createJob(input: CreateJobInput): Promise<JobListing> {
  return repoCreateJob(input);
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
