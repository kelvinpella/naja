# Naja

Naja is a Fastify API and BullMQ worker for a WhatsApp-based marketplace connecting Tanzanian households with trusted domestic workers. An AI agent built with [Mastra](https://mastra.ai) answers each inbound message and keeps the conversation in memory.

## Requirements

- Node.js 26 or later
- npm

## Setup

Install dependencies:

```sh
npm install
```

Create a `.env` file in the project root and set the Kapso credentials, the webhook secret you register with Kapso, and the OpenAI key the agent uses:

```env
KAPSO_API_KEY=your-kapso-api-key
KAPSO_PHONE_NUMBER_ID=your-whatsapp-phone-number-id
KAPSO_WEBHOOK_SECRET=replace-with-your-webhook-secret
KAPSO_BUSINESS_ACCOUNT_ID=your-waba-id
KAPSO_POST_JOB_FLOW_ID=the-draft-flow-id
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FREELLMAPI_API_KEY=freellmapi-your-unified-key
OPENAI_API_KEY=your-openai-api-key
REDIS_URL=redis://127.0.0.1:6379
```

`KAPSO_BUSINESS_ACCOUNT_ID` (the WABA id) is only needed for Flow administration. `KAPSO_POST_JOB_FLOW_ID` is the id printed by `npm run flows:post-job` (see [Post job Flow](#post-job-flow)). `KAPSO_API_BASE_URL` is optional and defaults to `https://api.kapso.ai`. Keep `.env` private. The development command loads it automatically. Without `FREELLMAPI_API_KEY` or `OPENAI_API_KEY` the worker still starts, but every Turn fails. `SUPABASE_SERVICE_ROLE_KEY` is only read by maintenance scripts such as `npm run jobs:embed`; it bypasses RLS, so never ship it to a client.

## Model

Development routes Turns through [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi), a local router that stacks free provider tiers behind one OpenAI-compatible endpoint:

1. Start the router (the install one-liner runs it on `http://localhost:3001`, see [Using the API](https://github.com/tashfeenahmed/freellmapi#using-the-api)).
2. Add provider keys on its Keys page.
3. Copy the unified `freellmapi-…` key into `FREELLMAPI_API_KEY`.

With `FREELLMAPI_API_KEY` set, the agent talks to `http://localhost:3001/v1` and sends the model id `auto`, letting the router choose. `FREELLMAPI_BASE_URL` changes the endpoint and `FREELLMAPI_MODEL` picks a model or routing strategy (`auto:fast`, `auto:smart`, a profile). FreeLLMAPI is for personal experimentation only — unset `FREELLMAPI_API_KEY` to fall back to `openai/gpt-6-luna`.

The same key and base URL produce embeddings for Tafuta kazi (`gemini-embedding-001`), so search needs the router running; without it, search reports itself unavailable while posting keeps working.

## Run locally

The development script starts local Redis when needed, then starts the API and the separate BullMQ worker:

```sh
npm run dev
```

Press Ctrl+C to stop the API, worker, and any Redis process that the script started. If a local Redis server was already running, the script leaves it running.

For deployment, run `npm start` and `npm run start:worker` as separate processes, both configured with the same `REDIS_URL`. Use a managed or separately supervised Redis instance; `scripts/dev.sh` is for local development.

The server listens on `http://localhost:3000`. `GET /` returns the service name, status, and description.

## Kapso WhatsApp webhook

Configure a Kapso phone-number webhook with:

- URL: `https://<public-host>/webhooks/kapso`
- Event: `whatsapp.message.received`
- Payload version: `v2`
- Buffering: off
- Secret: the same value as `KAPSO_WEBHOOK_SECRET`

Create it from the CLI (the same command works for a local ngrok tunnel):

```sh
kapso whatsapp webhooks new \
  --url "https://<public-host>/webhooks/kapso" \
  --event whatsapp.message.received \
  --payload-version v2 \
  --no-buffer-enabled \
  --active \
  --secret-key "$KAPSO_WEBHOOK_SECRET"
```

The endpoint verifies Kapso's `X-Webhook-Signature` (HMAC-SHA256 hex over the raw request body) and enqueues inbound `whatsapp.message.received` events in the `naja-whatsapp-incoming-messages` BullMQ queue before returning `200`. Outbound echoes and other subscribed events are acknowledged and ignored. A Redis-backed person lock prevents the same sender from being processed concurrently. A SHA-256 hash of the stable WhatsApp Business-Scoped User ID is preferred; the phone number is used when the BSUID is unavailable. If Redis cannot enqueue a message within three seconds, the endpoint returns `503` so Kapso can retry.

Sends go through the official `@kapso/whatsapp-cloud-api` SDK against the Kapso proxy. The proxy has no idempotency header, so delivery is at-least-once; each send carries the stable idempotency key in `biz_opaque_callback_data` so a duplicate can be traced to the job that produced it.

Jobs retry up to five times with exponential backoff. Exhausted jobs are copied to the `naja-whatsapp-incoming-messages-dead-letter` queue, and stalled jobs are logged. `SIGINT` and `SIGTERM` close Fastify and gracefully drain the worker.

## Agent

The worker imports `src/mastra/index.ts` and runs one Turn per inbound message, resolving the agent through that instance (`mastra.getAgent("naja")`) so traces attach, with no separate Mastra server involved. The agent is `openai/gpt-6-luna`, or `auto` through FreeLLMAPI when `FREELLMAPI_API_KEY` is set (see [Model](#model)), with a Swahili-first prompt that mirrors the user's language. It has three actions: it delegates Tafuta kazi to the `search` subagent (see [Tafuta kazi](#tafuta-kazi)), it looks up a single Job with the `get-job` tool when a card is tapped, and it sends the post job Flow (see [Post job Flow](#post-job-flow)).

Each Person has one conversation for life, and the Thread id is the hashed sender identity, so history survives phone-number changes and Redis restarts. Every Person shares one memory `resource` (`naja`), because that is how [Studio](#studio) lists Threads; the Thread is titled with the Person's phone number. Memory is stored in a local LibSQL file at `.data/mastra.db` (git-ignored), and [Observational Memory](https://mastra.ai/docs/memory/observational-memory) compresses older history into observations so long conversations do not fill the context window. The file is per-worker: run a single worker process, and switch to a shared database before scaling out.

Media is not read this round. Images, voice notes, documents, stickers, and locations reach the model as typed placeholders such as `[voice note]` or `[image] caption: "..."`, and the prompt requires the agent to tell the user it can only handle text.

Replies are plain text, split only when they exceed WhatsApp's 4096-character limit, and carry a derived idempotency key in `biz_opaque_callback_data`.

## Tafuta kazi

Finding work is a hybrid search: keyword matching in Swahili and English, plus semantic matching, fused with reciprocal rank fusion. Naja delegates to a stateless `search` subagent, which turns what the Person said into one to five job terms per language and calls `hybrid_search_jobs()`; the backend embeds their original words for the semantic side. A search is announced the moment it is delegated, so the Person is not left waiting in silence.

Apply `supabase/migrations/20261013000003_hybrid_job_search.sql` in the dashboard before using search. It enables pgvector, adds `jobs.embedding vector(1536)` with an HNSW cosine index, creates `job_listings` (the column projection search may return), `hybrid_search_jobs()` and `list_recent_jobs()`, and drops the old `search_jobs()`.

Embeddings come from FreeLLMAPI: `gemini-embedding-001` is requested at 1536 dimensions and L2-normalized in code (pgvector's HNSW index stops at 2000 dimensions, see `docs/adr/0008-embeddings-at-1536-dimensions.md`). `EMBEDDING_MODEL` overrides the model id. A query must be embedded for a search to run: if the key is unset or the router is down, Naja says search is unavailable and offers the newest Jobs instead.

Jobs are embedded on publication, in the same insert. If that fails, the Job is published anyway without a vector and the Posting logs a warning; the backfill catches up:

```sh
npm run jobs:embed
```

It only selects rows where `embedding is null`, so it is safe to run repeatedly. It runs with `SUPABASE_SERVICE_ROLE_KEY`: RLS lets the anon key read and insert Jobs but turns an update into a `0`-row no-op, which would make the backfill re-embed the same batch until the provider rate-limits it. Every write is checked for the row it changed for that reason. Changing the embedding model or `EMBEDDING_DIMENSIONS` means re-embedding the corpus.

Results are rendered as a WhatsApp carousel. The model never composes a card: it names the Jobs the finder reported, and the worker builds the cards from `job_listings` — title, posted date, an excerpt and the amount, with the Job's photo or a placeholder image. Every card carries two buttons, `Omba` then `Soma zaidi`. `Soma zaidi` returns as a `job_detail:<id>` tap and is answered from the `get-job` tool with the Job's full description. `Omba` returns as a `job_apply:<id>` tap and is answered from the `apply-for-job` tool with the poster's phone number, so the two can talk directly — nothing is stored and the poster is not notified. Card bodies stay inside Meta's 160-character and two-line-break limits, because the sender rejects the whole carousel otherwise. A single matching Job cannot form a carousel (Meta's minimum is two cards), so it goes out as its detail text. A carousel Meta refuses degrades to the same cards as numbered text. The schema caps a reply at ten Jobs — Meta's carousel ceiling — and the finder returns at most nine.

Not wired yet: paging (`zaidi`) needs a cursor that survives the Turn, so it is deliberately absent rather than faked.

Kapso replies use `KAPSO_API_KEY`. The webhook endpoint uses `KAPSO_WEBHOOK_SECRET`, which must match the secret set on the Kapso webhook. `REDIS_URL` defaults to `redis://127.0.0.1:6379` if omitted.

For local testing, run `npm run dev` first, then run `npm run dev:ngrok` in a second terminal. Register the HTTPS forwarding URL printed by ngrok, followed by `/webhooks/kapso`, using the CLI command above.

## Post job Flow

Posting a job is a WhatsApp Flow, not a chat: when a Person says they want to post a job, the model replies with the `flow` shape and `sendWhatsappReply` sends the draft Flow named `naja_post_job`, resolving its id from `KAPSO_POST_JOB_FLOW_ID`. Deploy it once (draft only — this codebase never publishes it):

```sh
npm run flows:post-job
```

The script deploys `naja_post_job` as a draft, reuses it by name if it already exists, prints `KAPSO_POST_JOB_FLOW_ID=…`, and refuses to run without `KAPSO_BUSINESS_ACCOUNT_ID` and `KAPSO_API_KEY`. Put the id in `.env` and keep the Flow in draft mode: the sender always sends it with `mode: "draft"`.

The Flow has two screens: title, description, area and budget, then one optional photo. When the Person finishes it, `src/services/whatsapp-flow-completion.ts` reads the completion back from Kapso — Meta's webhook carries only `interactive.type: "nfm_reply"`, with no token and no answers — and the worker then routes it on the `post_job:` prefix of the `flow_token`, handing it to `src/services/jobs/post-job-intake.ts` — no model call. The intake validates the Submission, enqueues a Posting on the `naja-postings` queue, sends the receipt (`✅ Tumepokea tangazo lako: …`), and records both sides of the exchange in the Thread's Memory. It releases the person lock there: nothing else waits on the photo or on Supabase.

`src/workers/postings.ts` runs each Posting through the `post-job` workflow in `src/mastra/workflows/post-job.ts` (visible in Studio), then reports the outcome:

1. **moderate** — an automatic check of the text and the photo. `src/services/jobs/moderation.ts` is a placeholder that always passes; the photo is downloaded here and its bytes discarded, so they never enter workflow state.
2. **publish** — uploads the photo to the public `job_images` bucket, embeds the Job, and inserts it into Supabase `jobs` with `reviewed: true` and its `embedding` in the same row. The column is the visibility gate, so publishing is what sets it; the codebase no longer waits for a human to flip it. A failed embedding leaves the column null and the Job published anyway.
3. **report** — the worker, not a step: sends `🎉 … limechapishwa` and appends the outcome to Memory. It never throws, so a failed send cannot publish the same Job twice.

A Posting is attempted three times with backoff. When the third fails, the Person gets one apology whose button opens the same Flow prefilled with what they typed — the photo is the one thing they must pick again — and any image already uploaded is deleted. The prefill rides on `flow_action_payload.data`, which the DETAILS screen reads as `${data.initValues}`; that path is documented by Meta and valid against the Flow JSON, but has not been confirmed against a live draft Flow yet.

If `KAPSO_POST_JOB_FLOW_ID` is unset, or Meta rejects the send, the reply falls back to plain text instead of failing the Turn. A completion whose `flow_token` is still missing or not ours after the read-back is answered by the agent as an ordinary message; a read-back that fails outright is retried, and after the last attempt the Person is asked to try again. The photo is stored as it arrived — no conversion — with a 5 MB cap, and a missing photo simply leaves `job_image` null.

The `jobs` table and the `job_images` bucket are expected to pre-date this repo: no migration creates them. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are required for the submission path.

## Studio

[Mastra Studio](https://mastra.ai/docs/studio/overview) is a read-only console over what the worker produced. Every conversation starts on WhatsApp, so Studio is for looking, not chatting:

```sh
npm run studio
```

Studio reads the same `.data/mastra.db` the worker writes. `src/mastra/storage.ts` resolves that path from the project root rather than the working directory, because `mastra dev` changes directory before loading the app; the path it opened is printed at startup as `Mastra memory: …`, so a split database is visible instead of looking like an empty console. Open <http://127.0.0.1:4111> and pick the `naja` agent.

- **Threads** are listed in the agent sidebar, titled with each Person's full phone number. Opening one shows the Conversation; the **Memory** tab shows the Observational Memory log, token progress bars against the observe/reflect thresholds, and any previous observations.
- **Observability → Traces** shows one trace per Turn: the model call, memory reads and writes, timings, and token usage. Traces are written to the same database by `MastraStorageExporter`. Metrics dashboards need a separate store (DuckDB) and are not configured.
- New Threads appear once the worker has created them, and are titled with the Person's phone number when they do. A Thread that predates this carries no title, and Studio labels it with its creation date; `npm run backfill:thread-titles` relabels those by reading the inbound messages Kapso still holds and hashing each sender the way the webhook does. A Person WhatsApp only ever identified by BSUID gets that BSUID as their title, since no phone number exists for them.

Two constraints keep this safe. Studio binds to `127.0.0.1:4111` in `src/mastra/index.ts` — never tunnel it, because its REST API can read every Conversation and write to Threads. And when a Person changes number, the Thread title follows the number they last wrote from; the Thread itself is keyed on the hashed identity, so history is unaffected.
