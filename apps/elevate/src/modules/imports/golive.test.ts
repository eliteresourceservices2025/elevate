import { describe, expect, it } from "vitest";
import { envProblems, MANUAL_KEYS, MANUAL_STEPS, REQUIRED_ENV } from "./golive";

describe("go-live checklist rules", () => {
  it("has unique manual step keys", () => {
    expect(new Set(MANUAL_KEYS).size).toBe(MANUAL_STEPS.length);
  });
  it("lists missing settings by name only and flags a non-production copy", () => {
    const env = Object.fromEntries(REQUIRED_ENV.map((k) => [k, "value"]));
    expect(envProblems({ ...env, ELEVATE_ENV: "production" })).toEqual({ missing: [], notProduction: false });
    const partial = envProblems({ ...env, CRON_SECRET: "  ", RESEND_API_KEY: undefined, ELEVATE_ENV: "staging" });
    expect(partial.missing).toEqual(["RESEND_API_KEY", "CRON_SECRET"]);
    expect(partial.notProduction).toBe(true);
    expect(JSON.stringify(partial)).not.toContain("value");
  });
  it("asks for Brevo's SMTP login and key, not the Resend key, when Brevo is the provider", () => {
    const env = Object.fromEntries(REQUIRED_ENV.map((k) => [k, "value"]));
    const brevoOk = { ...env, RESEND_API_KEY: undefined, EMAIL_PROVIDER: "brevo", BREVO_SMTP_LOGIN: "l", BREVO_SMTP_KEY: "k", ELEVATE_ENV: "production" };
    expect(envProblems(brevoOk).missing).toEqual([]);
    expect(envProblems({ ...brevoOk, BREVO_SMTP_LOGIN: " " }).missing).toEqual(["BREVO_SMTP_LOGIN"]);
    expect(envProblems({ ...brevoOk, EMAIL_PROVIDER: undefined, BREVO_SMTP_KEY: undefined }).missing).toEqual(["RESEND_API_KEY"]);
  });
  it("follows the same provider rule as the sender: EMAIL_PROVIDER=resend wins over a leftover Brevo key", () => {
    const env = Object.fromEntries(REQUIRED_ENV.map((k) => [k, "value"]));
    const resendWins = { ...env, RESEND_API_KEY: undefined, EMAIL_PROVIDER: "resend", BREVO_SMTP_KEY: "k", ELEVATE_ENV: "production" };
    expect(envProblems(resendWins).missing).toEqual(["RESEND_API_KEY"]);
  });
});
