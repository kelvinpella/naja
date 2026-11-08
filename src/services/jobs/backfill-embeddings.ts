import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, jobEmbeddingText } from "./embeddings.js";

// FreeLLMAPI's free tier allows ~100 requests/minute, and one request carries a
// whole batch. Twenty keeps a batch inside the model's input limit while
// leaving room for retries; the pause keeps the run under the rate limit.
export const BATCH_SIZE = 20;
export const PAUSE_MS = 1_200;

type UnembeddedJob = {
  id: string;
  title: string | null;
  description: string | null;
  area: string | null;
  skills: string[] | null;
};

export type BackfillDeps = {
  client: SupabaseClient;
  embed?: (texts: string[]) => Promise<number[][]>;
  pause?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fills `jobs.embedding` for every published Job that has none — the Jobs that
 * predate hybrid search, and any published while the provider was failing
 * (ADR 0008). Idempotent: it only ever selects rows where the vector is null.
 *
 * Every write is checked for the row it claims to have changed. Without that
 * check an RLS-denied update succeeds as a 0-row no-op, so the loop below would
 * re-embed the same batch forever and burn the provider's quota. Repeating a
 * job id is therefore treated as a failure, not a retry.
 */
export async function backfillJobEmbeddings({
  client,
  embed = embedTexts,
  pause = sleep,
  log = console.log,
}: BackfillDeps): Promise<number> {
  const seen = new Set<string>();
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

    for (const row of rows) {
      if (seen.has(row.id)) {
        throw new Error(
          `Job ${row.id} was read again after its embedding was stored. The update did not persist — check that SUPABASE_SERVICE_ROLE_KEY is set, because the anon key cannot update jobs.`,
        );
      }
      seen.add(row.id);
    }

    const texts = rows.map(jobEmbeddingText);
    if (texts.some((text) => !text)) {
      throw new Error(
        `Job ${rows[texts.findIndex((text) => !text)]?.id} has no text to embed`,
      );
    }

    const vectors = await embed(texts);
    if (vectors.length !== rows.length) {
      throw new Error(
        `Embedding provider returned ${vectors.length} vectors for ${rows.length} Jobs`,
      );
    }

    for (const [index, row] of rows.entries()) {
      const { data: updated, error: updateError } = await client
        .from("jobs")
        .update({ embedding: vectors[index] })
        .eq("id", row.id)
        .select("id");
      if (updateError) {
        throw new Error(`Could not store the embedding for Job ${row.id}`, {
          cause: updateError,
        });
      }
      if (!updated || updated.length === 0) {
        throw new Error(
          `Job ${row.id} was not updated. The anon key can read and insert Jobs but RLS blocks its updates; set SUPABASE_SERVICE_ROLE_KEY for the backfill.`,
        );
      }
      embedded += 1;
    }

    log(`Embedded ${embedded} job(s) so far.`);
    // The server may cap a page below BATCH_SIZE, so pause after every batch
    // rather than only when the page looked full.
    await pause(PAUSE_MS);
  }

  return embedded;
}
