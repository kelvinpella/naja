# Studio is a read-only console over the worker's own database

Naja now runs Mastra Studio locally (`npm run studio` → `mastra dev` on `127.0.0.1:4111`) as a window into what the WhatsApp worker produced: each Person's Thread, its Observational Memory log, and one trace per Turn. It is not a chat box and not an editor — every Conversation starts on WhatsApp, so a message typed into Studio would be the only Conversation in the system that nobody had on their phone.

Supersedes the `resource = thread = personKey` consequence of [0003](0003-agent-replaces-stage-machine.md).

## Considered Options

- Hosted Studio on the Mastra platform (`mastra deploy`): rejected. The sandbox gets its own filesystem, so it would open an empty `.data/mastra.db` — a console pointed at a database that has never spoken to anyone. It also needs Kapso and model credentials bundled into a deploy and a `.mastra-project.json` in the repo.
- Keep the agent as a direct import and skip the Mastra instance: rejected. Registration is what hands the agent the observability config, so `najaAgent.generate()` without the instance produces no traces.
- Full Studio metrics (DuckDB, ClickHouse, or `PostgresStoreVNext`) via a `MastraCompositeStore`: deferred, not rejected. `MastraStorageExporter` already gives traces, timings, and token usage in spans; the metrics dashboard is the only thing it lacks, and it would add a second local database and a native DuckDB binding before we know the trace view is not enough.
- Studio's Editor (`@mastra/editor`, draft/publish prompt versions): rejected. The worker runs the prompt from `naja-instructions.ts`, so a draft in the database would be a second prompt that decides what some users get and nobody can find in the repo.
- Separate database for Studio: rejected. It contradicts the reason the console exists, which is to read the Threads the worker actually wrote.
- Keep `resource = personKey`: rejected after reading Studio's source. Its thread sidebar calls `useThreads({ resourceId: agentId })`, so Threads owned by a hash never appear, and no amount of titling fixes it.

## Consequences

- Every Person shares one memory `resource` (`naja`, the agent id); the Thread id remains the hashed sender identity. Memory features that scope to a resource — working memory, semantic recall, Observational Memory `retrieval` — must stay thread-scoped while this is shared, or one Person's memory will surface in another's Conversation.
- A Person's Thread is titled with the full phone number, refreshed on the Turn where the number changed and left alone otherwise. That is one read per Turn and a write only on a real change. BSUID-only Persons are titled with the BSUID.
- Existing Threads carry the hash as their `resourceId`, and a mismatch is a hard error (`Thread does not belong to resource`), not a no-op. `npm run backfill:thread-resource` moves them, and their messages, onto the shared resource.
- A Thread stores no phone number, only the hash of the sender identity, so a Thread created before titles existed is labelled with its creation date in Studio. `npm run backfill:thread-titles` recovers the label from the inbound messages Kapso still stores — it hashes each sender's `from`/`from_user_id` exactly as the webhook mapper does, then titles the matching Thread. Senders WhatsApp only ever identified by BSUID, with no phone number on any stored message, stay labelled with that BSUID; they gain a phone number the next time they write from one.
- Traces are written to `.data/mastra.db` by `MastraStorageExporter`, in the same file as Threads, with `SensitiveDataFilter` redacting keys and tokens. Tracing is unconditional — no environment enables or disables it — so dev and production behave identically. Adding DuckDB later is additive.
- Studio binds to `127.0.0.1:4111` in code rather than relying on a CLI default, because its REST API (`/api/*`, `/swagger-ui`) can generate replies and write to Threads. A tunnel to 4111 would expose real People's Conversations; `ngrok http 3000` remains the only tunnel in the project.
- `src/mastra/storage.ts` resolves `.data/mastra.db` from the project root instead of the working directory. `mastra dev` changes directory before it loads the app, so a relative URL opened a second, empty database there and Studio listed no Threads at all. The resolved path is logged at startup because that failure is otherwise silent — the app looks healthy and simply has no history.
- Studio opens the same LibSQL file as the worker while the worker is running. WAL plus a 5s `busy_timeout` and bounded write retries make reads free and overlapping writes rare; if `SQLITE_BUSY` retries ever appear during a Studio session, the fallback is a snapshot copy rather than a second database.
- The `mastra` CLI is a devDependency, so Studio is not needed to run Naja and a CLI upgrade cannot change the worker's behaviour.
