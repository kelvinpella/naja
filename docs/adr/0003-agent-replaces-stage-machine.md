# The Mastra agent replaces the WhatsApp stage machine

Each inbound WhatsApp message used to be routed to a hand-written Stage that sent a fixed Message with fixed Options. Naja now hands the message to a Mastra agent (`openai/gpt-6-luna`) that answers in its own words, with the conversation held in Mastra Memory. The stage machine, its Flows, the job browsing/posting/application handlers, and their tests were deleted rather than left dormant: every remaining path would have been a second, unreachable way to answer a message.

## Considered Options

- Keep the Stage machine and add an agent beside it: rejected. Two conversation systems would both need to be reasoned about for every message, and the agent could not own the conversation while a Stage decided what it was allowed to say.
- A rule-based bot with intent matching: rejected. The conversations Naja wants (tell me about the service, help me find someone) do not fit a finite menu, and job search will need tools rather than more Stages.
- Store conversation state in Redis with a TTL, as before: rejected. Memory must outlive the 7-day window, and Observational Memory needs a supported storage adapter, not Redis.

## Consequences

- Replies are non-deterministic, and each Turn costs a model call. Content is pinned only by the system prompt in `src/mastra/agents/naja-instructions.ts`.
- One Person has one Thread for life (`resource = thread = personKey`), so memory survives deletions of Redis state and phone-number changes. Merging or splitting Threads is not supported.
- Memory lives in a LibSQL file (`.data/mastra.db`) behind `src/mastra/index.ts`. A single worker process owns it; moving to Postgres is a one-file change when multiple workers or durable deploys are needed.
- Observational Memory compresses old history into Observations instead of dropping it, with temporal markers so the model can tell a pause of minutes from one of days.
- Media cannot be read: voice notes, images, and documents reach the model as typed placeholders, and the prompt requires it to say so instead of guessing.
- The per-person lock and the BullMQ job lock were widened to 90s/180s, because a Turn plus a synchronous observation pass is much slower than a menu reply.
- Old button taps from the retired menus still arrive and are answered as an ordinary Turn; no Stage routing exists to honour their payloads.
