import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { AuthzUser } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureCoreUser } from "@/modules/core/users";

export type AuthUser = AuthzUser & { email: string };

/** Pass `{ allowGuest: true }` only in Messages (and the guest notice): a client guest is turned away everywhere else, so no other page or action can ever be reached by one. */
export type RequireUserOptions = { allowGuest?: boolean };

/**
 * Returns the signed-in user at AAL2 with roles, or redirects. Every server action and
 * query starts with this (CLAUDE.md rule 4), then calls authorize(). proxy.ts is only the first gate.
 */
// The sign-in work is cached per request; the guest check below is cheap and runs on every call (its options object would defeat the cache).
const loadSignedInUser = cache(async (): Promise<AuthUser> => {
  const supabase = await createSupabaseServerClient();

  // getUser asks the auth server, so a revoked or forged session fails here.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalData?.currentLevel !== "aal2") redirect("/mfa");

  const { id, email, email_confirmed_at } = data.user;
  if (!email || !email_confirmed_at) redirect("/login");

  const user = await ensureCoreUser({ id, email });
  if (user.archivedAt) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  return { id, email, roles: user.roles, isGuest: user.isGuest, isSafevoiceHandler: user.isSafevoiceHandler, payrollAccess: user.payrollAccess, isPrivacyOfficer: user.isPrivacyOfficer };
});

export async function requireUser(options: RequireUserOptions = {}): Promise<AuthUser> {
  const user = await loadSignedInUser();
  // Default deny: a guest has no roles, but must not even reach code that forgot to authorize. They are sent to Messages, their only page.
  if (user.isGuest && !options.allowGuest) redirect("/messages");
  return user;
}
