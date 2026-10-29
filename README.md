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
OPENAI_API_KEY=your-openai-api-key
REDIS_URL=redis://127.0.0.1:6379
```

`KAPSO_BUSINESS_ACCOUNT_ID` (the WABA id) is only needed for Flow administration. `KAPSO_API_BASE_URL` is optional and defaults to `https://api.kapso.ai`. Keep `.env` private. The development command loads it automatically. Without `OPENAI_API_KEY` the worker still starts, but every Turn fails.

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

The worker imports the agent directly (`src/mastra/agents/naja.ts`) and runs one Turn per inbound message, so no separate Mastra server is involved. The agent is `openai/gpt-6-luna` with a Swahili-first prompt that mirrors the user's language; it has no tools yet, and it is instructed to say so rather than pretend to search, post, or apply.

Each Person has one conversation for life: the Mastra `resource` and `thread` are both the hashed sender identity, so history survives phone-number changes and Redis restarts. Memory is stored in a local LibSQL file at `.data/mastra.db` (git-ignored), and [Observational Memory](https://mastra.ai/docs/memory/observational-memory) compresses older history into observations so long conversations do not fill the context window. The file is per-worker: run a single worker process, and switch to a shared database before scaling out.

Media is not read this round. Images, voice notes, documents, stickers, and locations reach the model as typed placeholders such as `[voice note]` or `[image] caption: "..."`, and the prompt requires the agent to tell the user it can only handle text.

Replies are plain text, split only when they exceed WhatsApp's 4096-character limit, and carry a derived idempotency key in `biz_opaque_callback_data`.

Kapso replies use `KAPSO_API_KEY`. The webhook endpoint uses `KAPSO_WEBHOOK_SECRET`, which must match the secret set on the Kapso webhook. `REDIS_URL` defaults to `redis://127.0.0.1:6379` if omitted.

For local testing, run `npm run dev` first, then run `npm run dev:ngrok` in a second terminal. Register the HTTPS forwarding URL printed by ngrok, followed by `/webhooks/kapso`, using the CLI command above.