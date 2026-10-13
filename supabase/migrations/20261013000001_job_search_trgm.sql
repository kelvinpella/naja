-- Typo and morphology tolerance (issue #22, spec #20, ADR-0001).
--
-- Apply in the Supabase dashboard SQL editor after the #21 migration.
-- Requires immutable_array_to_string() from 20261013000000_job_search_fts.sql.
-- App code needs no change: searchJobs() already routes through search_jobs().
--
-- 1. pg_trgm extension (trusted: plain migration works).
-- 2. Trigram GIN over the same recall surface as search_vector
--    (title + description + skills + area, lowercased).
-- 3. search_jobs() v2: FTS match OR trigram fallback, blended ranking
--    (ts_rank_cd + similarity) so exact outranks typo, recency tiebreak.

create extension if not exists pg_trgm with schema extensions;

create index if not exists jobs_search_trgm_gin on jobs using gin (
  (lower(
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(immutable_array_to_string(skills, ' '), '') || ' ' ||
    coalesce(area, '')
  )) gin_trgm_ops
);

create or replace function search_jobs(
  p_keyword text,
  p_exclude_phone text default null,
  p_offset int default 0,
  p_limit int default 10
)
returns setof jobs
language plpgsql
-- VOLATILE (not STABLE): SET LOCAL for per-query trigram tuning is only
-- allowed in volatile functions. No inlining loss matters here: all
-- filtering lives inside the function behind fixed parameters.
volatile
as $$
declare
  search_text text;
begin
  -- Per-query tolerance: below the 0.3 default so one-letter typos
  -- (mpishi/mpisi) and shared-root forms (pika/kupika) still recall.
  set local pg_trgm.similarity_threshold = 0.25;
  return query
  with q as (select websearch_to_tsquery('simple', p_keyword) as query)
  select j.*
  from jobs j, q,
    lateral (
      select lower(
        coalesce(j.title, '') || ' ' ||
        coalesce(j.description, '') || ' ' ||
        coalesce(immutable_array_to_string(j.skills, ' '), '') || ' ' ||
        coalesce(j.area, '')
      ) as t
    ) s
  where j.reviewed = true
    and (
      p_exclude_phone is null
      or p_exclude_phone = ''
      or j.created_by_phone is null
      or (
        j.created_by_phone <> '+' || p_exclude_phone
        and j.created_by_phone <> p_exclude_phone
      )
    )
    and (
      j.search_vector @@ q.query
      or s.t % lower(p_keyword)
      or lower(p_keyword) <% s.t
    )
  order by
    (ts_rank_cd(j.search_vector, q.query) + similarity(s.t, lower(p_keyword))) desc,
    j.created_at desc,
    j.id desc
  offset p_offset
  limit p_limit;
end
$$;

grant execute on function search_jobs(text, text, int, int)
  to anon, authenticated;
