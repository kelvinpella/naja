# Job embeddings are 1536 dimensions, indexed with HNSW cosine

Hybrid search needs `jobs.embedding` in pgvector, and `gemini-embedding-001`
emits 3072 dimensions, which `vector` cannot index with HNSW (2000-dimension
limit). We store `vector(1536)` using Google's recommended MRL truncation, which
scores the same as the full size on MTEB (68.17 vs ~68.3), costs half the
storage, and stays inside the index limit. Every embedding is L2-normalized in
our code because `gemini-embedding-001` only normalizes its default 3072 output,
so truncated vectors are not unit length on arrival.

## Considered Options

- `halfvec(3072)` with an HNSW half-vector index: full fidelity, indexable, but
  half precision, extra casts in the RPC, and twice the storage for no measured
  gain.
- `vector(3072)` with no index: exact scan only. Fine for today's row count, but
  it forfeits ANN permanently, and dimension is the expensive part to change.
- 768 dimensions: smaller and still close on MTEB, but leaves quality on the
  table for no index or storage benefit we need.

## Consequences

The dimension is effectively a one-way door: changing it means re-embedding
every Job. It must stay in sync across the column, the embedding request (the
router's `dimensions` parameter), and the normalization step. If the provider
cannot truncate, we truncate and renormalize the 3072 vector client-side rather
than store a mismatched width.
