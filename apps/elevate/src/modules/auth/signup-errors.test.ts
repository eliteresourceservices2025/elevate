import { describe, expect, it } from "vitest";
import { signInFailureMessage, signUpFailureMessage } from "./signup-errors";

describe("signUpFailureMessage", () => {
  it("is silent on success", () => {
    expect(signUpFailureMessage(null)).toBeNull();
    expect(signUpFailureMessage(undefined)).toBeNull();
  });

  it("never reveals the invitation check: a 403 looks like success", () => {
    expect(signUpFailureMessage({ status: 403, code: "unexpected_failure", message: "Sign-up is by invitation only." })).toBeNull();
    expect(signUpFailureMessage({ status: 403, code: "hook_payload_invalid", message: "Sign-up is by invitation only." })).toBeNull();
  });

  it("names a weak password", () => {
    expect(signUpFailureMessage({ status: 422, code: "weak_password", message: "Password should be at least 8 characters." })).toMatch(/stronger password/);
  });

  it("names a rate limit", () => {
    expect(signUpFailureMessage({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" })).toMatch(/Too many emails/);
  });

  it("names a confirmation email that could not be sent", () => {
    expect(signUpFailureMessage({ status: 500, code: "unexpected_failure", message: "Error sending confirmation email" })).toMatch(/could not send your confirmation email/);
    expect(signUpFailureMessage({ status: 502, message: "bad gateway" })).toMatch(/could not send/);
  });
});

describe("signInFailureMessage", () => {
  const CREDENTIALS = "Invalid email or password, or the email is not confirmed yet.";
  it("a wrong password, an unknown email and an unconfirmed email read the same", () => {
    expect(signInFailureMessage({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBe(CREDENTIALS);
    expect(signInFailureMessage({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" })).toBe(CREDENTIALS);
  });
  it("tells a platform problem apart from a wrong password", () => {
    expect(signInFailureMessage({ status: 500, code: "unexpected_failure", message: "boom" })).toMatch(/not a wrong password/);
    expect(signInFailureMessage({ status: 422, code: "email_provider_disabled", message: "Email logins are disabled" })).toMatch(/not a wrong password/);
    expect(signInFailureMessage({ status: 401, code: "bad_jwt", message: "Invalid API key" })).toMatch(/not a wrong password/);
  });
  it("names a rate limit", () => {
    expect(signInFailureMessage({ status: 429, code: "over_request_rate_limit", message: "x" })).toMatch(/Too many attempts/);
  });
});
