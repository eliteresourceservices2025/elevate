import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * How the signed-in person proved who they are in this session, for the certificate (for example "password, totp").
 * Read from the auth server, never from anything the browser sends. Null when it cannot be read.
 */
export async function currentSignInMethods(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const methods = (data?.currentAuthenticationMethods ?? []).map((m) => (typeof m === "string" ? m : m.method));
    return methods.length ? [...new Set(methods)].join(", ") : null;
  } catch {
    return null;
  }
}
