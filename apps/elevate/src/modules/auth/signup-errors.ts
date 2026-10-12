// What to tell a person whose sign-up did not go through. Pure.
//
// The form must never reveal who is invited, so a rejection by the invitation check (403) still reads as success. Only failures that
// do not depend on whether the address was invited are named: a weak password (checked before the invitation), too many emails, and a
// confirmation email the mail service could not send.

export type SignUpError = { code?: string | null; status?: number | null; message?: string | null };

/** The message to show, or null when the sign-up should look like success (including the "not invited" rejection). */
export function signUpFailureMessage(error: SignUpError | null | undefined): string | null {
  if (!error) return null;
  const code = (error.code ?? "").toLowerCase();
  const text = (error.message ?? "").toLowerCase();

  // The invitation check rejects with 403 before anything else happens: it must read as success.
  if (error.status === 403) return null;

  if (code === "weak_password" || text.includes("password")) {
    return "Choose a stronger password: at least 8 characters, not a common word or one that has appeared in a data breach.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) {
    return "Too many emails were sent just now. Wait a few minutes and try again.";
  }
  if (text.includes("sending") || (error.status !== null && error.status !== undefined && error.status >= 500)) {
    return "We could not send your confirmation email. Please try again in a few minutes, or ask HR for help.";
  }
  // Includes the 403 "Sign-up is by invitation only" rejection: it must look the same as success.
  return null;
}
