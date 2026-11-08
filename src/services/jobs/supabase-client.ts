import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
let cachedAdmin: SupabaseClient | null = null;

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

/**
 * The service-role client for maintenance work that RLS would otherwise turn
 * into a silent no-op. The app never uses this; only backfill scripts do.
 */
export function getJobsAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env["SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin access is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The anon key cannot update jobs — RLS turns the update into a no-op.",
    );
  }
  cachedAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

/** Internal seam for tests. */
export function resetJobsClient(): void {
  cached = null;
  cachedAdmin = null;
}
