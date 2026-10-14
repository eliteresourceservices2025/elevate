import { readFileSync } from "node:fs";
import path from "node:path";
import { assertPrivateInputPaths, assertProductionTarget, historicalSchema } from "./schedule-import-core";

// The step that follows an applied historical schedule import: rebuild each affected person's attendance days from their clock events
// (never from the sheet) for the changed October dates, then repair the analytics summaries for the same range. It reads only the
// employee ids and dates from the private mapping and prints counts, never names.
//
//   Preview (default): pnpm rebuild:historical-october --mapping <private-final-mapping.json>
//   Run:               pnpm rebuild:historical-october --mapping <private-final-mapping.json> --run
//
// Needs the same production variables as the importer (ELEVATE_ENV, DATABASE_URL on the transaction pooler, EXPECTED_DB_*).
// Run it only AFTER the import apply succeeded. A person whose window fails is reported and the run stops, so nothing is left half-way
// without you knowing which window to repeat (a rebuild of the same window is safe to repeat).

const argv = process.argv.slice(2);
const mappingPath = argv[argv.indexOf("--mapping") + 1];
const run = argv.includes("--run");
if (argv.indexOf("--mapping") < 0 || !mappingPath || mappingPath.startsWith("--")) {
  console.error("Require --mapping <private mapping file>.");
  process.exit(1);
}

assertPrivateInputPaths([mappingPath], path.resolve(process.cwd(), "..", ".."));
const e = process.env;
const target = assertProductionTarget({ ELEVATE_ENV: e.ELEVATE_ENV, DATABASE_URL: e.DATABASE_URL, EXPECTED_DB_HOST: e.EXPECTED_DB_HOST, EXPECTED_DB_NAME: e.EXPECTED_DB_NAME, EXPECTED_DB_PROJECT_REF: e.EXPECTED_DB_PROJECT_REF });
const mapping = historicalSchema.parse(JSON.parse(readFileSync(mappingPath, "utf8")));

// Yesterday in the earliest time zone (UTC-12) is safe for every person: the rebuild itself refuses today or later in the person's zone.
const lastSafe = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const to = lastSafe < "2026-10-31" ? lastSafe : "2026-10-31";
if (to < "2026-10-01") {
  console.error("Nothing to rebuild yet: October has not finished a full day.");
  process.exit(1);
}
const windows = mapping.entries.map((e) => ({
  employeeId: e.employeeId,
  from: e.assignmentStartDate < e.shift.effectiveFrom ? e.assignmentStartDate : e.shift.effectiveFrom,
}));
console.log(`Target ${target.projectRef}. ${windows.length} people, rebuilding each from their start date through ${to}.`);
if (!run) {
  console.log("Preview only. Add --run to rebuild.");
  process.exit(0);
}

const { rebuildHistoricalAttendanceDays } = await import("../src/modules/attendance/jobs");
const { rebuildRange } = await import("../src/modules/analytics/build");

let done = 0;
let written = 0;
for (const [index, w] of windows.entries()) {
  if (w.from > to) continue;
  try {
    const result = await rebuildHistoricalAttendanceDays(w.employeeId, w.from, to);
    written += (result as { written?: number }).written ?? 0;
    done += 1;
  } catch (error) {
    console.error(`Stopped at person ${index + 1} of ${windows.length}: ${error instanceof Error ? error.message : "rebuild failed"}`);
    console.error(`${done} people were rebuilt before this. Fix the cause, then run again: a repeat is safe.`);
    process.exit(1);
  }
}
console.log(`Attendance rebuilt for ${done} people (${written} day rows written).`);

const earliest = windows.map((w) => w.from).sort()[0];
const analytics = await rebuildRange(earliest, to);
console.log(`Analytics rebuilt for ${earliest} to ${to}.`, analytics);
process.exit(0);
