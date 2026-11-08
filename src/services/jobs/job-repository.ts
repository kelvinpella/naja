import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "./embeddings.js";
import {
  JOB_FETCH_SIZE,
  JOB_PAGE_SIZE,
  type JobListing,
  type JobPage,
} from "./job-types.js";
import { getJobsClient } from "./supabase-client.js";

export type NewJob = {
  title: string;
  description: string;
  area: string;
  budget: number;
  jobImage: string | null;
  posterPhone: string | null;
  // Null when the embedding provider failed: the Job is published anyway and
  // `npm run jobs:embed` fills the vector in later (ADR 0008).
  embedding: number[] | null;
};

export type CreatedJob = {
  id: string;
  title: string | null;
};

/** What `job_listings` returns; the phone and vector columns never reach here. */
type JobRow = {
  id: string;
  created_at: string;
  title: string | null;
  description: string | null;
  area: string | null;
  budget: number | null;
  job_image: string | null;
};

const LISTING_COLUMNS =
  "id,created_at,title,description,area,budget,job_image";

export type SearchJobsInput = {
  // The Person's own words. Only the embedding uses them; keywords are what
  // the keyword lists rank.
  query: string;
  keywords: { swahili: string[]; english: string[] };
  offset?: number;
  excludePhone?: string | null;
};

export type HybridSearchOutcome =
  | { kind: "ok"; jobs: JobListing[]; hasMore: boolean }
  // The query embedding could not be produced, so no search ran. The caller
  // tells the Person search is unavailable (ADR 0009).
  | { kind: "unavailable" };

export type SearchDeps = {
  client?: SupabaseClient;
  embed?: (text: string) => Promise<number[] | null>;
};

const KEYWORD_LIMIT = 5;
const KEYWORD_LENGTH_LIMIT = 40;

function toListing(row: JobRow): JobListing {
  return {
    id: row.id,
    createdAt: row.created_at,
    title: row.title,
    description: row.description,
    area: row.area,
    budget: row.budget,
    jobImage: row.job_image ?? null,
  };
}

function toPage(rows: JobRow[]): JobPage {
  return {
    jobs: rows.slice(0, JOB_PAGE_SIZE).map(toListing),
    hasMore: rows.length > JOB_PAGE_SIZE,
  };
}

function normalizeExcludePhone(opts?: { excludePhone?: string | null }): string {
  return (opts?.excludePhone ?? "").replace(/\D/g, "");
}

/** Dedupes case-insensitively and bounds what one query may contribute. */
export function cleanKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const keyword of keywords) {
    const text = keyword.trim().replace(/\s+/g, " ").slice(0, KEYWORD_LENGTH_LIMIT);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
    if (cleaned.length === KEYWORD_LIMIT) break;
  }
  return cleaned;
}

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const [vector] = await embedTexts([text]);
    return vector ?? null;
  } catch {
    return null;
  }
}

/**
 * Publishes a Job: one insert, visible to others immediately. `reviewed` is
 * that visibility gate — the search functions filter on it — so publishing is
 * what sets it, and no longer a person in Supabase (ADR 0007). The column name
 * is the debt that decision carries.
 */
export async function publishJob(
  input: NewJob,
  client?: SupabaseClient,
): Promise<CreatedJob> {
  const { data, error } = await (client ?? getJobsClient())
    .from("jobs")
    .insert({
      title: input.title,
      description: input.description,
      area: input.area,
      budget: input.budget,
      job_image: input.jobImage,
      created_by_phone: input.posterPhone,
      reviewed: true,
      embedding: input.embedding,
    })
    .select("id,title")
    .single();
  if (error || !data) throw new Error("Job insert failed", { cause: error });
  return data as CreatedJob;
}

/**
 * One search entry point (ADR 0009): two keyword lists plus the query
 * embedding, fused by `hybrid_search_jobs()` with RRF. Without a vector no
 * search runs — embedding is required, not optional.
 */
export async function searchJobsHybrid(
  input: SearchJobsInput,
  deps: SearchDeps = {},
): Promise<HybridSearchOutcome> {
  const query = input.query.trim();
  const swahili = cleanKeywords(input.keywords.swahili);
  const english = cleanKeywords(input.keywords.english);
  if (!query || swahili.length + english.length === 0) {
    return { kind: "ok", jobs: [], hasMore: false };
  }

  const embed = deps.embed ?? embedQuery;
  const vector = await embed(query);
  if (!vector) return { kind: "unavailable" };

  const digits = normalizeExcludePhone(input);
  const start = Math.max(0, input.offset ?? 0);
  const { data, error } = await (deps.client ?? getJobsClient()).rpc(
    "hybrid_search_jobs",
    {
      p_keywords_swahili: swahili,
      p_keywords_english: english,
      p_query_embedding: vector,
      p_exclude_phone: digits || null,
      p_offset: start,
      p_limit: JOB_FETCH_SIZE,
    },
  );
  if (error) throw new Error("Hybrid job search failed", { cause: error });

  const page = toPage((data ?? []) as JobRow[]);
  return { kind: "ok", jobs: page.jobs, hasMore: page.hasMore };
}

/** One published Job, for the detail reply a carousel card opens. */
export async function getJobById(
  id: string,
  client?: SupabaseClient,
): Promise<JobListing | null> {
  const { data, error } = await (client ?? getJobsClient())
    .from("job_listings")
    .select(LISTING_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Job lookup failed", { cause: error });
  return data ? toListing(data as JobRow) : null;
}

/**
 * The Jobs a reply asked to render, in the order it asked for them. Rows the
 * model invented simply do not resolve.
 */
export async function getJobsByIds(
  ids: string[],
  client?: SupabaseClient,
): Promise<JobListing[]> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return [];

  const { data, error } = await (client ?? getJobsClient())
    .from("job_listings")
    .select(LISTING_COLUMNS)
    .in("id", wanted);
  if (error) throw new Error("Job lookup failed", { cause: error });

  const byId = new Map(
    ((data ?? []) as JobRow[]).map((row) => [row.id, toListing(row)]),
  );
  return wanted
    .map((id) => byId.get(id))
    .filter((job): job is JobListing => job !== undefined);
}

/**
 * The poster's contact for a tapped `Omba`. `job_listings` deliberately leaves
 * the phone out, so this reads `jobs` directly. A Job that is not published
 * resolves to null, the same as one that does not exist.
 */
export async function getJobPosterContact(
  id: string,
  client?: SupabaseClient,
): Promise<{ title: string | null; posterPhone: string | null } | null> {
  const { data, error } = await (client ?? getJobsClient())
    .from("jobs")
    .select("title,created_by_phone")
    .eq("id", id)
    .eq("reviewed", true)
    .maybeSingle();
  if (error) throw new Error("Job poster lookup failed", { cause: error });
  if (!data) return null;
  const row = data as { title: string | null; created_by_phone: string | null };
  return { title: row.title, posterPhone: row.created_by_phone ?? null };
}

/** The newest published Jobs, excluding the viewer's own (Recent jobs). */
export async function listRecentJobs(
  offset = 0,
  opts?: { excludePhone?: string | null },
  client?: SupabaseClient,
): Promise<JobPage> {
  const digits = normalizeExcludePhone(opts);
  const { data, error } = await (client ?? getJobsClient()).rpc(
    "list_recent_jobs",
    {
      p_exclude_phone: digits || null,
      p_offset: Math.max(0, offset),
      p_limit: JOB_FETCH_SIZE,
    },
  );
  if (error) throw new Error("Job list query failed", { cause: error });
  return toPage((data ?? []) as JobRow[]);
}
