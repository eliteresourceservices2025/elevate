import { describe, expect, it } from "vitest";
import { ENROLLMENT_ALPHABET, hashSecret, newDeviceToken, newEnrollmentCode, normalizeCode, parseBearer } from "./device-token";

describe("normalizeCode", () => {
  it("uppercases and strips spaces and dashes", () => expect(normalizeCode(" abcd-2345 ")).toBe("ABCD2345"));
});

describe("newEnrollmentCode", () => {
  it("is 8 characters from the allowed alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = newEnrollmentCode();
      expect(code).toHaveLength(8);
      expect([...code].every((c) => ENROLLMENT_ALPHABET.includes(c))).toBe(true);
    }
  });
  it("has no look-alike characters", () => expect(ENROLLMENT_ALPHABET).not.toMatch(/[01OIl]/));
});

describe("newDeviceToken", () => {
  it("is 43 url-safe characters whose hash is what gets stored", () => {
    const { token, hash } = newDeviceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashSecret(token));
    expect(hash).not.toContain(token);
  });
  it("is different every time", () => expect(newDeviceToken().token).not.toBe(newDeviceToken().token));
});

describe("parseBearer", () => {
  it("returns the token from a Bearer header", () => expect(parseBearer("Bearer abc123")).toBe("abc123"));
  it("returns null for a missing header, another scheme, or an empty token", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
  });
});
