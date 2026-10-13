# Job Search Index Maintenance (spec #20, issue #23)

## What was added

- Stored generated `search_vector` (title-A / description-B / skills-C / area-C, `simple` config) + GIN index `jobs_search_vector_gin` (migration `20261013000000_job_search_fts.sql`).
- Trigram GIN `jobs_search_trgm_gin` over the lowercased concatenation of the same four fields (migration `20261013000001_job_search_trgm.sql`, needs `pg_trgm` + `immutable_array_to_string` from the first migration).
- `search_jobs()` read-only function (v2, volatile for per-query `SET LOCAL pg_trgm.similarity_threshold = 0.25`), granted to `anon, authenticated`.

Confirmed present (via `pg_indexes`, 2026-10-13): `jobs_pkey`, `jobs_search_vector_gin`, `jobs_search_trgm_gin`.

## Measured sizes

Measured 2026-10-13 on prod (14 rows): `jobs` 16 kB, `jobs_search_vector_gin` 32 kB, `jobs_search_trgm_gin` 64 kB.

Both indexes dwarf the table at this row count — expected for near-empty tables (GIN posting overhead dominates) and meaningless as a trend. Re-measure past ~10k rows; revisit only if either index approaches table size or write latency shows in `pg_stat_user_tables`/`pg_stat_user_indexes`.

Sizing query (re-run anytime):

```sql
select indexname from pg_indexes where tablename = 'jobs';
select pg_size_pretty(pg_relation_size('jobs')) as jobs,
       pg_size_pretty(pg_relation_size('jobs_search_vector_gin')) as fts_gin,
       pg_size_pretty(pg_relation_size('jobs_search_trgm_gin')) as trgm_gin,
       (select count(*) from jobs) as job_count;
```

Expectation (per Postgres docs, GIN is larger and costlier to update than GiST/B-tree; build-time mitigation is raising `maintenance_work_mem`): on a small `jobs` table both indexes should be kilobytes. Revisit only if either index approaches table size or write latency becomes measurable in `pg_stat_user_tables`/`pg_stat_user_indexes` — decide from those views, not upfront.

## Routine care

- Keep autovacuum on (default): reclaims dead rows from vector/index churn and keeps planner stats fresh. Standard `VACUUM` runs alongside reads/writes; never `VACUUM FULL` (exclusive lock). Run `ANALYZE jobs` after bulk loads/backfills so the planner sees the new lexeme distribution.
- Write cost per Job post is bounded: one `tsvector` rewrite + two GIN posting updates. If post throughput ever makes this measurable, options are (a) drop the trigram GIN and keep FTS-GIN with sequential trigram recheck, or (b) move ranking reads to a replica.

## Sources

- GIN vs GiST, `maintenance_work_mem`: https://www.postgresql.org/docs/current/textsearch-indexes.html
- Routine vacuuming / locks: https://www.postgresql.org/docs/current/routine-vacuuming.html
- Generated columns (immutable-only): https://www.postgresql.org/docs/current/ddl-generated-columns.html
- `pg_trgm` GIN/GiST classes: https://www.postgresql.org/docs/current/pgtrgm.html
