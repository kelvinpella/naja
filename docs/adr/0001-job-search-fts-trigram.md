# Job search uses Postgres FTS (simple) + pg_trgm via rpc

Naja job keyword queries need typo and Bantu-morphology tolerance with relevance ranking, without new infra. We use `simple`-config FTS (`websearch_to_tsquery`) over title/description/skills/area plus `pg_trgm` fallback, served by one `rpc(search_jobs)` ordered by blended rank then recency.

## Considered Options

- `english`-config FTS: rejected, English stemmer mangles Swahili prefixes and `:*` prefix cannot cover them.
- External index (Typesense/Meilisearch): rejected unless measured FTS+trigram failure; sync/ops cost unjustified for a ≤10-row menu.

## Consequences

- One migration owns `search_vector`, two GIN indexes, and `search_jobs()`; `.textSearch()`/`.or()` cannot express ranking or `%`, so ranked search must stay in `rpc`.
