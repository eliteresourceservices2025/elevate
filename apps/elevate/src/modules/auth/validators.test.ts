import { describe, expect, it } from "vitest";
import { forgotPasswordSchema, mfaCodeSchema, resetPasswordSchema, signInSchema, signUpSchema } from "./validators";

describe("auth validators", () => {
  it("normalises email", () => {
    const r = signInSchema.parse({ email: "  Maria@Example.COM ", password: "x" });
    expect(r.email).toBe("maria@example.com");
  });

  it("rejects bad emails", () => {
    expect(signInSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: "" }).success).toBe(false);
  });

  it("requires 12+ character passwords that match", () => {
    const base = { email: "a@b.co" };
    expect(signUpSchema.safeParse({ ...base, password: "short", confirmPassword: "short" }).success).toBe(false);
    expect(
      signUpSchema.safeParse({ ...base, password: "long-enough-pass", confirmPassword: "different-pass!" }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({ ...base, password: "long-enough-pass", confirmPassword: "long-enough-pass" }).success,
    ).toBe(true);
    expect(resetPasswordSchema.safeParse({ password: "a".repeat(11), confirmPassword: "a".repeat(11) }).success).toBe(
      false,
    );
  });

  it("accepts only 6-digit MFA codes", () => {
    expect(mfaCodeSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(mfaCodeSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(mfaCodeSchema.safeParse({ code: "12345a" }).success).toBe(false);
  });
});
