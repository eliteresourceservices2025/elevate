import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Switching off someone's sign-in when they leave. The sign-in account is banned at the auth service (so it can no longer sign in or
// refresh a session) and, in ELEVATE, archived (so even a still-valid session is refused at the next request). Tests install a fake.

export type LoginDisabler = (userId: string) => Promise<void>;

let override: LoginDisabler | null = null;

/** Tests only: replace the call to the auth service. Pass null to restore the real one. */
export function setLoginDisabler(fn: LoginDisabler | null) {
  override = fn;
}

export async function disableLogin(userId: string): Promise<void> {
  if (override) return override(userId);
  const admin = createSupabaseAdminClient();
  // About a hundred years: HR can lift it by setting the ban to "none" in the auth dashboard if someone is rehired.
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (error) throw new Error("Could not disable the sign-in account");
}
