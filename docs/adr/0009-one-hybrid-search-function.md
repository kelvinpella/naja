# Job search is one `hybrid_search_jobs()` function, and its embedding is required

Tafuta kazi now has two modes behind one Option: a keyword-and-semantic search
for what a Person needs, and a newest-first list when they just want to see
what was published. Search has a single entry point, `hybrid_search_jobs()`,
which fuses two keyword lists (Swahili and English terms) with one semantic list
using reciprocal rank fusion — and `search_jobs()`, the FTS + trigram function
from ADR 0001, is dropped rather than kept as a fallback. The function keeps
ADR 0001's ranking inside each keyword list, so typo and morphology tolerance
survive.

The query embedding is required: when it cannot be produced, no search call is
made and Naja tells the Person search is unavailable. Document embeddings stay
nullable, because publishing a Job must not depend on the embedding provider
(see ADR 0008).

## Considered Options

- Keeping `search_jobs()` as a keyword-only fallback: safe, but two functions,
  two grants, and two ranking paths to keep in step.
- Accepting a null query embedding inside the function: one function, but a
  silent degraded mode that hides a broken embedding provider.
- A zero-vector sentinel: identical SQL shape, but it ranks documents against
  nonsense instead of refusing.

## Consequences

A router outage takes search down while posting keeps working — the asymmetry is
deliberate. Keyword-only recall is a mode of the hybrid function only in the
sense that null document vectors fall out of the semantic list; there is no
keyword-only search entry point anymore. `search_jobs()` should be dropped in
the same migration that creates the new function, so a stale function cannot be
called by an older deployment.

Supersedes the function contract in ADR 0001; the keyword ranking approach there
still holds.
