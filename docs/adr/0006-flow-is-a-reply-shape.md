# A Flow is a reply shape; its completion is not a Turn

> **Superseded in part by [ADR 0007](0007-a-posting-is-a-pipeline-not-a-send.md).** The Flow is still a reply shape and its completion still never reaches the model, but the completion now enqueues a Posting instead of doing the work inline.

ADR 0003 deleted the Flows along with the Stage machine. The Tangaza kazi (post job) Flow comes back, but nothing else from the stage machine does: the model sends the Flow as a reply shape it can choose (`{ kind: "flow", flow: "post_job" }`), the sender resolves that name to the draft Flow id in `KAPSO_POST_JOB_FLOW_ID`, and the Flow's completion is handled by code that never reaches the model.

## Considered Options

- **A tool the model calls to send the Flow**: rejected, for the reason ADR 0005 already gives. Sending would move past `sendWhatsappReply`'s callback data and the per-person lock, and a Turn that both called the tool and returned text could send twice.
- **The model handles the completion**: rejected. The payload is already a typed object (`title`, `description`, `area`, `budget`, `job_image`), so a model call buys no interpretation and makes validation non-deterministic — it could re-word a budget or drop a field. It also spends a Turn to produce one fixed confirmation sentence.
- **Deploy the Flow at worker startup**: rejected. It puts Meta's Flow API on the path that answers every message, and needs write credentials at boot. `npm run flows:post-job` deploys the draft and the worker only reads the env var, failing closed to a text reply when it is unset.
- **Route completions on the Flow's registered name**: rejected in favour of the `flow_token` we set when sending (`post_job:<personKey>`), which we control and which extends to the next Flow without ambiguity.
- **Write nothing to Memory after a completion**: rejected. The next Turn would see a bare `[tapped option]` and could offer to post the same job again a minute after it was saved. The handler writes a bracketed user-side note and the confirmation into the Thread with `saveMessages`.

## Consequences

- The model's involvement ends when the Flow is sent. It learns what happened only from the Memory note the handler writes, so that note is the seam where a future moderation step will report its outcome too.
- Routing on the token means the token has to be in hand, and Kapso forwards Meta's webhook without it: a completion arrives as `{ type: "interactive", interactive: { type: "nfm_reply" } }` with no answers at all. The worker therefore reads the completion back from Kapso (`messages.get` with `kapso(flow_response,flow_token)`) before routing it, and retries the incoming job if that read fails. When a delivery does arrive with the answers but without `kapso.flow_token`, the token is taken from the `flow_token` field inside those answers instead; missing one of the two is never a reason to send the completion to the model. Anything that is still not ours after the read — another Flow, a completion with no answers — is handed to the model, so it degrades to an ordinary Turn instead of a silent drop.
- The submission path is: validate, download the photo, insert with `reviewed: false`, send the fixed Swahili confirmation, write Memory. A transient failure throws and rides the existing five-attempt backoff; after exhaustion the person gets one apology and no automatic re-send.
- A Flow whose send fails (missing env var, Meta integrity error) falls back to a text reply rather than failing the Turn, so a broken Flow never takes the conversation down with it.
- The Flow JSON is authored in camelCase because the Kapso SDK's `flows.deploy` converts it to Meta's wire case and throws on snake_case keys.
- There is no dedupe beyond the BullMQ job id: two genuine completions are two jobs, both awaiting manual review.
