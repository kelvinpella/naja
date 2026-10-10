import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
let cachedEnv: { url: string; key: string; role: "anon" | "service" } | null = null;
let serviceCached: SupabaseClient | null = null;
let serviceCachedKey: string | null = null;

export function validateSupabaseConfig(): void {
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }
}

export function getJobsClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }
  // Recreate on env rotation instead of serving a stale client forever.
  if (!cached || !cachedEnv || cachedEnv.url !== url || cachedEnv.key !== anonKey) {
    cached = createClient(url, anonKey);
    cachedEnv = { url, key: anonKey, role: "anon" };
  }
  return cached;
}

// Server-side writes (insert/storage) must bypass RLS via the service-role key.
// Reads stay on the anon key so public RLS policies keep applying.
export function getJobsServiceClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (url && serviceKey) {
    if (!serviceCached || serviceCachedKey !== `${url}:${serviceKey}`) {
      serviceCached = createClient(url, serviceKey);
      serviceCachedKey = `${url}:${serviceKey}`;
    }
    return serviceCached;
  }
  console.warn("[supabase] SUPABASE_SERVICE_ROLE_KEY missing — writes fall back to anon key. Set it + RLS policies.");
  return getJobsClient();
}

export function resetJobsClient(): void {
  cached = null;
  cachedEnv = null;
  serviceCached = null;
  serviceCachedKey = null;
}
