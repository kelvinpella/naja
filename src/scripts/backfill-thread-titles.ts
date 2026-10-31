// One-off: Threads created before Studio existed carry no title, so Studio
// labels them with their creation date and time. A phone number is not stored
// on a Thread — only the hash of the sender identity is — so the missing
// labels are rebuilt from the inbound messages Kapso still holds, hashing each
// sender exactly as the webhook path does.
//
// A Thread whose sender WhatsApp only ever identified by BSUID, with no phone
// number on any stored message, is titled with that BSUID: it is the only
// identity that exists for them.
//
// Usage: npm run backfill:thread-titles
import { najaMemory } from "../mastra/agents/naja.js";
import {
  personIdentity,
  personKeyFor,
} from "../services/kapso-event-mapper.js";
import { getKapsoClient } from "../services/kapso-client.js";
import { toE164Phone } from "../services/phone.js";

const apiKey = process.env.KAPSO_API_KEY;
const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;

if (!apiKey || !phoneNumberId) {
  console.error("KAPSO_API_KEY and KAPSO_PHONE_NUMBER_ID are required.");
  process.exit(1);
}

const { threads } = await najaMemory.listThreads({ perPage: false });
const untitled = new Map(
  threads
    .filter((thread) => !thread.title?.trim())
    .map((thread) => [thread.id, thread]),
);

if (untitled.size === 0) {
  console.log(`All ${threads.length} Threads already have a title.`);
  process.exit(0);
}

const client = getKapsoClient(apiKey);
const seenCursors = new Set<string>();
let cursor: string | undefined;
let scanned = 0;

// Stops as soon as every untitled Thread is matched, so a long message history
// only costs the pages it takes to find the People in the console.
while (untitled.size > 0) {
  const page = await client.messages.query({
    phoneNumberId,
    limit: 100,
    ...(cursor ? { after: cursor } : {}),
  });

  for (const message of page.data) {
    const identity = personIdentity({
      bsuid: message.fromUserId,
      phone: message.from,
    });
    if (!identity) continue;

    const thread = untitled.get(personKeyFor(identity));
    if (!thread) continue;

    const title = toE164Phone(message.from) ?? identity;
    await najaMemory.updateThread({
      id: thread.id,
      title,
      metadata: thread.metadata,
    });
    untitled.delete(thread.id);
    console.log(`titled ${thread.id} as ${title}`);
  }

  scanned += page.data.length;

  const next = page.paging.next ?? undefined;
  if (!next || seenCursors.has(next) || page.data.length === 0) break;
  seenCursors.add(next);
  cursor = next;
}

if (untitled.size === 0) {
  console.log(`Titled every Thread; ${scanned} message(s) scanned.`);
} else {
  console.log(
    `${scanned} message(s) scanned, ${untitled.size} Thread(s) still untitled. ` +
      "No stored message carries a phone number for them, so Studio keeps " +
      "showing their creation date until they write again:",
  );
  for (const thread of untitled.values()) {
    console.log(`  ${thread.id}`);
  }
}
