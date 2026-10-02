import { afterEach, describe, expect, it } from "vitest";
import { POLICIES, addressOf, allow, utcDay } from "./rate-limit";

const PEPPER = "test-pepper-test-pepper-test-pepper-0123";

describe("rate limiting without Upstash", () => {
  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("fails closed in production and open in development", async () => {
    expect(await allow("submit", "ip", "203.0.113.5", PEPPER, true)).toBe(false);
    expect(await allow("open", "ip", "203.0.113.5", PEPPER, true)).toBe(false);
    expect(await allow("perCode", "code", "abc", PEPPER, true)).toBe(false);
    expect(await allow("submit", "ip", "203.0.113.5", PEPPER, false)).toBe(true);
  });

  it("has a policy for sending, opening and guessing one case", () => {
    expect(POLICIES.submit.requests).toBeLessThanOrEqual(10);
    expect(POLICIES.perCode.requests).toBeLessThanOrEqual(20);
    expect(POLICIES.open.requests).toBeGreaterThan(0);
  });

  it("reads the forwarded address only to key the limiter, taking the first hop", () => {
    expect(addressOf(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }))).toBe("203.0.113.5");
    expect(addressOf(new Request("http://x"))).toBe("unknown");
    expect(utcDay(new Date("2026-10-01T23:59:59Z"))).toBe("2026-10-01");
  });
});
