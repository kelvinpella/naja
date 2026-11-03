import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getJobsClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }
  cached = createClient(url, anonKey);
  return cached;
}

/** Internal seam for tests. */
export function resetJobsClient(): void {
  cached = null;
}
