# Kapso replaces Zernio as the WhatsApp provider

Naja now talks to WhatsApp through Kapso's official `@kapso/whatsapp-cloud-api` SDK against `https://api.kapso.ai/meta/whatsapp`, with the number's inbound webhook at `/webhooks/kapso`. The Zernio provider was removed outright rather than kept behind a seam: exactly one provider is configured, and the boundary is still the four send functions plus the webhook mapper, so a future swap touches the same files.

## Considered Options

- Keep Zernio alongside Kapso behind a provider abstraction: rejected. No second consumer exists, so the seam would be speculative.
- Call Kapso's HTTP API directly: rejected. The official SDK already covers flows, carousels, buttons, media download, and read receipts.
- Retain Zernio's send idempotency: not available. Kapso's proxy exposes no `Idempotency-Key`, so sends are at-least-once.

## Consequences

- Queue jobs are keyed on `phoneNumberId + personKey`; `eventId` is the Meta message id (wamid) and doubles as the read-receipt target. The mapper also records whether the recipient is a phone number or a BSUID.
- Retries can duplicate a send. Every outbound message carries the stable idempotency key in `biz_opaque_callback_data`, so status webhooks and support can attribute a duplicate to its originating job.
- Webhooks authenticate with `X-Webhook-Signature` (HMAC-SHA256 hex over the raw body), use the v2 payload, and run with buffering disabled.
- The typing indicator is `markRead` with `typing_indicator`, skipped when no message id is available.
- Meta's carousel limits now apply: 2–10 cards, 160-char bodies, at most 2 line breaks. Card bodies put date, area, and amount on one line so the excerpt keeps the third.
- Draft Flows are created through `flows.create` with their JSON and sent with `mode: "draft"`; the codebase never publishes them.
- The SDK captures `globalThis.fetch` at construction, so clients are built per call instead of cached; this also keeps test fetch stubs effective.
