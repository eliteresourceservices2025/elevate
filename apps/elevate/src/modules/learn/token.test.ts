import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LAUNCH_TOKEN_SECONDS, handoffUrl, hashLaunchToken, learnBaseUrl, newLaunchToken } from "./token";

describe("the launch token", () => {
  it("is 256 random bits, URL-safe, different every time, and stored only as its SHA-256", () => {
    const a = newLaunchToken();
    const b = newLaunchToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash.length).toBe(32);
    expect(a.hash.equals(createHash("sha256").update(a.token).digest())).toBe(true);
    expect(hashLaunchToken(a.token).equals(a.hash)).toBe(true);
  });

  it("lives for at most a minute", () => {
    expect(LAUNCH_TOKEN_SECONDS).toBeLessThanOrEqual(60);
  });
});

describe("where Learn is", () => {
  it("uses the configured address without a trailing slash", () => {
    expect(learnBaseUrl({ NEXT_PUBLIC_LEARN_URL: "https://learn.example.com/", NODE_ENV: "production" })).toBe("https://learn.example.com");
    expect(handoffUrl("https://learn.example.com")).toBe("https://learn.example.com/auth/handoff");
  });

  it("is not available in production until configured, and local in development", () => {
    expect(learnBaseUrl({ NODE_ENV: "production" })).toBeNull();
    expect(learnBaseUrl({ NODE_ENV: "development" })).toBe("http://localhost:3200");
  });
});
