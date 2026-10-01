import { describe, expect, it } from "vitest";
import { allowWhenLimiterUnavailable } from "./rate-limit";

describe("when the rate limiter is missing or down", () => {
  it("never stops people clocking in or out, in production or anywhere else", () => {
    expect(allowWhenLimiterUnavailable("clock", true)).toBe(true);
    expect(allowWhenLimiterUnavailable("presence", true)).toBe(true);
    expect(allowWhenLimiterUnavailable("clock", false)).toBe(true);
  });

  it("still refuses everything else in production (fail closed), and allows it in development", () => {
    for (const policy of ["login", "signup", "passwordReset", "mfa", "reveal", "upload", "download"] as const) {
      expect(allowWhenLimiterUnavailable(policy, true)).toBe(false);
      expect(allowWhenLimiterUnavailable(policy, false)).toBe(true);
    }
  });
});
