import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { provisionCoreUser } from "@/modules/core/users";

export type AuthUser = {
  id: string;
  email: string;
  /** Role slugs. Filled from core.user_roles in Phase 0.3. */
  roles: readonly string[];
};

/**
 * Returns the signed-in user at AAL2, or redirects. Every server action and
 * query starts with this (CLAUDE.md rule 4). proxy.ts is only the first gate.
 */
export const requireUser = cache(async (): Promise<AuthUser> => {
  const supabase = await createSupabaseServerClient();

  // getUser asks the auth server, so a revoked or forged session fails here.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalData?.currentLevel !== "aal2") redirect("/mfa");

  const { id, email, email_confirmed_at } = data.user;
  if (!email || !email_confirmed_at) redirect("/login");

  const user = await provisionCoreUser({ id, email });
  if (user.archivedAt) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  return { id, email, roles: [] };
});
