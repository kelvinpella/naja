# A Posting is a pipeline, not a send

The Flow completion used to be answered inline (ADR 0006): validate the Submission, download the photo, insert the Job, send one fixed confirmation, all inside the incoming message's Turn. It is now split. The incoming job validates, enqueues a **Posting**, sends a receipt, and records it in Memory; a second queue runs the Posting as a Mastra workflow — **moderate**, **publish** — and then reports the outcome back to the Person. The Person hears back in one send instead of after a photo download, an insert, and (once it is real) a moderation model call.

## Considered Options

- **Keep answering the completion inline**: rejected. The receipt is the one message that must arrive, and it would sit behind the work most likely to fail or hang — a 5 MB download, a Supabase write, and later a moderation call.
- **Let the pipeline store the Job and wait for a human Review before publishing**: rejected. With automatic Moderation there is no person on the pass path, so step two's message would either be dishonest ("stored" while nothing publishes) or never arrive. Publication is what the pipeline does.
- **Give the Posting the per-person lock**: rejected. That lock serialises Turns, and a Posting is not a Turn. Holding it would park the notification behind a model call and make the queue idle for the duration. Accepted instead: the notification can land mid-Turn, and Memory can say "awaiting publication" for a moment after the Job is live.
- **Store first, moderate after, delete on flag**: rejected. Flagged content would sit in a public bucket, and the delete becomes the failure-prone part of the path.
- **Moderate the text only**: rejected. The photo is the riskiest field of a job board, and the moderation model that will be used takes images too, so the step downloads it — and discards the bytes, because a multi-megabyte blob per run has no business in a workflow snapshot.
- **Keep five attempts**: rejected in favour of three. The Person already holds the receipt, so a retry is invisible; three is enough to ride out a blip and still apologise while the message reads as an answer rather than a hang.

## Consequences

- `reviewed: true` is now written by a machine on the pass path: the column means "visible", not "a person looked". Renaming it, or splitting publication from Review, belongs to the moderation round.
- **Review** narrows to a person's check of a flagged Posting. Nothing calls it yet.
- Two messages per Posting: the receipt, then the outcome. The receipt no longer names a job id, because the row does not exist yet; the outcome note carries it.
- Exactly one failure means "not posted": the enqueue. If only the receipt send fails, the incoming job retries; nothing that can throw follows the send, so the worst case is a receipt repeated, never a Job published twice.
- The third failed attempt sends one apology whose button opens the same Flow prefilled from the Submission, and deletes any image already uploaded. The photo cannot be prefilled, so it must be picked again.
- Moderation is a placeholder that always passes (`src/services/jobs/moderation.ts`). The flagged path is described above and unimplemented; a flagged Posting would be neither published nor deleted today.
- Duplicate completions are still two Postings: there is no dedupe beyond the `wamid` (ADR 0006).
- The Flow is still sent with `mode: "draft"`, and its completion still never reaches the model.
