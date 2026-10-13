-- Newest-first approved listing index (issue #34, spec #32).
--
-- Apply in the Supabase dashboard SQL editor (no CLI in this repo).
--
-- The menu list path filters `reviewed = true` and orders by
-- `created_at DESC, id DESC`. Before this index the only indexes on
-- `jobs` were the full-text and trigram GIN indexes, so every page
-- sorted without index support (~300ms warm, ~1.2s cold in baseline).
--
-- Partial btree index: only approved rows are indexed, keeping it
-- small since unreviewed rows never appear in listings.

create index if not exists jobs_list_reviewed_recency_idx
  on jobs (created_at desc, id desc)
  where reviewed = true;

-- Verify in the same editor before closing the ticket:
--
--   explain (analyze, buffers)
--   select id, created_at, title, description, area, budget,
--          job_image, reviewed, skills, created_by_phone
--   from jobs
--   where reviewed = true
--   order by created_at desc, id desc
--   limit 10;
--
-- Proof is an Index Scan (or Bitmap Heap Scan) on
-- jobs_list_reviewed_recency_idx instead of a Sort over a filter.
