import { closeSync, openSync, readFileSync, writeSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { assertPrivateInputPaths } from "./schedule-import-core";
import { buildDraft, filterSheet, finalizeMapping, type ProductionExport } from "./schedule-import-draft-core";
import { parseTimesheet } from "./schedule-import-core";

// Drafts the reviewed historical mapping from HR's attendance sheet and a read-only export of ELEVATE's people and clients.
// It touches no database and sends nothing anywhere. Everything it writes is PRIVATE (real names and ids): it must sit outside the
// repository, is created with owner-only permissions, and an existing file is never overwritten. Terminal output is counts only.
//
//   Draft:    pnpm tsx scripts/schedule-import-draft.ts --csv <sheet> --export <production-export.json> --out-dir <private-folder>
//   Finalize: pnpm tsx scripts/schedule-import-draft.ts --finalize <mapping-draft.json> --out <new-private-file> --hr-reviewed
//
// Finalize switches on the two HR acknowledgments. Do that only after HR has read review-for-hr.csv.

const exportSchema = z.object({
  employees: z.array(z.object({ id: z.uuid(), workEmail: z.string().min(3), first: z.string(), middle: z.string().nullable(), last: z.string(), preferred: z.string().nullable(), status: z.string() })),
  clients: z.array(z.object({ id: z.uuid(), name: z.string().min(1) })),
  assignments: z.array(z.object({ id: z.uuid(), employeeId: z.uuid(), clientId: z.uuid(), startDate: z.string(), endDate: z.string().nullable(), hoursPerWeek: z.number().nullable() })),
  schedules: z.array(z.object({ id: z.uuid(), employeeId: z.uuid(), effectiveFrom: z.string(), effectiveTo: z.string().nullable(), startTime: z.string(), endTime: z.string(), zone: z.string(), weekdays: z.array(z.number()), breakMinutes: z.number() })),
});

function args(argv: string[]) {
  const out = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hr-reviewed") { flags.add(a); continue; }
    if (!["--csv", "--export", "--out-dir", "--finalize", "--out"].includes(a) || !argv[i + 1] || argv[i + 1].startsWith("--") || out.has(a)) throw new Error("Invalid or missing command-line option.");
    out.set(a, argv[++i]);
  }
  return { out, flags };
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";

function writeNew(file: string, content: string) {
  const fd = openSync(file, "wx", 0o600); // refuses to overwrite
  try { writeSync(fd, content); } finally { closeSync(fd); }
}

function main() {
  const { out, flags } = args(process.argv.slice(2));
  const root = path.resolve(process.cwd(), "..", "..");

  if (out.has("--finalize")) {
    const draftPath = out.get("--finalize")!, target = out.get("--out");
    if (!target) throw new Error("--out is required with --finalize.");
    if (!flags.has("--hr-reviewed")) throw new Error("Finalizing switches on HR's acknowledgments: pass --hr-reviewed only after HR has read the review file.");
    assertPrivateInputPaths([draftPath], root);
    if (existsSync(target)) throw new Error("The output file already exists.");
    assertPrivateInputPaths([path.dirname(path.resolve(target))], root);
    const mapping = finalizeMapping(JSON.parse(readFileSync(draftPath, "utf8")));
    writeNew(target, JSON.stringify(mapping, null, 2));
    console.log(`Final mapping written (${mapping.entries.length} people).`);
    return;
  }

  const sheetPath = out.get("--csv"), exportPath = out.get("--export"), dir = out.get("--out-dir");
  if (!sheetPath || !exportPath || !dir) throw new Error("Require --csv, --export and --out-dir.");
  assertPrivateInputPaths([sheetPath, exportPath, dir], root);
  if (!statSync(dir).isDirectory()) throw new Error("--out-dir must be an existing folder.");
  const names = ["mapping-draft.json", "sheet-included.csv", "review-for-hr.csv", "manual-entry.csv"].map((n) => path.join(dir, n));
  if (names.some((n) => existsSync(n))) throw new Error("The output folder already has draft files: choose an empty folder.");

  const sheet = readFileSync(sheetPath, "utf8");
  const data = exportSchema.parse(JSON.parse(readFileSync(exportPath, "utf8"))) as ProductionExport;
  const observations = parseTimesheet(sheet);
  const draft = buildDraft(observations, data);

  if (draft.mapping) {
    writeNew(names[0], JSON.stringify(draft.mapping, null, 2));
    writeNew(names[1], filterSheet(sheet, draft.includedPairs));
  }
  writeNew(names[2], csv([
    ["Sheet name", "Matched person in ELEVATE", "Work email", "Client", "Schedule text on sheet", "Start", "End", "Time zone", "Working days", "Unpaid break (min) - ASSUMED", "First day on sheet (assignment and schedule start)", "Already recorded"],
    ...draft.review.map((r) => [r.name, r.employee, r.workEmail, r.client, r.scheduleText, r.start, r.end, r.zone, r.weekdays, r.breakMinutes, r.firstDay, r.existing]),
  ]));
  writeNew(names[3], csv([["Sheet name", "Client on sheet", "Why it needs a person"], ...draft.manual.map((m) => [m.name, m.client, m.reason])]));

  const pairs = new Set(observations.map((o) => `${o.name}|${o.client}`)).size;
  console.log(`Sheet: ${observations.length} clocked-in days, ${pairs} person-and-client pairs.`);
  console.log(`Ready for the importer: ${draft.review.length}. Need manual entry: ${draft.manual.length}.`);
  console.log(`Files written to the private folder: mapping-draft.json, sheet-included.csv, review-for-hr.csv, manual-entry.csv`);
  console.log("HR acknowledgments are OFF in the draft: the importer will refuse it until you finalize it after HR's review.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "The draft failed.");
  process.exit(1);
}
