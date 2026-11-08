# The model names Jobs; the worker renders the cards

A search reply is a carousel, and the model's part of it is a `jobs` reply: one
line of text plus the ids the job finder reported. The worker resolves those
ids against `job_listings` and builds every card — image, title, date, excerpt,
amount, and the two buttons `Omba` and `Soma zaidi`, carrying `job_apply:<id>`
and `job_detail:<id>`. Cards are never copied from model output, so a
hallucinated id simply does not render, and the model never sees or repeats
image URLs. If the card list cannot be built, the reply degrades to its body as
text; if Meta rejects the carousel, the cards go out as numbered text instead.

`Soma zaidi` is answered from the `get-job` tool with the Job's full text.
`Omba` restores the pre-Mastra behaviour: `apply-for-job` reads the poster's
phone from `jobs` (`job_listings` omits it) and replies with the number so the
two can talk. There is still no application record or poster notification, so
"Omba" means "here is how to reach them", not "your application was sent".

## Considered Options

- The model composing the whole carousel (bodies, images, buttons): one reply
  shape, but every Meta limit and every image URL would have to survive the
  model, and a single invented field breaks the send.
- The worker rendering carousels on its own, bypassing the model: deterministic
  and fast, but it takes the choice of reply shape away from the agent, which
  ADR 0005 deliberately gave it.
- A tap handled by code before the model (`job_detail:` prefixes): robust, but
  it reintroduces the stage machine that ADR 0003 removed.

## Consequences

The reply contract has two faces: the model's schema (`jobs`) and the send
union (`carousel`). They must stay in step — `carousel` must never enter the
model's schema, or the model will try to fill it. Rendering needs a database
read after the model call, and the reply only carries ids, so a dead Job id
costs the Job rather than the message.
