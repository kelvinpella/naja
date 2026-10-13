-- Ranked exact Swahili job search (issue #21, spec #20, ADR-0001).
--
-- Apply in the Supabase dashboard SQL editor (no CLI in this repo).
-- Typo/morphology tolerance (pg_trgm) arrives in issue #22; this
-- migration is FTS-only on purpose.
--
-- 1. Stored generated vector: title outranks description, skills and
--    area contribute recall. `simple` config: no wrong-language
--    stemming; morphology is trigram territory (#22).
-- 2. GIN index for `@@` matching.
-- 3. `search_jobs()` read-only function: reviewed gate, poster
--    exclusion mirroring the app query, blended rank ordering with
--    recency tiebreak, offset/limit paging. SECURITY INVOKER
--    (default): existing RLS policies apply unchanged.

-- `array_to_string` is STABLE, so generated columns reject it directly.
-- This thin wrapper is element-wise deterministic for our use; marking
-- it IMMUTABLE is the documented pattern for generated-column expressions.
create or replace function immutable_array_to_string(arr text[], sep text)
returns text
language sql
immutable
as $$ select array_to_string(arr, sep) $$;

alter table jobs add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(immutable_array_to_string(skills, ' '), '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(area, '')), 'C')
  ) stored;

create index if not exists jobs_search_vector_gin
  on jobs using gin (search_vector);

create or replace function search_jobs(
  p_keyword text,
  p_exclude_phone text default null,
  p_offset int default 0,
  p_limit int default 10
)
returns setof jobs
language sql
stable
as $$
  with q as (select websearch_to_tsquery('simple', p_keyword) as query)
  select j.*
  from jobs j, q
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
    and j.search_vector @@ q.query
  order by ts_rank_cd(j.search_vector, q.query) desc, j.created_at desc, j.id desc
  offset p_offset
  limit p_limit
$$;

-- PostgREST exposes functions to anon/authenticated only with EXECUTE.
-- Without this grant every search degrades to the legacy fallback.
grant execute on function search_jobs(text, text, int, int)
  to anon, authenticated;
