import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JOB_FETCH_SIZE,
  JOB_PAGE_SIZE,
  type JobListing,
  type JobPage,
} from "./job-types.js";
import { getJobsClient, getJobsServiceClient } from "./supabase-client.js";

type JobRow = {
  id: string;
  created_at: string;
  title: string | null;
  description: string | null;
  area: string | null;
  budget: number | null;
  job_image: string | null;
  reviewed: boolean | null;
  skills: string[] | null;
  created_by_phone: string | null;
};

export type JobsDataSource = {
  listJobs: (offset: number, opts?: { excludePhone?: string | null }) => Promise<JobPage>;
  searchJobs: (
    keyword: string,
    offset: number,
    opts?: { excludePhone?: string | null },
  ) => Promise<JobPage>;
  getJobById: (id: string) => Promise<JobListing | null>;
  createJob?: (input: {
    title: string;
    description: string;
    area: string;
    budget: number;
    jobImage: string | null;
    posterPhone: string | null;
  }) => Promise<JobListing>;
};

let dataSourceOverride: JobsDataSource | null = null;

// Internal seam for tests: handler code paths call through here.
export function setJobsDataSource(source: JobsDataSource | null): void {
  dataSourceOverride = source;
}

export function resetJobsDataSource(): void {
  dataSourceOverride = null;
}

// Scoped override that always resets (prevents test doubles leaking into prod).
export async function runWithJobsDataSource<T>(
  source: JobsDataSource | null,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = dataSourceOverride;
  dataSourceOverride = source;
  try {
    return await fn();
  } finally {
    dataSourceOverride = previous;
  }
}

function toListing(row: JobRow): JobListing {
  return {
    id: row.id,
    createdAt: row.created_at,
    title: row.title,
    description: row.description,
    area: row.area ?? null,
    budget: row.budget,
    jobImage: row.job_image ?? null,
    reviewed: row.reviewed ?? null,
    skills: row.skills ?? [],
    posterPhone: row.created_by_phone,
  };
}

function toPage(rows: JobRow[]): JobPage {
  if (JOB_FETCH_SIZE !== JOB_PAGE_SIZE + 1) {
    throw new Error("JOB_FETCH_SIZE must equal JOB_PAGE_SIZE + 1 for hasMore detection");
  }
  const hasMore = rows.length > JOB_PAGE_SIZE;
  return { jobs: rows.slice(0, JOB_PAGE_SIZE).map(toListing), hasMore };
}

function normalizeOffset(offset: number): number {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function baseQuery(
  client: SupabaseClient,
  offset: number,
  opts?: { excludePhone?: string | null },
) {
  const digits = (opts?.excludePhone ?? "").replace(/\D/g, "");
  let query = client
    .from("jobs")
    .select(
      "id,created_at,title,description,area,budget,job_image,reviewed,skills,created_by_phone",
    )
    // Admin review gate (issue #6): only approved jobs are broadcast.
    .eq("reviewed", true);
  if (digits) {
    // Listings never show the viewer's own posts: only what others posted.
    // Both stored shapes are excluded (+E.164 for new rows, digits-only for
    // legacy rows) inside one AND: a flat OR would always pass since the own
    // row differs from at least one shape. The is.null branch keeps
    // NULL-poster rows visible since plain neq drops NULLs.
    query = query.or(
      `created_by_phone.is.null,and(created_by_phone.neq.+${digits},created_by_phone.neq.${digits})`,
    );
  }
  return query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + JOB_FETCH_SIZE - 1);
}

function sanitizeKeyword(keyword: string): string {
  // Strip PostgREST OR-filter reserved chars (%,(),:,;,{},",\,*,etc.) so the
  // keyword can't break the or() filter syntax.
  return keyword.replace(/[%\\,{}\".()|:;*!<>~]/g, "").trim().slice(0, 80);
}

export async function listJobs(
  offset: number,
  opts?: { excludePhone?: string | null },
  client?: SupabaseClient,
): Promise<JobPage> {
  if (dataSourceOverride) return dataSourceOverride.listJobs(normalizeOffset(offset), opts);
  const { data, error } = await baseQuery(
    client ?? getJobsClient(),
    normalizeOffset(offset),
    opts,
  );
  if (error) throw new Error("Job list query failed", { cause: error });
  return toPage((data ?? []) as JobRow[]);
}

export async function searchJobs(
  keyword: string,
  offset: number,
  opts?: { excludePhone?: string | null },
  client?: SupabaseClient,
): Promise<JobPage> {
  const clean = sanitizeKeyword(keyword);
  const start = normalizeOffset(offset);
  if (dataSourceOverride) return dataSourceOverride.searchJobs(clean, start, opts);
  if (!clean) return { jobs: [], hasMore: false };
  const pattern = `%${clean}%`;
  const textOnly = `title.ilike.${pattern},description.ilike.${pattern}`;
  const withSkills = `${textOnly},skills.cs.{${clean}}`;
  const run = async (orFilter: string) =>
    baseQuery(client ?? getJobsClient(), start, opts).or(orFilter);
  const first = await run(withSkills);
  if (!first.error) return toPage((first.data ?? []) as JobRow[]);
  console.warn("[jobs] skills-array search rejected, falling back to text search:", first.error.message ?? first.error);
  // Array-operator inside OR can be rejected on some PostgREST versions;
  // fall back to text fields only rather than failing the menu.
  const retry = await run(textOnly);
  if (retry.error) {
    throw new Error("Job search query failed", { cause: retry.error });
  }
  return toPage((retry.data ?? []) as JobRow[]);
}

export async function getJobById(
  id: string,
  client?: SupabaseClient,
): Promise<JobListing | null> {
  if (dataSourceOverride) return dataSourceOverride.getJobById(id);
  if (!id || typeof id !== "string" || id.length > 64) {
    throw new Error("getJobById requires a valid id");
  }
  const { data, error } = await (client ?? getJobsClient())
    .from("jobs")
    .select(
      "id,created_at,title,description,area,budget,job_image,reviewed,skills,created_by_phone",
    )
    .eq("id", id)
    .eq("reviewed", true)
    .maybeSingle();
  if (error) throw new Error("Job lookup failed", { cause: error });
  return data ? toListing(data as JobRow) : null;
}

export async function createJob(
  input: {
    title: string;
    description: string;
    area: string;
    budget: number;
    jobImage: string | null;
    posterPhone: string | null;
  },
  client?: SupabaseClient,
): Promise<JobListing> {
  if (dataSourceOverride?.createJob)
    return dataSourceOverride.createJob(input);
  if (!input.title?.trim() || !input.description?.trim() || !input.area?.trim()) {
    throw new Error("createJob requires non-empty title, description, and area");
  }
  if (!Number.isFinite(input.budget) || input.budget < 0) {
    throw new Error("createJob requires budget >= 0");
  }
  // Server-side write: service-role bypasses RLS (anon reads stay policy-gated).
  const { data, error } = await (client ?? getJobsServiceClient())
    .from("jobs")
    .insert({
      title: input.title,
      description: input.description,
      area: input.area,
      budget: input.budget,
      job_image: input.jobImage,
      created_by_phone: input.posterPhone,
    })
    .select(
      "id,created_at,title,description,area,budget,job_image,reviewed,skills,created_by_phone",
    )
    .single();
  if (error || !data) throw new Error("Job insert failed", { cause: error });
  return toListing(data as JobRow);
}
