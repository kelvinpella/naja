# Search runs in a stateless subagent, and the notice is sent at delegation

Naja delegates Tafuta kazi to a `search` subagent that owns query understanding:
it decides between finding Jobs for a need and listing the newest ones, extracts
and translates keyword terms into Swahili and English, and calls the tools. The
subagent has no memory, so it sees only the delegation prompt Naja writes; the
Person's Thread stays clean and search runs are cheap and repeatable.

The "search is underway" notice is sent by an `onDelegationStart` hook, not by
the model and not by the subagent: a fixed bilingual line, best-effort with its
own timeout, at most once per Turn, carrying its own trace key so it can be
told apart from the reply that follows. Delivery stays at-least-once like every
other send. The final reply still comes from Naja and is the one that carries
the Jobs.

## Considered Options

- The subagent sending its own notice on first tool call: same timing in
  practice, but puts WhatsApp I/O inside the delegated agent.
- The worker detecting the intent before the model: no model dependency, but it
  duplicates intent detection and fires on people merely mentioning searching.
- Typing indicator only: already sent, but it is not the explicit notice.

## Consequences

The notice leaves before any result exists, so it must never be the last message
a Person receives — Naja's reply is the one that closes the Turn. A failed
notice send is swallowed like the typing indicator and can never fail the Turn.
Delegation, the notice, and the search itself all appear in one trace, so a slow
search is visible as a nested span rather than a mysterious delay.
