import { describe, expect, it } from "vitest";
import { codeLookupHash, hashPassphrase, limiterKey, looksLikeCode, looksLikePassphrase, newCaseCode, newPassphrase, newSalt, normalizeCode, normalizePassphrase, verifyPassphrase } from "./codes";

const PEPPER = "test-pepper-test-pepper-test-pepper-0123";

describe("case codes and passphrases", () => {
  it("are random, well formed and use no easily confused symbols", () => {
    const codes = new Set(Array.from({ length: 200 }, newCaseCode));
    expect(codes.size).toBe(200);
    for (const c of codes) {
      expect(c).toMatch(/^SV-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
      expect(looksLikeCode(normalizeCode(c))).toBe(true);
    }
    const pass = newPassphrase();
    // eslint-disable-next-line security/detect-unsafe-regex -- a fixed, bounded pattern in a test
    expect(pass).toMatch(/^([2-9A-HJKMNP-Z]{5}-){3}[2-9A-HJKMNP-Z]{5}$/);
    expect(looksLikePassphrase(normalizePassphrase(pass))).toBe(true);
  });

  it("are typed back forgivingly: case, spaces, dashes and the SV prefix do not matter", () => {
    expect(normalizeCode("sv abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normalizeCode("ABCDEFGHJKMN")).toBe("ABCDEFGHJKMN");
    expect(normalizePassphrase(" abcde-fghjk mnpqr stuvw ")).toBe("ABCDEFGHJKMNPQRSTUVW");
  });

  it("the stored lookup value depends on the pepper and never contains the code", () => {
    const code = normalizeCode(newCaseCode());
    const a = codeLookupHash(code, PEPPER);
    expect(a.equals(codeLookupHash(code, PEPPER))).toBe(true);
    expect(a.equals(codeLookupHash(code, `${PEPPER}x`))).toBe(false);
    expect(a.toString("latin1")).not.toContain(code);
  });
});

describe("passphrase verification", () => {
  it("accepts the right passphrase and refuses any other", async () => {
    const pass = normalizePassphrase(newPassphrase());
    const salt = newSalt();
    const hash = await hashPassphrase(pass, salt, PEPPER);
    expect(await verifyPassphrase(pass, { salt, hash }, PEPPER)).toBe(true);
    expect(await verifyPassphrase(normalizePassphrase(newPassphrase()), { salt, hash }, PEPPER)).toBe(false);
    expect(await verifyPassphrase(pass, { salt, hash }, `${PEPPER}other`)).toBe(false);
  });

  it("an unknown case does the same work and is refused, like a wrong passphrase", async () => {
    const pass = normalizePassphrase(newPassphrase());
    const salt = newSalt();
    const hash = await hashPassphrase(pass, salt, PEPPER);
    const time = async (fn: () => Promise<boolean>) => {
      const start = performance.now();
      const result = await fn();
      return { result, ms: performance.now() - start };
    };
    const wrong = await time(() => verifyPassphrase("WRONGWRONGWRONGWRONG", { salt, hash }, PEPPER));
    const unknown = await time(() => verifyPassphrase(pass, null, PEPPER));
    expect(wrong.result).toBe(false);
    expect(unknown.result).toBe(false);
    // Both ran a full scrypt: neither is near-instant (a skipped hash would be well under 1 ms).
    expect(wrong.ms).toBeGreaterThan(3);
    expect(unknown.ms).toBeGreaterThan(3);
  });
});

describe("limiter keys", () => {
  it("are keyed hashes that change every day and do not contain the address", () => {
    const a = limiterKey("ip", "203.0.113.9", PEPPER, "2026-10-01");
    expect(a).not.toContain("203.0.113.9");
    expect(a).toBe(limiterKey("ip", "203.0.113.9", PEPPER, "2026-10-01"));
    expect(a).not.toBe(limiterKey("ip", "203.0.113.9", PEPPER, "2026-10-02"));
    expect(a).not.toBe(limiterKey("ip", "203.0.113.10", PEPPER, "2026-10-01"));
  });
});
