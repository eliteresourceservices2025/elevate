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

/**
 * The message for a failed password sign-in. A wrong password, an unknown email and an unconfirmed email all read the same, so the form
 * cannot reveal which emails exist. Anything that is NOT about the person's credentials (the sign-in service refusing, a bad key, a
 * rate limit, a server problem) is told apart, so a platform problem is not mistaken for "wrong password".
 */
export function signInFailureMessage(error: SignUpError): string {
  const code = (error.code ?? "").toLowerCase();
  const credentialProblem = code === "invalid_credentials" || code === "email_not_confirmed" || code === "user_not_found" || code === "user_banned";
  if (credentialProblem) return "Invalid email or password, or the email is not confirmed yet.";
  if (code === "over_request_rate_limit" || error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (code !== "" || (error.status !== null && error.status !== undefined && error.status >= 500)) {
    return "We could not sign you in right now. This is not a wrong password. Please try again in a few minutes, or ask HR for help.";
  }
  return "Invalid email or password, or the email is not confirmed yet.";
}
