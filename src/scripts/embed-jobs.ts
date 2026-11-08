import { backfillJobEmbeddings } from "../services/jobs/backfill-embeddings.js";
import { getJobsAdminClient } from "../services/jobs/supabase-client.js";

/**
 * The vector backfill is maintenance, not app traffic: it updates rows that RLS
 * lets the anon key read but not write, so it runs with the service-role key.
 */
async function embedJobs(): Promise<void> {
  const embedded = await backfillJobEmbeddings({
    client: getJobsAdminClient(),
  });

  console.log(
    embedded === 0
      ? "Every Job already has an embedding."
      : `Done. Embedded ${embedded} job(s).`,
  );
}

void embedJobs().catch((error: unknown) => {
  console.error("Failed to embed Jobs:", error);
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 429
  ) {
    console.error(
      "The embedding provider is rate-limited or out of quota. Nothing is lost: rerun `npm run jobs:embed` later and it resumes at the Jobs still missing a vector.",
    );
  }
  process.exitCode = 1;
});
