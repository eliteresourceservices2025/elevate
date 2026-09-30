import { describe, expect, it } from "vitest";
import {
  normalizeBankAccountNumber,
  normalizePagibig,
  normalizePayRate,
  normalizePhilhealth,
  normalizeSss,
  normalizeTin,
} from "./ids";

describe("PH government ID normalisers", () => {
  it("TIN: 9 or 12 digits, any separators", () => {
    expect(normalizeTin("123456789")).toBe("123-456-789");
    expect(normalizeTin("123 456 789 000")).toBe("123-456-789-000");
    expect(normalizeTin("123-456-789-000")).toBe("123-456-789-000");
    for (const bad of ["12345678", "1234567890", "12345678A", "", "123456789 0000"]) expect(normalizeTin(bad)).toBeNull();
  });

  it("SSS: 10 digits", () => {
    expect(normalizeSss("3412345678")).toBe("34-1234567-8");
    expect(normalizeSss("34-1234567-8")).toBe("34-1234567-8");
    expect(normalizeSss("34123456")).toBeNull();
  });

  it("PhilHealth: 12 digits", () => {
    expect(normalizePhilhealth("123456789012")).toBe("12-345678901-2");
    expect(normalizePhilhealth("12345678901")).toBeNull();
  });

  it("Pag-IBIG: 12 digits", () => {
    expect(normalizePagibig("123456789012")).toBe("1234-5678-9012");
    expect(normalizePagibig("1234-5678-9012")).toBe("1234-5678-9012");
    expect(normalizePagibig("1234-5678")).toBeNull();
  });

  it("bank account number: 6 to 34 letters, digits, spaces, dashes", () => {
    expect(normalizeBankAccountNumber(" 0012 3456  7890 ")).toBe("0012 3456 7890");
    expect(normalizeBankAccountNumber("12345")).toBeNull();
    expect(normalizeBankAccountNumber("1234567; drop table")).toBeNull();
  });

  it("pay rate: positive amount with at most two decimals", () => {
    expect(normalizePayRate("25,000")).toBe("25000.00");
    expect(normalizePayRate("25000.5")).toBe("25000.50");
    for (const bad of ["0", "-5", "abc", "1.234", "", "100000000"]) expect(normalizePayRate(bad)).toBeNull();
  });
});
