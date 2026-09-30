import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Per CLAUDE.md it is used ONLY for signed storage uploads: the server
// issues a one-time token for one exact path, so this client can read and write nothing else.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
