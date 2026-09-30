import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client for auth admin calls (reset an authenticator). Server-only; the key never
// reaches the browser. It bypasses row-level security, so only call it after authorize().
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials are not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
