import { describe, expect, it } from "vitest";
import { REDACTED, redact } from "./redact";

describe("redact", () => {
  it("hides secrets and government or payout fields, keeps the rest", () => {
    const out = redact({
      email: "a@b.co",
      password: "x",
      accessToken: "t",
      tin: "123",
      sss_number: "456",
      tinNumber: "789",
      philhealth: "1",
      bankAccountNumber: "2",
      payRate: 10,
      setting: "keep",
      string: "keep",
    });
    expect(out).toEqual({
      email: "a@b.co",
      password: REDACTED,
      accessToken: REDACTED,
      tin: REDACTED,
      sss_number: REDACTED,
      tinNumber: REDACTED,
      philhealth: REDACTED,
      bankAccountNumber: REDACTED,
      payRate: REDACTED,
      setting: "keep",
      string: "keep",
    });
  });

  it("works through nesting and arrays without touching the input", () => {
    const input = { roles: ["hr_admin"], nested: { secret: "s", list: [{ token: "t", ok: 1 }] } };
    const out = redact(input);
    expect(out.nested.secret).toBe(REDACTED);
    expect(out.nested.list[0]).toEqual({ token: REDACTED, ok: 1 });
    expect(input.nested.secret).toBe("s");
  });

  it("passes primitives and null through", () => {
    expect(redact(null)).toBeNull();
    expect(redact("x")).toBe("x");
    expect(redact(5)).toBe(5);
  });
});
