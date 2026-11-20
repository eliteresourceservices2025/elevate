import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Invoices read client hours through the one payroll helper and nothing else: no payroll schema, no pay decryption, no rates or amounts.

const dir = __dirname;
const files = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const f = path.join(d, n);
    return statSync(f).isDirectory() ? files(f) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [f] : [];
  });

describe("invoice module boundaries", () => {
  const sources = files(dir).map((f) => ({ f: path.relative(dir, f), s: readFileSync(f, "utf8") }));
  it("imports only clientHoursForRun from payroll, never its schema or pay decryption", () => {
    for (const { f, s } of sources) {
      const payrollImports = [...s.matchAll(/from "(@\/modules\/payroll\/[^"]+)"/g)].map((m) => m[1]);
      expect(payrollImports.filter((p) => p !== "@/modules/payroll/client-hours"), f).toEqual([]);
      expect(s, f).not.toMatch(/decryptRunLine|decryptLineAmounts|decryptItemValue|payRunLines|payLines|payroll_access|payrollAccess/);
    }
  });
});
