// One-off: Threads written before the Studio console existed carry the
// Person's hash as their `resourceId`. Studio lists Threads by
// `resourceId = agentId`, so those Threads are invisible in the console, and
// the next Turn fails with "Thread does not belong to resource". This moves
// each existing Thread (and its messages) onto the shared resource.
//
// Titles are not backfilled: the database stores no phone number per Thread,
// so a title appears on that Person's next Turn.
//
// Usage: npm run backfill:thread-resource
import { najaMemory } from "../mastra/agents/naja.js";
import { MEMORY_RESOURCE_ID } from "../mastra/thread-identity.js";

const { threads } = await najaMemory.listThreads({ perPage: false });

let moved = 0;

for (const thread of threads) {
  if (thread.resourceId === MEMORY_RESOURCE_ID) continue;

  await najaMemory.updateThreadResourceId({
    threadId: thread.id,
    resourceId: MEMORY_RESOURCE_ID,
  });
  moved += 1;
  console.log(`moved ${thread.id} from ${thread.resourceId}`);
}

console.log(
  moved === 0
    ? `No Threads needed moving; all ${threads.length} already belong to "${MEMORY_RESOURCE_ID}".`
    : `Moved ${moved} of ${threads.length} Threads to "${MEMORY_RESOURCE_ID}".`,
);
