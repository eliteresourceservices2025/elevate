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
});
