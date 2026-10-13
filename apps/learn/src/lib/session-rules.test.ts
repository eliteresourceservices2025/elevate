import { describe, expect, it } from "vitest";
import { clearedCookie, cookieName, readSessionValue, sessionCookie } from "./cookie";
import { elevateUrl, originMatches, sameSiteOrigin } from "./origin";
import { hashValue, isWellFormedToken, newSessionValue } from "./tokens";

const post = (origin?: string) => new Request("https://learn.example.com/auth/handoff", { method: "POST", headers: origin ? { origin } : {} });

describe("tokens", () => {
  it("makes unique, well-formed 256-bit values and hashes them to 32 bytes", () => {
    const a = newSessionValue();
    const b = newSessionValue();
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
    expect(hashValue(a).length).toBe(32);
    expect(hashValue(a).equals(hashValue(a))).toBe(true);
    expect(hashValue(a).equals(hashValue(b))).toBe(false);
  });

  it("rejects anything that cannot be one of ours before it reaches the database", () => {
    for (const bad of ["", "short", "x".repeat(44), "x".repeat(42), `${"a".repeat(42)}!`, "a".repeat(42) + " ", undefined, null, 5, {}]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
    expect(isWellFormedToken("a".repeat(43))).toBe(true);
  });
});

describe("the session cookie", () => {
  it("is HttpOnly, SameSite=Lax and, in production, Secure with the __Host- prefix and no Domain", () => {
    const prod = sessionCookie("v".repeat(43), true);
    expect(prod.startsWith("__Host-learn_session=")).toBe(true);
    expect(prod).toContain("HttpOnly");
    expect(prod).toContain("SameSite=Lax");
    expect(prod).toContain("Secure");
    expect(prod).toContain("Path=/");
    expect(prod).not.toMatch(/Domain=/i);
    expect(prod).toContain(`Max-Age=${8 * 3600}`);

    const dev = sessionCookie("v".repeat(43), false);
    expect(dev.startsWith("learn_session=")).toBe(true);
    expect(dev).not.toContain("Secure");
  });

  it("is cleared with a zero lifetime", () => {
    expect(clearedCookie(true)).toContain("Max-Age=0");
    expect(clearedCookie(true).startsWith(`${cookieName(true)}=;`)).toBe(true);
  });

  it("reads only its own value out of a cookie header", () => {
    const value = "k".repeat(43);
    expect(readSessionValue(`other=1; learn_session=${value}; another=2`, false)).toBe(value);
    expect(readSessionValue(`__Host-learn_session=${value}`, true)).toBe(value);
    expect(readSessionValue(`learn_session=${value}`, true)).toBeNull();
    expect(readSessionValue("a=b", false)).toBeNull();
    expect(readSessionValue(null, false)).toBeNull();
    expect(readSessionValue("learn_session=", false)).toBeNull();
  });
});

describe("where a request may come from", () => {
  it("accepts only the expected origin", () => {
    expect(originMatches(post("https://elevate.example.com"), "https://elevate.example.com")).toBe(true);
    expect(originMatches(post("https://elevate.example.com"), "https://elevate.example.com/")).toBe(true);
    expect(originMatches(post("https://evil.example.com"), "https://elevate.example.com")).toBe(false);
    expect(originMatches(post("https://elevate.example.com.evil.com"), "https://elevate.example.com")).toBe(false);
    expect(originMatches(post("http://elevate.example.com"), "https://elevate.example.com")).toBe(false);
    expect(originMatches(post("null"), "https://elevate.example.com")).toBe(false);
    expect(originMatches(post(), "https://elevate.example.com")).toBe(false);
    expect(originMatches(post("https://elevate.example.com"), null)).toBe(false);
  });

  it("treats a post as same-site only when its Origin host is the host it was sent to", () => {
    const sent = (origin: string | null, headers: Record<string, string>) => new Request("https://learn.example.com/auth/signout", { method: "POST", headers: { ...(origin ? { origin } : {}), ...headers } });
    expect(sameSiteOrigin(sent("https://learn.example.com", { host: "learn.example.com" }))).toBe(true);
    expect(sameSiteOrigin(sent("http://localhost:3200", { host: "localhost:3200" }))).toBe(true);
    expect(sameSiteOrigin(sent("https://learn.example.com", { host: "internal:3000", "x-forwarded-host": "learn.example.com" }))).toBe(true);
    expect(sameSiteOrigin(sent("https://evil.example.com", { host: "learn.example.com" }))).toBe(false);
    expect(sameSiteOrigin(sent(null, { host: "learn.example.com" }))).toBe(false);
    expect(sameSiteOrigin(sent("https://learn.example.com", {}))).toBe(false);
    // the browser's own statement wins (a post under no-referrer carries Origin: null)
    expect(sameSiteOrigin(sent("null", { host: "learn.example.com", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameSiteOrigin(sent("https://learn.example.com", { host: "learn.example.com", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameSiteOrigin(sent(null, { host: "learn.example.com", "sec-fetch-site": "none" }))).toBe(false);
  });

  it("finds ELEVATE's address, with a local default only outside production", () => {
    expect(elevateUrl({ NEXT_PUBLIC_ELEVATE_URL: "https://elevate.example.com/", NODE_ENV: "production" })).toBe("https://elevate.example.com");
    expect(elevateUrl({ NODE_ENV: "production" })).toBeNull();
    expect(elevateUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });
});
