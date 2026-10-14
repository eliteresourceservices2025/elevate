import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Keep the imported spreadsheet and mapping outside source control. Never include their values in diagnostics.
export type Observation = { date: string; name: string; client: string; schedule: string; row: number };
const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const zone = z.string().refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});
export const mappingSchema = z.object({
  entries: z.array(z.object({
    name: z.string().trim().min(1), client: z.string().trim().min(1),
    employeeId: z.uuid(), employeeWorkEmail: z.email(),
    clientId: z.uuid(), clientName: z.string().trim().min(1),
    assignmentStartDate: date,
    scheduleText: z.string().trim().min(1),
    shift: z.object({
      effectiveFrom: date, startTime: time, endTime: time,
      zone, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
        .refine((v) => new Set(v).size === v.length),
      breakMinutes: z.number().int().min(0).max(240),
    }),
    hoursPerWeek: z.number().gt(0).max(80).refine((v) => Number.isInteger(v * 10)).nullable(),
  })).min(1).max(200),
});
export type Mapping = z.infer<typeof mappingSchema>;

const historicalAssignment = z.object({
  id: z.uuid(), clientId: z.uuid(), startDate: date, endDate: date.nullable(), hoursPerWeek: z.number().nullable(),
});
const historicalSchedule = z.object({
  id: z.uuid(), effectiveFrom: date, effectiveTo: date.nullable(), startTime: time, endTime: time,
  zone, weekdays: z.array(z.number().int().min(1).max(7)), breakMinutes: z.number().int(),
});
export const historicalSchema = mappingSchema.extend({
  period: z.object({ from: z.literal("2026-10-01"), to: z.literal("2026-10-31") }),
  decisions: z.array(z.object({ employeeId: z.uuid(), expectedAssignment: historicalAssignment.nullable(),
    expectedSchedule: historicalSchedule.nullable(), acknowledgeAttendanceReview: z.literal(true),
    acknowledgeApprovalAndExportReview: z.literal(true) })).min(1).max(200),
});
export type HistoricalMapping = z.infer<typeof historicalSchema>;

// RFC 4180 fields, including doubled quotes and line breaks in quoted fields.
function records(text: string): { fields: string[]; line: number }[] {
  const result: { fields: string[]; line: number }[] = [];
  let fields: string[] = [], field = "", quoted = false, closed = false, line = 1, start = 1;
  const push = () => { fields.push(field.trim()); result.push({ fields, line: start }); fields = []; field = ""; closed = false; start = line; };
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- numeric index into a bounded input string
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { field += c; if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++; }
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ",") { fields.push(field.trim()); field = ""; closed = false; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++; push();
    } else if (closed || c === '"') throw new Error(`Invalid CSV near row ${start}.`);
    else field += c;
  }
  if (quoted) throw new Error(`Unclosed CSV quote near row ${start}.`);
  if (field || fields.length) push();
  return result;
}

export function parseTimesheet(text: string): Observation[] {
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw new Error("The file exceeds 2 MB.");
  const observations: Observation[] = [];
  let currentDate: string | null = null;
  let hasHeader = false;
  for (const { fields, line } of records(text.replace(/^﻿/, ""))) {
    if (fields.every((v) => !v)) continue;
    if (fields.length > 15) throw new Error(`Too many columns at row ${line}.`);
    const [rawDate, name, client, schedule] = fields;
    if (rawDate) {
      if (!/^\d{2}\/\d{2}\/\d{2}$/.test(rawDate)) throw new Error(`Invalid date at row ${line}.`);
      if (client || schedule) throw new Error(`Unexpected date-section contents at row ${line}.`);
      const [mm, dd, yy] = rawDate.split("/");
      const candidate = `20${yy}-${mm}-${dd}`;
      if (!date.safeParse(candidate).success) throw new Error(`Invalid date at row ${line}.`);
      currentDate = candidate;
      hasHeader = false;
      continue;
    }
    if (name === "Name" && client === "Client") {
      if (!currentDate || schedule !== "Schedule") throw new Error(`Unexpected header at row ${line}.`);
      hasHeader = true;
      continue;
    }
    if (!name) {
      if (fields.slice(2).some(Boolean)) throw new Error(`Incomplete observation at row ${line}.`);
      continue;
    }
    if (!currentDate || !hasHeader) throw new Error(`Missing date or section header at row ${line}.`);
    const total = fields[8]?.trim();
    if (schedule?.toLowerCase() === "training") continue;
    if (!total || !/^(?:\d{1,2}:\d{2}|\d{1,2}(?:\.\d{1,2})?)$/.test(total)) throw new Error(`Invalid total hours at row ${line}.`);
    const hours = total.includes(":") ? Number(total.split(":")[0]) + Number(total.split(":")[1]) / 60 : Number(total);
    if (hours > 24 || (total.includes(":") && Number(total.split(":")[1]) > 59)) throw new Error(`Invalid total hours at row ${line}.`);
    if (hours === 0) continue;
    if (hours < 0) throw new Error(`Invalid total hours at row ${line}.`);
    if (!client || !schedule) throw new Error(`Missing client or schedule at row ${line}.`);
    observations.push({ date: currentDate, name, client, schedule, row: line });
    if (observations.length > 2000) throw new Error("The file exceeds 2,000 observations.");
  }
  if (!observations.length) throw new Error("No observations found.");
  return observations;
}

const labelZone = new Map([
  ["AZ", "America/Phoenix"], ["ET", "America/New_York"], ["CT", "America/Chicago"],
  ["MT", "America/Denver"], ["PT", "America/Los_Angeles"],
]);

function parseClock(raw: string): string {
  const match = /^(\d{1,2}):(\d{2})(am|pm)$/i.exec(raw.replace(/\s/g, ""));
  if (!match) throw new Error("Unrecognized shift time.");
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) throw new Error("Invalid shift time.");
  return `${String(hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0)).padStart(2, "0")}:${match[2]}`;
}

function checkScheduleLabel(entry: Mapping["entries"][number]) {
  const match = /^(\d{1,2}:\d{2}\s*(?:am|pm))\s+(?:to|-)\s+(\d{1,2}:\d{2}\s*(?:am|pm))\s+([A-Z]{2})(?:\s+([MTWRFSU]+(?:-[MTWRFSU]+)?))?$/i.exec(entry.scheduleText);
  if (!match) throw new Error("Unrecognized schedule pattern.");
  const expectedZone = labelZone.get(match[3].toUpperCase());
  if (!expectedZone || expectedZone !== entry.shift.zone || parseClock(match[1]) !== entry.shift.startTime || parseClock(match[2]) !== entry.shift.endTime)
    throw new Error("Confirmed shift does not match the attendance sheet.");
  if (match[4]) throw new Error("Explicit weekday notation requires manual review.");
}

export function planRows(observations: Observation[], mapping: Mapping) {
  const byPair = new Map<string, Observation[]>();
  for (const row of observations) {
    const key = JSON.stringify([row.name, row.client]);
    byPair.set(key, [...(byPair.get(key) ?? []), row]);
  }
  const seen = new Set<string>(), employees = new Set<string>();
  const planned: Mapping["entries"] = [];
  for (const entry of mapping.entries) {
    if (entry.clientName !== entry.client) throw new Error("The reviewed client name differs from the sheet.");
    const key = JSON.stringify([entry.name, entry.client]);
    if (seen.has(key) || employees.has(entry.employeeId)) throw new Error("Duplicate mapping or more than one client for a schedule.");
    seen.add(key); employees.add(entry.employeeId);
    const rows = byPair.get(key);
    if (!rows?.length) throw new Error("A mapped person and client were not observed.");
    if (rows.some((r) => r.schedule !== entry.scheduleText)) throw new Error("Conflicting or unconfirmed schedule text.");
    checkScheduleLabel(entry);
    if (rows.some((r) => r.date < entry.assignmentStartDate || r.date < entry.shift.effectiveFrom))
      throw new Error("The confirmed start date is later than a recorded observation.");
    planned.push(entry);
  }
  if (seen.size !== byPair.size) throw new Error("Some observations lack a reviewed mapping.");
  const ids = new Set<string>();
  for (const entry of planned) {
    if (ids.has(entry.employeeId + ":" + entry.clientId)) throw new Error("Two mappings target one assignment.");
    ids.add(entry.employeeId + ":" + entry.clientId);
  }
  return planned.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function assertProductionTarget(env: { ELEVATE_ENV?: string; DATABASE_URL?: string; EXPECTED_DB_HOST?: string; EXPECTED_DB_NAME?: string; EXPECTED_DB_PROJECT_REF?: string }) {
  if (env.ELEVATE_ENV !== "production" || !env.DATABASE_URL || !env.EXPECTED_DB_HOST || !env.EXPECTED_DB_NAME || !env.EXPECTED_DB_PROJECT_REF)
    throw new Error("Production environment and expected database identity are required.");
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error("Invalid database URL."); }
  if (!/^postgres(ql)?:$/.test(url.protocol) || url.hostname.toLowerCase() !== env.EXPECTED_DB_HOST.toLowerCase()
    || !/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname.toLowerCase()) || url.port !== "6543"
    || !/^[a-z0-9]+$/.test(env.EXPECTED_DB_PROJECT_REF)
    || decodeURIComponent(url.username) !== `postgres.${env.EXPECTED_DB_PROJECT_REF}` || !url.password
    || decodeURIComponent(url.pathname.slice(1)) !== env.EXPECTED_DB_NAME
    || [...url.searchParams.keys()].length > 0 || url.hash)
    throw new Error("Database target does not match the approved production target.");
  return { host: url.hostname.toLowerCase(), name: env.EXPECTED_DB_NAME, projectRef: env.EXPECTED_DB_PROJECT_REF };
}

/** The imported sheet and identity mapping must never live in the source tree, even through a symlink. */
export function assertPrivateInputPaths(paths: string[], repositoryRoot: string) {
  const root = realpathSync(repositoryRoot);
  for (const input of paths) {
    const relative = path.relative(root, realpathSync(input));
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
      throw new Error("Import inputs must be stored outside the repository.");
  }
}

export function parseArgs(args: string[]) {
  const allowed = new Set(["--csv", "--mapping", "--as", "--apply", "--digest", "--historical", "--report"]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!allowed.has(flag) || options.has(flag) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error("Invalid or missing command-line option.");
    options.set(flag, args[i + 1]);
  }
  const csv = options.get("--csv"), mapping = options.get("--mapping"), actor = options.get("--as");
  if (!csv || !mapping || !actor) throw new Error("Require --csv, --mapping and --as.");
  const apply = options.get("--apply") === "confirm";
  if (options.has("--apply") && !apply) throw new Error("Use --apply confirm to apply.");
  const approvedDigest = options.get("--digest");
  if (apply && !/^[a-f0-9]{64}$/.test(approvedDigest ?? "")) throw new Error("Apply requires the reviewed --digest.");
  if (!apply && approvedDigest) throw new Error("A digest is only used with apply.");
  const historical = options.get("--historical") === "october-2026";
  if (options.has("--historical") && !historical) throw new Error("Use --historical october-2026.");
  if (historical !== options.has("--report")) throw new Error("Historical mode requires a private --report path; regular mode cannot write one.");
  return { csv, mapping, actor, apply, approvedDigest, historical, report: options.get("--report") };
}
