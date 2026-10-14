#!/usr/bin/env npx tsx
// Safe, additions-only import. Run without --apply to preview. Never commit the input files.
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { DEFAULT_TIMEZONE } from "../src/lib/time";
import { assertPrivateInputPaths, assertProductionTarget, digest, mappingSchema, parseArgs, parseTimesheet, planRows } from "./schedule-import-core";
import { reconcile } from "./schedule-import-service";

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = assertProductionTarget({
    ELEVATE_ENV: process.env.ELEVATE_ENV, DATABASE_URL: process.env.DATABASE_URL,
    EXPECTED_DB_HOST: process.env.EXPECTED_DB_HOST, EXPECTED_DB_NAME: process.env.EXPECTED_DB_NAME,
    EXPECTED_DB_PROJECT_REF: process.env.EXPECTED_DB_PROJECT_REF,
  });
  assertPrivateInputPaths([opts.csv, opts.mapping], path.resolve(import.meta.dirname, "../../.."));
  const input = readFileSync(opts.csv, "utf8");
  const observations = parseTimesheet(input);
  const mapping = mappingSchema.parse(JSON.parse(readFileSync(opts.mapping, "utf8")));
  const entries = planRows(observations, mapping);
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 5, ssl: { rejectUnauthorized: true } });
  try {
    const [identity] = await sql<{ database: string; host: string }[]>`SELECT current_database() AS database, inet_server_addr()::text AS host`;
    if (identity?.database !== target.name || !identity.host)
      throw new Error("Database identity could not be verified.");
    const today = new Date();
    // Company schedule window is relative to Phoenix's date, not this machine's clock.
    const todayPhoenix = new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
    const from = new Date(`${todayPhoenix}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 7);
    const earliestAllowed = from.toISOString().slice(0, 10);
    const result = await reconcile(sql, { entries }, opts.actor, earliestAllowed, target, digest(input), opts.approvedDigest);
    console.log(opts.apply ? "Applied reviewed additions." : "Read-only preview; nothing was written.");
    console.log(`Target project: ${target.projectRef}. Database: ${identity.database}. Proposed assignments: ${result.assignments}. Proposed schedules: ${result.schedules}. Unchanged: ${result.unchanged}.`);
    console.log(`Plan digest: ${result.digest}`);
  } finally {
    await sql.end();
  }
}

main().catch(() => {
  // Don't print exceptions: SQL, file and validation errors can include personal data or connection strings.
  console.error("Import stopped. Check the input, mapping, target, actor and existing dated records; no partial batch was applied.");
  process.exitCode = 1;
});
