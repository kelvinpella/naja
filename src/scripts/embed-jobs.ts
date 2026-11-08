import {
  embedTexts,
  jobEmbeddingText,
} from "../services/jobs/embeddings.js";
import { getJobsClient } from "../services/jobs/supabase-client.js";

// FreeLLMAPI's free tier allows ~100 requests/minute, and one request carries
// a whole batch. Twenty keeps a batch inside the model's input limit while
// leaving room for retries; the pause keeps the run under the rate limit.
const BATCH_SIZE = 20;
const PAUSE_MS = 1_200;

type UnembeddedJob = {
  id: string;
  title: string | null;
  description: string | null;
  area: string | null;
  skills: string[] | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fills `jobs.embedding` for every published Job that has none — the Jobs that
 * predate hybrid search, and any published while the provider was failing
 * (ADR 0008). Idempotent: it only ever selects rows where the vector is null.
 */
async function embedJobs(): Promise<void> {
  const client = getJobsClient();
  let embedded = 0;

  for (;;) {
    const { data, error } = await client
      .from("jobs")
      .select("id,title,description,area,skills")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(
        "Could not read Jobs without embeddings — has 20261013000003_hybrid_job_search.sql been applied?",
        { cause: error },
      );
    }

    const rows = (data ?? []) as UnembeddedJob[];
    if (rows.length === 0) break;

    const texts = rows.map(jobEmbeddingText);
    if (texts.some((text) => !text)) {
      throw new Error(
        `Job ${rows[texts.findIndex((text) => !text)]?.id} has no text to embed`,
      );
    }

    const vectors = await embedTexts(texts);

    for (const [index, row] of rows.entries()) {
      const { error: updateError } = await client
        .from("jobs")
        .update({ embedding: vectors[index] })
        .eq("id", row.id);
      if (updateError) {
        throw new Error(`Could not store the embedding for Job ${row.id}`, {
          cause: updateError,
        });
      }
      embedded += 1;
    }

    console.log(`Embedded ${embedded} job(s) so far.`);
    if (rows.length === BATCH_SIZE) await sleep(PAUSE_MS);
  }

  console.log(
    embedded === 0
      ? "Every Job already has an embedding."
      : `Done. Embedded ${embedded} job(s).`,
  );
}

void embedJobs().catch((error: unknown) => {
  console.error("Failed to embed Jobs:", error);
  process.exitCode = 1;
});
