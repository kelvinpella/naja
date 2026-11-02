# The model chooses the reply shape; the sender renders it

Replies used to be plain text, with the Options written as a numbered list while buttons were pending. Each Turn now returns a structured reply object — text, buttons, list, cta_url, or location_request — and `sendWhatsappReply` renders it as exactly one WhatsApp message. The schema is the contract: it carries Meta's limits (1024-character interactive body, three buttons of 20 characters, ten list rows of 24) and a when-to-use description per shape, which is what lets the model choose deliberately instead of guessing. A reply that does not satisfy the schema is sent as text with its choices numbered, so overflow costs a tap and never content.

## Considered Options

- A tool the model calls to send: rejected. Sending would move into the model layer, past the splitting, idempotency callback data, and per-person lock that `whatsapp-reply.ts` owns, and a turn that both called the tool and returned text could send twice.
- A markup convention inside the text: rejected. It is a parser to maintain, it drifts under the model's own wording, and the markup would be what Memory stores.
- Structured output only, failing the Turn when the model misses the schema: rejected. A router-picked model that ignores the schema would leave the person with nothing, and text is a valid reply shape — degrading to it is not an error path.

## Consequences

- Adding a shape is a schema variant plus a renderer arm, not a rewrite. Shapes that need Meta-side assets (product, carousel, catalog, Flow, calling) are deliberately absent, so the model cannot choose something that would fail at send.
- `structuredOutput` uses the provider's native response format, with `jsonPromptInjection: "auto"` so a FreeLLMAPI model without structured-output support still receives the schema.
- The one-message-per-Turn rule survives: interactive replies carry their own body, and the 4096-character text splitting still applies to the text shape alone.
- A Turn whose reply object is missing and whose text is a broken envelope sends the fallback apology rather than raw JSON.
- The `integrate-whatsapp` skill is attached by an absolute path derived from the module URL. Mastra resolves relative skill paths against `process.cwd()` and returns an empty catalog, without error, when the path is wrong.
