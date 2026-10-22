import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards for the look of the app (docs/modules/app-shell-and-dashboard.md, "UI foundation"). They read the source, so a page that
// slips back to a hand-written heading or a raw red/amber/green class fails here instead of drifting out of line unnoticed.

const SRC = path.join(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

describe("UI conventions", () => {
  it("pages in the signed-in app get their heading from PageHeader, never a hand-written h1", () => {
    const offenders = files(path.join(SRC, "app", "(app)"))
      .filter((f) => /<h1[\s>]/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  }, 30_000);

  it("status colours come from the success, warning, info and destructive tokens, not raw palette classes", () => {
    // Categories (document types), the print label sheet and the always-white signing paper preview are not statuses.
    const allowed = new Set(["modules/documents/type-style.ts", "modules/assets/components/label-sheet.tsx", "modules/signing/components/compose-editor.tsx"]);
    const raw = /\b(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent)-(?:red|amber|green|yellow|blue|emerald|orange|sky|rose|lime|teal|cyan|indigo|violet|purple|pink|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;
    const offenders = files(SRC)
      .filter((f) => !allowed.has(rel(f)))
      .filter((f) => raw.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  }, 30_000);

  it("pages use PageContainer for their width, not their own max-w wrapper at the top", () => {
    const offenders = files(path.join(SRC, "app", "(app)"))
      .filter((f) => f.endsWith("page.tsx"))
      .filter((f) => /return \(\s*<div className="(?:mx-auto |w-full )?(?:max-w-\w+ )?space-y-[68]">/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  }, 30_000);
});
