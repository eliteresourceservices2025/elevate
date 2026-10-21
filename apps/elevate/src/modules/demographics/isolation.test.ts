import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The answers live in their own tables so no ordinary query can pick them up. Only the demographics module may name those
// tables or their columns; everything else goes through its service functions (save, clear, delete, summarize).

const SRC = path.resolve(import.meta.dirname, "..", "..");
const NAMES = /employee_demographics|employeeDemographics|candidate_self_identification|candidateSelfIdentification|religionEnc|religion_enc/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("self-identification tables stay inside the demographics module", () => {
  it("no other source file names them", () => {
    const offenders = files(SRC)
      .filter((f) => !f.includes(`${path.sep}modules${path.sep}demographics${path.sep}`))
      .filter((f) => NAMES.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  }, 30_000); // it reads every source file, which is slow when the whole suite runs at once

  it("recruiting and review code never reads gender or religion", () => {
    const offenders = ["recruiting", "reviews", "offers", "onboarding"]
      .flatMap((m) => files(path.join(SRC, "modules", m)))
      .filter((f) => !f.endsWith(`${path.sep}service.ts`) && !f.endsWith(`${path.sep}validators.ts`) && !f.endsWith(`${path.sep}route.ts`) && !f.endsWith(`${path.sep}apply-form.tsx`))
      .filter((f) => /\b(gender|religion)\b/i.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
