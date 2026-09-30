import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CryptoError, createFieldCrypto, maskValue } from "./crypto";

const key = () => randomBytes(32).toString("base64");
const CTX = "employee_sensitive:tin:emp-1";

describe("field encryption", () => {
  it("round-trips text, including unicode and empty strings", () => {
    const c = createFieldCrypto(`v1:${key()}`);
    for (const value of ["123-456-789-000", "Peña, José ₱1,250.50", "", "x".repeat(5000)]) {
      expect(c.decrypt(c.encrypt(value, CTX), CTX)).toBe(value);
    }
  });

  it("writes the version prefix and never stores plaintext", () => {
    const c = createFieldCrypto(`v1:${key()}`);
    const stored = c.encrypt("123-456-789-000", CTX);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("123-456-789");
  });

  it("uses a fresh nonce every time", () => {
    const c = createFieldCrypto(`v1:${key()}`);
    expect(c.encrypt("same", CTX)).not.toBe(c.encrypt("same", CTX));
  });

  it("rejects tampered ciphertext", () => {
    const c = createFieldCrypto(`v1:${key()}`);
    const stored = c.encrypt("secret", CTX);
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => c.decrypt(`v1:${raw.toString("base64")}`, CTX)).toThrow(CryptoError);
  });

  it("binds a value to its context: copying it to another row or column fails", () => {
    const c = createFieldCrypto(`v1:${key()}`);
    const stored = c.encrypt("secret", "employee_sensitive:tin:emp-1");
    expect(() => c.decrypt(stored, "employee_sensitive:tin:emp-2")).toThrow(CryptoError);
    expect(() => c.decrypt(stored, "employee_sensitive:sss:emp-1")).toThrow(CryptoError);
  });

  it("rejects malformed input", () => {
    const c = createFieldCrypto(`v1:${key()}`);
    for (const bad of ["", "nope", "v1:", "v1:AAAA", "x1:AAAA"]) {
      expect(() => c.decrypt(bad, CTX)).toThrow(CryptoError);
    }
  });

  it("errors never contain the plaintext or key material", () => {
    const k = key();
    const c = createFieldCrypto(`v1:${k}`);
    const stored = c.encrypt("very-secret-value", CTX);
    try {
      c.decrypt(stored, "wrong-context");
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain("very-secret-value");
      expect(message).not.toContain(k);
    }
  });
});

describe("key rotation", () => {
  it("new writes use the newest key; old values stay readable", () => {
    const k1 = key();
    const k2 = key();
    const before = createFieldCrypto(`v1:${k1}`);
    const oldValue = before.encrypt("payout-details", CTX);

    const after = createFieldCrypto(`v2:${k2},v1:${k1}`);
    expect(after.currentVersion).toBe("v2");
    expect(after.encrypt("x", CTX).startsWith("v2:")).toBe(true);
    expect(after.decrypt(oldValue, CTX)).toBe("payout-details");
  });

  it("flags old values and re-encrypts them with the newest key", () => {
    const k1 = key();
    const k2 = key();
    const oldValue = createFieldCrypto(`v1:${k1}`).encrypt("payout-details", CTX);
    const c = createFieldCrypto(`v2:${k2},v1:${k1}`);

    expect(c.needsReencrypt(oldValue)).toBe(true);
    const fresh = c.reencrypt(oldValue, CTX);
    expect(fresh.startsWith("v2:")).toBe(true);
    expect(c.needsReencrypt(fresh)).toBe(false);
    expect(c.decrypt(fresh, CTX)).toBe("payout-details");

    // Once every row is re-encrypted the old key can be retired.
    expect(createFieldCrypto(`v2:${k2}`).decrypt(fresh, CTX)).toBe("payout-details");
  });

  it("cannot read a value whose key was dropped", () => {
    const oldValue = createFieldCrypto(`v1:${key()}`).encrypt("x", CTX);
    const c = createFieldCrypto(`v2:${key()}`);
    expect(() => c.decrypt(oldValue, CTX)).toThrow(/No key is configured for v1/);
  });
});

describe("key configuration", () => {
  it("rejects missing, malformed, duplicate and wrong-length keys", () => {
    expect(() => createFieldCrypto(undefined)).toThrow(CryptoError);
    expect(() => createFieldCrypto("  ")).toThrow(CryptoError);
    expect(() => createFieldCrypto("not-a-key")).toThrow(CryptoError);
    expect(() => createFieldCrypto("v1:REPLACE_WITH_32_BYTE_BASE64_KEY")).toThrow(/32 bytes/);
    expect(() => createFieldCrypto(`v1:${randomBytes(16).toString("base64")}`)).toThrow(/32 bytes/);
    const k = key();
    expect(() => createFieldCrypto(`v1:${k},v1:${k}`)).toThrow(/repeats v1/);
  });
});

describe("maskValue", () => {
  it("shows only the last characters", () => {
    expect(maskValue("123-456-789-000")).toBe("••••••••9000");
    expect(maskValue("1234567890")).toBe("••••••7890");
    expect(maskValue("12")).toBe("••");
    expect(maskValue("")).toBe("");
  });
});
