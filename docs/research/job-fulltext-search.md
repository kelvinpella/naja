# Job Keyword Search: Full-Text Search Options Research

- **Date:** 2026-10-12
- **Issue:** kelvinpella/naja#3 — "Use proper full-text search for job keyword matching"
- **Context:** `src/services/jobs/job-repository.ts` `searchJobs()` (lines 116-140) matches with `title ILIKE %kw% OR description ILIKE %kw%` plus best-effort `skills.cs.{kw}` inside a PostgREST `.or()` filter, ordered newest-first via `baseQuery()` (`.order created_at desc, id desc` + `.range()`). Backend is Supabase Postgres via `@supabase/supabase-js`. Any replacement must keep the `{ jobs, hasMore }` (`JobPage`) shape.
- **Method:** Primary sources only — official PostgreSQL docs, Supabase docs/guides, PostgREST docs, Typesense/Meilisearch official docs. Every factual claim carries a per-claim citation URL. No implementation in this doc.

## 1. Postgres FTS: tsvector / tsquery / ranking / indexes

### 1.1 Core mechanism

- Full-text search preprocesses documents into `tsvector` (sorted array of normalized lexemes + positions) and queries into `tsquery`, matched with the `@@` operator; either argument order works. (https://www.postgresql.org/docs/current/textsearch-intro.html)
- `to_tsvector()` parses, lowercases, stems, and drops stop words (e.g. `to_tsvector('english', 'The Fat Rats')` → `'fat':2 'rat':3`); `to_tsquery` / `plainto_tsquery` / `phraseto_tsquery` / `websearch_to_tsquery` normalize query text the same way, which is what makes `rats` match `rat`. Without normalization (`'rats'::tsvector @@ to_tsquery('rat')`) there is no match. (https://www.postgresql.org/docs/current/textsearch-intro.html) (https://www.postgresql.org/docs/current/functions-textsearch.html)
- Shorthands exist: `text @@ tsquery` is equivalent to `to_tsvector(x) @@ y`, and `text @@ text` is equivalent to `to_tsvector(x) @@ plainto_tsquery(y)`. (https://www.postgresql.org/docs/current/textsearch-intro.html)
- `tsquery` operators: `&` (AND), `|` (OR), `!` (NOT), `<->` / `<N>` (FOLLOWED BY / phrase with distance). (https://www.postgresql.org/docs/current/functions-textsearch.html)

### 1.2 Query parsers: which one for raw user input

- `to_tsquery` requires the caller to supply valid `tsquery` operators (`&`, `|`, `!`) and raises syntax errors on raw input; `plainto_tsquery` inserts `&` between all surviving words (AND semantics); `phraseto_tsquery` inserts `<->` (phrase semantics) and accounts for stop words with `<N>` distance operators instead of dropping them. (https://www.postgresql.org/docs/current/textsearch-controls.html)
- `websearch_to_tsquery` accepts raw user text and **never raises syntax errors**: unquoted text becomes `&`-joined terms, `"quoted text"` becomes `<->` phrases, `or` becomes `|`, `-` becomes `!`; all other punctuation is ignored. (https://www.postgresql.org/docs/current/textsearch-controls.html)
- Implication for Naja: WhatsApp keyword input is raw free text (may contain quotes, dashes, stray punctuation). `websearch_to_tsquery('simple', keyword)` is the correct query parser — it cannot throw on hostile input, unlike `to_tsquery`. (https://www.postgresql.org/docs/current/textsearch-controls.html)

### 1.3 `simple` vs `english` for Swahili text

- The `english` configuration applies an English Snowball stemmer plus English stop words (example in docs: `rats` → `rat`, `a/on/it` dropped). (https://www.postgresql.org/docs/current/textsearch-controls.html)
- The `simple` template only lowercases (and optionally drops stop words from a file); the Snowball template is per-language stemming (`Language = english`, etc.), and each dictionary is language-specific. (https://www.postgresql.org/docs/current/textsearch-dictionaries.html)
- There is **no Swahili text search configuration** in stock PostgreSQL (predefined configurations cover languages with Snowball stemmers; Swahili has none).
- Consequence: `english` stemming applies English suffix rules to Swahili words and English stop words (`the`, `a`, …) are meaningless for Swahili while real Swahili high-frequency words (`wa`, `ya`, `na`, `kwa`) would still be indexed. `english` can both mangle Swahili surface forms and fail to normalize what actually matters in Swahili — Bantu **prefix** morphology (`pika` / `kupika` "to cook" / `upishi` "cooking" / `mpishi` "cook"), which a suffix-stripping English stemmer does not model. (https://www.postgresql.org/docs/current/textsearch-dictionaries.html) (https://www.postgresql.org/docs/current/textsearch-controls.html)
- Recommendation: use the **`simple`** configuration (no stemming, no English stop words) so Swahili surface forms are indexed verbatim, and get morphological tolerance from `pg_trgm` (§2) instead of from a wrong-language stemmer.
- Prefix matching (`to_tsquery('pik:*')`, where `:*` marks prefix match) only matches words **beginning** with the given string. (https://www.postgresql.org/docs/current/textsearch-controls.html) It therefore does **not** solve Bantu prefix morphology (`pik:*` matches `pika` but not `kupika`/`mpishi`/`upishi`). Do not rely on `:*` for Swahili verb-noun families; that is trigram/synonym territory.

### 1.4 Custom text search config / stop words on Supabase: what is feasible

- A configuration is built from parser + dictionaries; creating configurations and dictionaries is plain SQL (`CREATE TEXT SEARCH CONFIGURATION … (COPY = …)`, `CREATE TEXT SEARCH DICTIONARY`, `ALTER TEXT SEARCH CONFIGURATION … ALTER MAPPING FOR … WITH …`). Only new **parsers/templates** need C code and superuser; wiring existing dictionaries into a config does not. (https://www.postgresql.org/docs/current/textsearch-configuration.html) (https://www.postgresql.org/docs/current/textsearch-intro.html)
- Limitation: `simple` stop words, `synonym` (`*.syn`), `thesaurus` (`*.ths`), ispell/hunspell files all live under `$SHAREDIR/tsearch_data/` on the **database server filesystem**. (https://www.postgresql.org/docs/current/textsearch-dictionaries.html) On hosted Supabase there is no way to upload such files, so custom stop-word lists, synonym files, and thesaurus files are **not feasible**; a config composed only of built-in dictionaries (e.g. `simple`, `english_stem`, `unaccent`) **is** feasible via SQL migration.
- Practical consequence: a Swahili stop-word list (`wa/ya/na/kwa/…`) cannot be installed as a dictionary file on hosted Supabase. Stop-word-largely-irrelevant ranking is acceptable at Naja's scale; if noise becomes measurable, filter ultra-frequent tokens at query time or in the `rpc()` function instead.

### 1.5 Ranking: `ts_rank` / `ts_rank_cd`

- `ts_rank` scores on lexeme frequency; `ts_rank_cd` uses cover-density (proximity of matching lexemes matters) and needs positional info (ignores stripped lexemes). (https://www.postgresql.org/docs/current/textsearch-controls.html)
- Optional `weights` array `{D-weight, C-weight, B-weight, A-weight}`, default `{0.1, 0.2, 0.4, 1.0}`; `setweight()` labels lexemes (typical use: title → `A`, description → `B`), and `tsvector`s concatenate with `||`. The docs' recommended pattern for structured documents is exactly `setweight(to_tsvector(coalesce(title,'')),'A') || setweight(to_tsvector(coalesce(description,'')),'B')`, with `coalesce` because `to_tsvector(NULL)` returns `NULL`. (https://www.postgresql.org/docs/current/textsearch-controls.html)
- Normalization bitmask: `0` (default) ignores length; `1` ÷ (1+log length); `2` ÷ length; `8`/`16` by unique-word counts; `32` maps rank into 0–1 (`rank/(rank+1)`, cosmetic only, does not change ordering). (https://www.postgresql.org/docs/current/textsearch-controls.html)
- Cost warning from the docs: "Ranking can be expensive since it requires consulting the `tsvector` of each matching document, which can be I/O bound and therefore slow." At Naja's scale (WhatsApp menu pages of ~10 rows, shallow offsets) this is fine; it rules out nothing. (https://www.postgresql.org/docs/current/textsearch-controls.html)
- Combined rank + recency: `ORDER BY ts_rank(...) DESC, created_at DESC, id DESC`. Pure keyset pagination only works on a stable column ordering (`created_at, id`); rank is query-dependent, so keyset on rank is not practical. Keep the existing offset pattern (`.range()` / `OFFSET/LIMIT`) — offset cost grows with depth, but menu browsing is shallow. For deep offsets, cap or fall back to recency-only ordering. (Offset-cost growth is standard planner behavior; rank-per-query follows from `ts_rank(vector, query)` taking the query as an argument — https://www.postgresql.org/docs/current/textsearch-controls.html)

### 1.6 Indexes: GIN, and generated column vs expression index

- **GIN is the preferred text search index type** (inverted index, one entry per lexeme; multi-word queries use the index to eliminate rows missing extra words). GiST is lossy (fixed-length signature, default 124 bytes, max 2024; false matches rechecked against the heap) — useful for very large update-heavy collections, not the default choice. GIN stores lexemes only, not weight labels, so weight-filtered queries recheck the row. GIN build time can be improved by raising `maintenance_work_mem`. (https://www.postgresql.org/docs/current/textsearch-indexes.html)
- Recommended storage pattern (also the Supabase guide's pattern): a **stored generated column** `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))) STORED` plus `CREATE INDEX … USING GIN (search_vector)`. Generation expressions may only use **immutable** functions — `to_tsvector` with a literal config qualifies. Stored generated columns are recomputed on write automatically, like a materialized view that is always fresh. (https://www.postgresql.org/docs/current/ddl-generated-columns.html) (https://supabase.com/docs/guides/database/full-text-search)
- Alternative: expression index `CREATE INDEX … USING GIN (to_tsvector('simple', …))` with no extra column. Equivalent index behavior, but every query must repeat the exact expression, and the column is not directly addressable from PostgREST/`.textSearch()`. Generated column is cleaner for §3. (https://www.postgresql.org/docs/current/textsearch-indexes.html) (https://supabase.com/docs/guides/database/full-text-search)
- `unaccent`: a filtering dictionary/template that strips diacritics (`Hôtel` → `Hotel`), insertable anywhere before the end of a config's dictionary list. (https://www.postgresql.org/docs/current/unaccent.html) Swahili is written in plain Latin with no diacritics, so `unaccent` is **not needed** for Swahili text; consider it only if French/Portuguese loanwords with accents show up in listings. The extension is available on Supabase (see §2.4).

## 2. `pg_trgm`: fuzzy matching for typos and morphology

### 2.1 Functions and operators

- `similarity(text, text) → real` in 0 (dissimilar) to 1 (identical), based on shared-trigram count; non-word characters are ignored and each word is padded (two spaces prefix, one suffix) before trigram extraction. (https://www.postgresql.org/docs/current/pgtrgm.html)
- `%` returns true when similarity exceeds `pg_trgm.similarity_threshold` (default **0.3**); `<%` / `%>` use `word_similarity` against the best-matching continuous extent (default threshold **0.6**); `<<%` / `%>>` use strict word-boundary similarity (default **0.5**). `word_similarity` suits matching a term against **part of a longer field** (e.g. query `mpishi` vs a long description); `strict_word_similarity` suits whole-word matching. (https://www.postgresql.org/docs/current/pgtrgm.html)
- Distance operators `<->` (1 − similarity), `<<->` / `<->>` (word distance), `<<<->` / `<->>>` (strict) power `ORDER BY dist LIMIT n` nearest-neighbor queries. (https://www.postgresql.org/docs/current/pgtrgm.html)

### 2.2 GIN vs GiST for trigrams

- Both `gist_trgm_ops` (optional `siglen`, default 12 bytes) and `gin_trgm_ops` index classes accelerate `%`, `<%`, `%>` and trigram-extractable `LIKE`/`ILIKE`/`~` queries. Key asymmetry: **`ORDER BY distance LIMIT k` nearest-neighbor is efficient on GiST but not on GIN**. Inequality operators are not supported by either. (https://www.postgresql.org/docs/current/pgtrgm.html)
- `LIKE`/`ILIKE` index use extracts trigrams from the pattern; a pattern with no extractable trigrams degenerates to a full(-index) scan — relevant because the current `%kw%` search on very short keywords (1–2 chars) cannot use a trigram index effectively. (https://www.postgresql.org/docs/current/pgtrgm.html)
- For Naja: one **GIN** trigram index covers `%`/`ILIKE` filtering (the planned use); add GiST only if top-K nearest-neighbor ordering (`ORDER BY col <-> query LIMIT`) becomes the access pattern. GIN and FTS-GIN can coexist as two indexes.

### 2.3 Typo tolerance and multi-word queries

- Typo tolerance (`mpishi` vs `mpisi`, `dereva` vs `dreva`) falls out of trigram overlap: one substitution/deletion only destroys the few trigrams spanning the error, so similarity stays high. Tune `pg_trgm.similarity_threshold` per query with `SET LOCAL` inside the search function rather than changing the database default. (https://www.postgresql.org/docs/current/pgtrgm.html)
- Multi-word queries (`dereva binafsi`): FTS `websearch_to_tsquery` handles AND semantics across words; trigram `similarity()` on the whole string is length-sensitive and poor for multi-word input — use `word_similarity(query, field)` / `'query' <% field` (query on the **left**) so each query word can match its best extent, or score per-word and combine. Typical query shape: `'dereva binafsi' <% (title || ' ' || description)`. (https://www.postgresql.org/docs/current/pgtrgm.html)
- Bantu morphology (`pika/kupika/mpishi/upishi`): trigrams catch the shared `pik`/`pis`/`shi` cores where stemming cannot (see §1.3). Trigram is the mechanism that makes `pika` match `kupika` — shared trigrams `pik/ika` survive the prefix.
- Combining FTS + trigram: match with FTS `@@` for precision/recall on exact lexemes, OR with a trigram predicate (`%` / `<%`) for typo/morphology recall, and order by `ts_rank_cd(...) + similarity(...)` blend. The `pg_trgm` docs bless exactly this layering for misspelled input that FTS alone cannot match, including the auxiliary-words-table spell-suggestion pattern (`ts_stat` over `to_tsvector('simple', …)` → `words` table → GIN trigram index on `word`), with the caveat that the static table must be **periodically regenerated**. (https://www.postgresql.org/docs/current/pgtrgm.html) Start with the OR/blend in the search function; build the suggestion table only if "no results" analytics justify it.

### 2.4 Availability on Supabase and enabling via migration

- `pg_trgm` ("Text similarity measurement and index searching based on trigrams") and `unaccent` ("Text search dictionary that removes accents") are both on Supabase's pre-installed extension list. (https://supabase.com/docs/guides/database/extensions)
- Enable/disable from Dashboard → Database → Extensions, or SQL: `create extension pg_trgm with schema extensions;` / `drop extension pg_trgm;`. Most extensions install under the `extensions` schema, accessible to `public` by default. (https://supabase.com/docs/guides/database/extensions)
- `pg_trgm` (and `unaccent`) are **"trusted"**: installable by non-superusers holding `CREATE` on the database — no superuser escalation needed, so a plain SQL migration works. (https://www.postgresql.org/docs/current/pgtrgm.html) (https://www.postgresql.org/docs/current/unaccent.html)
- Migration shape: `create extension if not exists pg_trgm with schema extensions;` then `alter table … add column …`, `create index …`, and the search `function …` — all ordinary DDL in one migration. (Extension DDL per https://supabase.com/docs/guides/database/extensions; function exposure per https://docs.postgrest.org/en/v12/references/api/functions.html)

## 3. Supabase / PostgREST queryability: what fits in `.textSearch()` / `.or()`, what needs `rpc()`

### 3.1 Operator mapping (verified)

- PostgREST exposes four FTS filters on `tsvector` (or text) columns: `fts` (= `@@` with `to_tsquery`), `plfts` (`plainto_tsquery`), `phfts` (`phraseto_tsquery`), `wfts` (`websearch_to_tsquery`, needs PG ≥ 11). Optional language prefix: `?col=wfts(simple).keyword`. (https://docs.postgrest.org/en/v12/references/api/tables_views.html)
- `supabase-js` `.textSearch(column, query, { config, type })` targets one text/tsvector column; `type: 'plain' | 'phrase' | 'websearch'` selects the tsquery parser (default = `to_tsquery`/`fts`). (https://supabase.com/docs/guides/database/full-text-search) (https://docs-supabase.vercel.app/docs/reference/javascript/v2/using-filters-textsearch)
- Multi-column FTS has **no direct client-side support**: the Supabase guide's workaround is a server-side computed (immutable SQL) function concatenating columns, then `.textSearch()` on it — or, for Naja, the stored generated `search_vector` column from §1.6, which is cleaner and writable-path-free. (https://supabase.com/docs/guides/database/full-text-search)

### 3.2 What fits in REST, what needs `rpc()`

| Need | REST-capable? | How |
|---|---|---|
| FTS match on one column | Yes | `.textSearch('search_vector', keyword, { type: 'websearch', config: 'simple' })` |
| FTS OR ILIKE OR array-contains in one request | Yes | `.or('search_vector.wfts(simple).kw,title.ilike.%kw%,skills.cs.{kw}')` — `or` composes any listed operators (https://docs.postgrest.org/en/v12/references/api/tables_views.html) |
| `reviewed=true` gate + excludePhone OR + `order` + `range` | Yes | Unchanged `baseQuery()` chaining; `order()` sorts by columns only (https://docs.postgrest.org/en/v12/references/api/tables_views.html) |
| **`ts_rank` relevance ordering** | **No — needs `rpc()`** | `order=` accepts columns/directions only; no expression ordering. Ranked search is the Supabase guide's canonical `rpc()` case (`search_books` returning `rank`, `order by rank desc`). (https://supabase.com/docs/guides/database/full-text-search) |
| **pg_trgm `%` / `<%` / `similarity()` predicates or distance ordering** | **No — needs `rpc()`** | `%`, `<%`, `<->` are not in PostgREST's operator table (`eq…like/ilike/match/fts/plfts/phfts/wfts/cs/…`), so neither `.filter()` nor `.or()` can express them; any query touching similarity must live in a DB function. (https://docs.postgrest.org/en/v12/references/api/tables_views.html) |

- Verdict: keep the simple path (generated `search_vector` + `.textSearch()`/`.or()`, newest-first) only as an interim step. The target shape — FTS `@@` OR trigram match, ordered by blended rank then recency, with the `reviewed` gate, phone exclusion, and offset pagination — belongs in **one `rpc()` function** (read-only functions are also callable via GET; table-valued functions support the same filters/limits, and inlinable SQL functions push `OFFSET/LIMIT` into the plan). (https://docs.postgrest.org/en/v12/references/api/functions.html) (https://supabase.com/docs/guides/database/full-text-search)
- Cleanest pattern preserving current semantics: `search_jobs(p_keyword text, p_exclude_phone text, p_offset int, p_limit int) RETURNS TABLE (like jobs cols + rank real)` implementing: `reviewed = true` AND phone-exclusion (same `is null / neq` logic as `baseQuery`) AND (`search_vector @@ websearch_to_tsquery('simple', kw)` OR trigram predicate) ordered by `(rank DESC, created_at DESC, id DESC)` with `OFFSET/LIMIT (p_limit+1)`; `supabase.rpc('search_jobs', …)` then maps to `{ jobs, hasMore }` exactly like `toPage()` slices `JOB_PAGE_SIZE` + overflow today. Keyword sanitization stays client-side (`sanitizeKeyword`) and the function uses parameter binding, so no query-string escaping fragility. (Current code: `src/services/jobs/job-repository.ts:68-140`; PostgREST function semantics: https://docs.postgrest.org/en/v12/references/api/functions.html)

## 4. External index (Typesense / Meilisearch) as fallback: verdict

Typesense is an open-source typo-tolerant engine (sub-50ms instant search positioning) whose own Supabase guide syncs Postgres → Typesense via `pg_net`/`http` extensions plus `pg_cron`-scheduled bulk syncs, per-row async triggers, or edge functions — including failure-retry bookkeeping, delete syncing, and tunnel/self-host deployment steps (https://typesense.org/docs/guide/supabase-full-text-search.html) (https://typesense.org/docs/llms.txt); Meilisearch is a single-binary REST engine promising <50ms typo-tolerant search with seven default ranking rules and no cluster/schema to configure (https://www.meilisearch.com/docs/learn/what_is_meilisearch). **Verdict: do not adopt unless measured FTS+trigram inadequacy forces it** — specifically, only if regression queries (§5) show an unacceptable zero-result/miss rate on typo and morphology variants after threshold tuning, or product requirements demand search-as-you-type prefix UX the chat menu cannot use anyway; the price is a second system (sync lag, dual-write/delete consistency, retry cron, extra infra cost and ops surface) that a WhatsApp menu paging ≤10 rows from a modest `jobs` table does not need while in-database search answers every requirement.

## 5. Recommendation

### 5.1 Concrete migration + query shape

1. **Migration SQL** (one migration, all citable DDL above):
   - `create extension if not exists pg_trgm with schema extensions;` (trusted; dashboard alternative exists). (https://supabase.com/docs/guides/database/extensions) (https://www.postgresql.org/docs/current/pgtrgm.html)
   - `alter table jobs add column search_vector tsvector generated always as (setweight(to_tsvector('simple', coalesce(title,'')), 'A') || setweight(to_tsvector('simple', coalesce(description,'')), 'B') || setweight(to_tsvector('simple', coalesce(array_to_string(skills,' '),'')), 'C')) stored;` — title outranks description outranks skills via default `{0.1,0.2,0.4,1.0}` weights; `array_to_tsvector` exists but takes lexemes as-is without lowercasing, so `to_tsvector` over the joined string is the safer choice for mixed-case skill tags. (https://www.postgresql.org/docs/current/ddl-generated-columns.html) (https://www.postgresql.org/docs/current/textsearch-controls.html) (https://www.postgresql.org/docs/current/functions-textsearch.html)
   - `create index jobs_search_vector_gin on jobs using gin (search_vector);` (GIN preferred for FTS). (https://www.postgresql.org/docs/current/textsearch-indexes.html)
   - `create index jobs_search_trgm_gin on jobs using gin ((lower(coalesce(title,'') || ' ' || coalesce(description,''))) gin_trgm_ops);` (trigram GIN for `%`/`ILIKE` paths). (https://www.postgresql.org/docs/current/pgtrgm.html)
   - `create or replace function search_jobs(...) returns table …` per §3.2: `websearch_to_tsquery('simple', kw)` primary predicate, `'%'/ '<%'` trigram fallback predicate with `SET LOCAL pg_trgm.similarity_threshold`, `ts_rank_cd` + `similarity` blend ordering with `created_at, id` tiebreaks, `OFFSET/LIMIT`. Never-raises query parsing comes free from `websearch_to_tsquery`. (https://www.postgresql.org/docs/current/textsearch-controls.html) (https://www.postgresql.org/docs/current/pgtrgm.html) (https://docs.postgrest.org/en/v12/references/api/functions.html)
2. **Why generated column over expression index or trigger:** auto-maintained on write with no trigger code (stored generated columns recompute on insert/update); addressable from `.textSearch()` for the interim path; expression must be byte-identical between index and query otherwise. Only immutable functions allowed — satisfied. (https://www.postgresql.org/docs/current/ddl-generated-columns.html)
3. **`unaccent`: skip** (Swahili has no diacritics); revisit only if accented loanwords appear. Custom synonym/stop-word files: infeasible on hosted Supabase (§1.4) — rely on trigram for morphology. (https://www.postgresql.org/docs/current/unaccent.html) (https://www.postgresql.org/docs/current/textsearch-dictionaries.html)

### 5.2 Index maintenance notes

- GIN indexes are larger and costlier to update than GiST/B-tree; size GIN growth expectations by measuring `pg_relation_size` on staging with production-like text, not by rule of thumb. Build-time mitigation officially documented: raise `maintenance_work_mem` for the index build. (https://www.postgresql.org/docs/current/textsearch-indexes.html)
- Dead-row reclaim, planner stats, and visibility-map upkeep come from routine (auto)vacuuming; keep autovacuum on (default) and run `ANALYZE jobs` after bulk loads/backfills so the planner sees the new lexeme distribution. Standard `VACUUM` runs alongside production reads/writes; avoid `VACUUM FULL` (exclusive lock). (https://www.postgresql.org/docs/current/routine-vacuuming.html)
- Write amplification is bounded: each insert/update rewrites one `tsvector` + both GIN entries (lexeme postings + trigrams). If job-post throughput ever makes this measurable, options are (a) drop the trigram GIN and keep FTS-GIN + sequential trigram recheck, or (b) move ranking/suggestion workloads to read replicas — decide from `pg_stat_user_tables`/`pg_stat_user_indexes`, not upfront.

### 5.3 Representative Swahili regression queries (for future tests)

Seed fixtures with these listings, then assert each query returns the expected job (and, where noted, ranks exact above typo):

| # | Query | Expectation |
|---|---|---|
| 1 | `mpishi` | Exact: cook listing (`mpishi`, `kupika`, `upishi` in text). Baseline FTS recall. |
| 2 | `mpisi` (typo, missing `h`) | Typo tolerance: same cook listing via trigram fallback; FTS alone returns nothing. |
| 3 | `dereva binafsi` | Multi-word AND: private-driver listing; must not return generic `dereva` taxi listings above it. |
| 4 | `fundi umeme` | Multi-word: electrician listing (`fundi`, `umeme`, `waya`, `meme`). |
| 5 | `dada wa kazi` | Phrase-ish: housemaid listing; tests stop-word-free `simple` config (no English stop removal of `wa`). |
| 6 | `pika` | Morphology: matches `kupika`/`upishi`/`mpishi` listings via trigram; documents that FTS `:*` prefix alone is insufficient. |
| 7 | `mlinzi` / `ulizi` (typo) | Guard listing (`mlinzi`, `ulizi`, `security`): exact + typo pair. |
| 8 | `mjengo` | Construction listing (`mjengo`, `ujenzi`, `kujenga`): morphology family beyond prefix match. |
| 9 | `bodaboda` | Single loanword term: motorcycle-taxi listing; also try `boda boda` (spaced) for tokenizer behavior. |
| 10 | `nywele` | Salon listing (`nywele`, `saluni`, `kusuka`): asserts skills-array text (`C`-weight) contributes to recall. |

Also assert invariants: `reviewed=false` jobs never surface, viewer's own phone excluded, empty keyword → `{ jobs: [], hasMore: false }`, and `{ jobs, hasMore }` pagination shape unchanged.

## Sources

- Postgres FTS intro (tsvector/tsquery/`@@`, preprocessing, configs): https://www.postgresql.org/docs/current/textsearch-intro.html
- Postgres text search functions/operators (`to_tsvector`, `plainto/phraseto/websearch_to_tsquery`, `ts_rank`/`ts_rank_cd`, `setweight`, prefix `:*`): https://www.postgresql.org/docs/current/functions-textsearch.html
- Controlling text search (parsing docs/queries, ranking + weights + normalization mask, `websearch_to_tsquery` never errors, `coalesce` + `setweight` pattern, ranking I/O cost): https://www.postgresql.org/docs/current/textsearch-controls.html
- Dictionaries (simple/Snowball/synonym/thesaurus, stop words, `$SHAREDIR/tsearch_data` file locations): https://www.postgresql.org/docs/current/textsearch-dictionaries.html
- Config example (`CREATE/ALTER TEXT SEARCH CONFIGURATION`): https://www.postgresql.org/docs/current/textsearch-configuration.html
- Preferred FTS index types (GIN preferred, GiST lossy/siglen, `maintenance_work_mem`): https://www.postgresql.org/docs/current/textsearch-indexes.html
- `pg_trgm` (concepts, `similarity`/`word_similarity`, `%`/`<%`/`<<%`/distances, thresholds/defaults, GIN vs GiST incl. KNN asymmetry, LIKE support + trigram-less-pattern caveat, FTS spell-suggest integration, trusted status): https://www.postgresql.org/docs/current/pgtrgm.html
- `unaccent` (filtering dictionary, trusted status): https://www.postgresql.org/docs/current/unaccent.html
- Generated columns (stored vs virtual, immutable-only expressions): https://www.postgresql.org/docs/current/ddl-generated-columns.html
- Routine vacuuming / autovacuum (space, stats, locks, `VACUUM FULL` avoidance): https://www.postgresql.org/docs/current/routine-vacuuming.html
- Supabase FTS guide (functions, generated-column + GIN pattern, computed-column multi-col search, `rpc()` ranking incl. weighted columns, `websearch` client usage): https://supabase.com/docs/guides/database/full-text-search
- Supabase extensions (enable via Dashboard/SQL, `extensions` schema, `pg_trgm` + `unaccent` on pre-installed list): https://supabase.com/docs/guides/database/extensions
- supabase-js `textSearch` reference (single column, `{ config, type: 'plain'|'phrase'|'websearch' }`): https://docs-supabase.vercel.app/docs/reference/javascript/v2/using-filters-textsearch
- PostgREST tables/views (operator table incl. `fts`/`plfts`/`phfts`/`wfts` + language prefix, `or` composition, `order` by columns): https://docs.postgrest.org/en/v12/references/api/tables_views.html
- PostgREST functions-as-RPC (GET for pure functions, table-valued filtering/limits, inlining): https://docs.postgrest.org/en/v12/references/api/functions.html
- Typesense docs index + Supabase sync guide (pg_net/http + pg_cron sync, triggers, edge functions, delete sync): https://typesense.org/docs/llms.txt and https://typesense.org/docs/guide/supabase-full-text-search.html
- Meilisearch overview (<50ms, typo tolerance, ranking rules, single binary): https://www.meilisearch.com/docs/learn/what_is_meilisearch
