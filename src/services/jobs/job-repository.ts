import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JOB_FETCH_SIZE,
  JOB_PAGE_SIZE,
  type JobListing,
  type JobPage,
} from "./job-types.js";
import { getJobsClient } from "./supabase-client.js";
import { normalizePhoneDigits } from "../phone.js";

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

// Cards render at most a 150-char excerpt, so list pages carry
// descriptions capped at 200 chars (card maximum plus headroom, so
// visible cards never change). Full text stays on the
// single-job read (getJobById maps rows without this cap).
export const LIST_DESCRIPTION_CAP = 200;

function toPage(rows: JobRow[]): JobPage {
  const hasMore = rows.length > JOB_PAGE_SIZE;
  return {
    jobs: rows.slice(0, JOB_PAGE_SIZE).map((row) => {
      const job = toListing(row);
      if (job.description && job.description.length > LIST_DESCRIPTION_CAP) {
        return { ...job, description: job.description.slice(0, LIST_DESCRIPTION_CAP) };
      }
      return job;
    }),
    hasMore,
  };
}

function normalizeExcludePhone(opts?: { excludePhone?: string | null }): string {
  return normalizePhoneDigits(opts?.excludePhone);
}

function baseQuery(
  client: SupabaseClient,
  offset: number,
  opts?: { excludePhone?: string | null },
) {
  const digits = normalizeExcludePhone(opts);
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
  // Strip PostgREST filter-structural chars (parens/quotes break .or()
  // parsing on the legacy path) plus LIKE wildcards before anything else.
  return keyword.replace(/[%\\,{}"()']/g, "").trim().slice(0, 80);
}

export async function listJobs(
  offset: number,
  opts?: { excludePhone?: string | null },
  client?: SupabaseClient,
): Promise<JobPage> {
  if (dataSourceOverride) return dataSourceOverride.listJobs(offset, opts);
  const { data, error } = await baseQuery(
    client ?? getJobsClient(),
    Math.max(0, offset),
    opts,
  );
  if (error) throw new Error("Job list query failed", { cause: error });
  return toPage((data ?? []) as JobRow[]);
}

export async function searchJobs(
  keyword: string,
  offset: string | number,
  opts?: { excludePhone?: string | null },
  client?: SupabaseClient,
): Promise<JobPage> {
  const clean = sanitizeKeyword(keyword);
  const start = Math.max(0, Number(offset) || 0);
  if (!clean) return { jobs: [], hasMore: false };
  // Test seam runs after guards so fakes observe the same cleaned input
  // and empty-keyword contract as the live paths (issue #23).
  if (dataSourceOverride) return dataSourceOverride.searchJobs(clean, start, opts);
  const supabase = client ?? getJobsClient();
  const digits = normalizeExcludePhone(opts);
  // Ranked path (issue #21): single rpc preserving the reviewed gate, phone
  // exclusion, and offset paging. Falls back to legacy text match when the
  // migration has not been applied yet (PostgREST PGRST202).
  const ranked = await supabase.rpc("search_jobs", {
    p_keyword: clean,
    p_exclude_phone: digits || null,
    p_offset: start,
    p_limit: JOB_FETCH_SIZE,
  });
  if (!ranked.error) return toPage((ranked.data ?? []) as JobRow[]);
  const pattern = `%${clean}%`;
  const textOnly = `title.ilike.${pattern},description.ilike.${pattern},area.ilike.${pattern}`;
  const withSkills = `${textOnly},skills.cs.{${clean}}`;
  const run = async (orFilter: string) =>
    baseQuery(supabase, start, opts).or(orFilter);
  const first = await run(withSkills);
  if (!first.error) return toPage((first.data ?? []) as JobRow[]);
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
  const { data, error } = await (client ?? getJobsClient())
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
