-- Hybrid job search (ADR 0008, ADR 0009).
--
-- Apply in the Supabase dashboard SQL editor (no CLI in this repo), after
-- 20261013000002_job_list_index.sql.
--
-- 1. pgvector, `jobs.embedding` at 1536 dimensions, and an HNSW cosine index.
--    gemini-embedding-001 emits 3072 dimensions; the app asks for 1536 and
--    L2-normalizes, because pgvector's HNSW index stops at 2000 dimensions.
-- 2. `job_listings`: the projection search may return, so `created_by_phone`,
--    `embedding` and `search_vector` never leave the database through the
--    RPC. Functions are SECURITY INVOKER, so existing RLS on `jobs` still
--    decides what a caller may see.
-- 3. `hybrid_search_jobs()`: two keyword lists (Swahili, English) ranked with
--    the ADR 0001 blend (ts_rank_cd + pg_trgm similarity, so typo and
--    morphology tolerance survive), one semantic list, fused with reciprocal
--    rank fusion.
-- 4. `list_recent_jobs()`: the newest-first listing, keeping the own-poster
--    exclusion server-side because it needs `created_by_phone`.
-- 5. `search_jobs()` is dropped: search has exactly one entry point now.

create extension if not exists vector with schema extensions;

alter table jobs add column if not exists embedding extensions.vector(1536);

create index if not exists jobs_embedding_hnsw
  on jobs using hnsw (embedding extensions.vector_cosine_ops);

create or replace view job_listings
with (security_invoker = true) as
select
  j.id,
  j.created_at,
  j.title,
  j.description,
  j.area,
  j.budget,
  j.job_image,
  j.reviewed,
  j.skills
from jobs j;

grant select on job_listings to anon, authenticated;

create or replace function hybrid_search_jobs(
  p_keywords_swahili text[],
  p_keywords_english text[],
  p_query_embedding extensions.vector(1536),
  p_exclude_phone text default null,
  p_offset int default 0,
  p_limit int default 10,
  p_rrf_k int default 50,
  p_keyword_weight float default 1,
  p_semantic_weight float default 1
)
returns setof job_listings
language plpgsql
-- VOLATILE only because SET LOCAL (trigram threshold) is not allowed in a
-- STABLE function. Ranking happens behind fixed parameters, so nothing here
-- depends on inlining.
volatile
as $$
declare
  swahili_query tsquery;
  english_query tsquery;
  swahili_text text;
  english_text text;
  candidate_limit int;
begin
  -- Same per-query tolerance as the dropped search_jobs(): one-letter typos
  -- (mpishi/mpisi) and shared-root forms (pika/kupika) still recall.
  set local pg_trgm.similarity_threshold = 0.25;

  swahili_text := lower(array_to_string(coalesce(p_keywords_swahili, '{}'), ' '));
  english_text := lower(array_to_string(coalesce(p_keywords_english, '{}'), ' '));

  -- OR the terms instead of letting websearch_to_tsquery AND them: variants
  -- like "mpishi" and "kupika" are alternatives, not requirements.
  select coalesce(
    string_agg('(' || websearch_to_tsquery('simple', term)::text || ')', ' | ')::tsquery,
    ''::tsquery
  )
  into swahili_query
  from unnest(coalesce(p_keywords_swahili, '{}')) as term
  where btrim(term) <> '';

  select coalesce(
    string_agg('(' || websearch_to_tsquery('simple', term)::text || ')', ' | ')::tsquery,
    ''::tsquery
  )
  into english_query
  from unnest(coalesce(p_keywords_english, '{}')) as term
  where btrim(term) <> '';

  -- Each list contributes a bounded pool; the fused list is then paged. The
  -- cap matches the Supabase guide (30) and keeps a pathological query cheap.
  candidate_limit := least(greatest(p_offset, 0) + greatest(p_limit, 1), 30) * 2;

  return query
  with eligible as (
    select j.*
    from jobs j
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
  ),
  swahili as (
    select
      e.id,
      row_number() over (
        order by
          (
            ts_rank_cd(e.search_vector, swahili_query)
            + similarity(s.t, swahili_text)
          ) desc,
          e.created_at desc,
          e.id desc
      ) as rank_ix
    from eligible e
    cross join lateral (
      select lower(
        coalesce(e.title, '') || ' ' ||
        coalesce(e.description, '') || ' ' ||
        coalesce(immutable_array_to_string(e.skills, ' '), '') || ' ' ||
        coalesce(e.area, '')
      ) as t
    ) s
    where swahili_text <> ''
      and (
        e.search_vector @@ swahili_query
        or s.t % swahili_text
        or swahili_text <% s.t
      )
    order by rank_ix
    limit candidate_limit
  ),
  english as (
    select
      e.id,
      row_number() over (
        order by
          (
            ts_rank_cd(e.search_vector, english_query)
            + similarity(s.t, english_text)
          ) desc,
          e.created_at desc,
          e.id desc
      ) as rank_ix
    from eligible e
    cross join lateral (
      select lower(
        coalesce(e.title, '') || ' ' ||
        coalesce(e.description, '') || ' ' ||
        coalesce(immutable_array_to_string(e.skills, ' '), '') || ' ' ||
        coalesce(e.area, '')
      ) as t
    ) s
    where english_text <> ''
      and (
        e.search_vector @@ english_query
        or s.t % english_text
        or english_text <% s.t
      )
    order by rank_ix
    limit candidate_limit
  ),
  semantic as (
    select
      e.id,
      row_number() over (
        order by e.embedding <=> p_query_embedding
      ) as rank_ix
    from eligible e
    where e.embedding is not null
    order by rank_ix
    limit candidate_limit
  )
  select l.*
  from swahili
  full outer join english on english.id = swahili.id
  full outer join semantic on semantic.id = coalesce(swahili.id, english.id)
  join job_listings l on l.id = coalesce(swahili.id, english.id, semantic.id)
  order by
    coalesce(1.0 / (p_rrf_k + swahili.rank_ix), 0.0) * p_keyword_weight
    + coalesce(1.0 / (p_rrf_k + english.rank_ix), 0.0) * p_keyword_weight
    + coalesce(1.0 / (p_rrf_k + semantic.rank_ix), 0.0) * p_semantic_weight desc,
    l.created_at desc,
    l.id desc
  offset greatest(p_offset, 0)
  limit greatest(p_limit, 1);
end
$$;

grant execute on function hybrid_search_jobs(
  text[], text[], extensions.vector, text, int, int, int, float, float
) to anon, authenticated;

create or replace function list_recent_jobs(
  p_exclude_phone text default null,
  p_offset int default 0,
  p_limit int default 10
)
returns setof job_listings
language sql
stable
as $$
  select l.*
  from jobs j
  join job_listings l on l.id = j.id
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
  order by j.created_at desc, j.id desc
  offset greatest(p_offset, 0)
  limit greatest(p_limit, 1)
$$;

grant execute on function list_recent_jobs(text, int, int)
  to anon, authenticated;

drop function if exists search_jobs(text, text, int, int);

-- Verify after applying (the plan should use jobs_list_reviewed_recency_idx):
--
--   select * from list_recent_jobs(null, 0, 10);
--   select * from hybrid_search_jobs(
--     array['mpishi'], array['cook'], (select embedding from jobs limit 1)
--   );
