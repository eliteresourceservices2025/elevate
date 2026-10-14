import { historicalSchema, parseTimesheet, type HistoricalMapping, type Observation } from "./schedule-import-core";

// Turns HR's attendance sheet plus a read-only export of ELEVATE's people, clients and current assignments into a DRAFT of the
// reviewed historical mapping. Pure: no database and no files. It never decides anything irreversible: the draft has the HR
// acknowledgments switched OFF (the mapping is invalid until a person flips them), and everything it cannot match with certainty is
// listed for manual entry with a reason instead of being guessed.

export type ExportEmployee = { id: string; workEmail: string; first: string; middle: string | null; last: string; preferred: string | null; status: string };
export type ExportClient = { id: string; name: string };
export type ExportAssignment = { id: string; employeeId: string; clientId: string; startDate: string; endDate: string | null; hoursPerWeek: number | null };
export type ExportSchedule = { id: string; employeeId: string; effectiveFrom: string; effectiveTo: string | null; startTime: string; endTime: string; zone: string; weekdays: number[]; breakMinutes: number };
export type ProductionExport = { employees: ExportEmployee[]; clients: ExportClient[]; assignments: ExportAssignment[]; schedules: ExportSchedule[] };

export type ManualItem = { name: string; client: string; reason: string };
export type ReviewRow = { name: string; employee: string; workEmail: string; client: string; scheduleText: string; start: string; end: string; zone: string; weekdays: string; breakMinutes: number; firstDay: string; existing: string };
export type Draft = { mapping: HistoricalMapping | null; manual: ManualItem[]; review: ReviewRow[]; includedPairs: string[] };

const ZONES: Record<string, string> = { AZ: "America/Phoenix", ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles" };
const DAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Name tokens for matching: lower case, accents and punctuation removed, single-letter initials dropped. */
export function nameTokens(raw: string): string[] {
  return strip(raw)
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length > 1);
}
const tokenKey = (tokens: string[]) => [...tokens].sort().join(" ");
const clientKey = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function employeeKeys(e: ExportEmployee): Set<string> {
  const keys = new Set<string>();
  const add = (...parts: (string | null | undefined)[]) => {
    const k = tokenKey(nameTokens(parts.filter(Boolean).join(" ")));
    if (k) keys.add(k);
  };
  add(e.first, e.last);
  add(e.first, e.middle, e.last);
  add(e.preferred, e.last);
  add(e.preferred, e.middle, e.last);
  return keys;
}

const to24 = (raw: string): string => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(raw.trim());
  if (!m) throw new Error("time");
  return `${String((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)).padStart(2, "0")}:${m[2]}`;
};

/** A schedule text such as "8:00 am - 5:00 pm AZ". Texts with a weekday notation (T-F) are left for a person to read. */
export function parseScheduleText(text: string): { startTime: string; endTime: string; zone: string } | { error: string } {
  const m = /^(\d{1,2}:\d{2}\s*(?:am|pm))\s+(?:to|-)\s+(\d{1,2}:\d{2}\s*(?:am|pm))\s+([A-Z]{2})(?:\s+(.+))?$/i.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return { error: "The schedule text is not a shift (for example it says Training)." };
  if (m[4]) return { error: `The schedule has a weekday pattern ("${m[4]}"): confirm the working days by hand.` };
  const zone = ZONES[m[3].toUpperCase()];
  if (!zone) return { error: `Unknown time zone label "${m[3]}".` };
  try {
    return { startTime: to24(m[1]), endTime: to24(m[2]), zone };
  } catch {
    return { error: "The shift times could not be read." };
  }
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** An unpaid break suggested from the shift length: HR confirms it. */
export function suggestedBreak(startTime: string, endTime: string): number {
  let d = minutes(endTime) - minutes(startTime);
  if (d <= 0) d += 1440;
  return d >= 480 ? 60 : d >= 360 ? 30 : 0;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function buildDraft(observations: Observation[], data: ProductionExport): Draft {
  const manual: ManualItem[] = [];
  const review: ReviewRow[] = [];
  const entries: HistoricalMapping["entries"] = [];
  const decisions: HistoricalMapping["decisions"] = [];
  const included: string[] = [];

  const byPair = new Map<string, Observation[]>();
  for (const o of observations) {
    const k = JSON.stringify([o.name, o.client]);
    byPair.set(k, [...(byPair.get(k) ?? []), o]);
  }

  const people = data.employees.filter((e) => !["separated", "terminated", "archived"].includes(e.status));
  const personByKey = new Map<string, ExportEmployee[]>();
  for (const p of people) for (const k of employeeKeys(p)) personByKey.set(k, [...(personByKey.get(k) ?? []), p]);
  const clientByKey = new Map<string, ExportClient[]>();
  for (const c of data.clients) clientByKey.set(clientKey(c.name), [...(clientByKey.get(clientKey(c.name)) ?? []), c]);

  // A person may appear under two clients on the sheet: the importer supports one client per person per run, so those go to manual.
  const clientsPerName = new Map<string, Set<string>>();
  for (const o of observations) clientsPerName.set(o.name, (clientsPerName.get(o.name) ?? new Set()).add(o.client));

  const usedEmployees = new Set<string>();
  for (const [k, rows] of [...byPair.entries()].sort()) {
    const [name, clientName] = JSON.parse(k) as [string, string];
    const skip = (reason: string) => void manual.push({ name, client: clientName, reason });

    if ((clientsPerName.get(name)?.size ?? 0) > 1) { skip("Listed under more than one client on the sheet."); continue; }
    const texts = [...new Set(rows.map((r) => r.schedule))]; // exactly as the importer reads them
    if (texts.length > 1) { skip("The schedule text changed during the month: HR must say which one is current."); continue; }
    const text = texts[0];
    const parsedText = parseScheduleText(text);
    if ("error" in parsedText) { skip(parsedText.error); continue; }

    const matches = personByKey.get(tokenKey(nameTokens(name))) ?? [];
    const unique = [...new Map(matches.map((m) => [m.id, m])).values()];
    if (unique.length === 0) { skip("No active person in ELEVATE has this name."); continue; }
    if (unique.length > 1) { skip("More than one person in ELEVATE has this name."); continue; }
    const person = unique[0];
    if (usedEmployees.has(person.id)) { skip("The same person was matched twice."); continue; }

    const clients = clientByKey.get(clientKey(clientName)) ?? [];
    if (clients.length !== 1) { skip(clients.length === 0 ? "The client is not in ELEVATE under this name." : "More than one client has this name."); continue; }
    const client = clients[0];

    const firstDay = rows.map((r) => r.date).sort()[0];
    if (firstDay < "2026-10-01" || firstDay > "2026-10-31") { skip("The first day on the sheet is outside October 2026."); continue; }

    const shift = { effectiveFrom: firstDay, startTime: parsedText.startTime, endTime: parsedText.endTime, zone: parsedText.zone,
      weekdays: [1, 2, 3, 4, 5], breakMinutes: suggestedBreak(parsedText.startTime, parsedText.endTime) };

    // What is already recorded for this person decides whether the importer may touch them.
    const assignments = data.assignments.filter((a) => a.employeeId === person.id);
    const schedules = data.schedules.filter((s) => s.employeeId === person.id);
    const existing = [`${assignments.length} assignment(s)`, `${schedules.length} schedule(s)`].join(", ");
    if (assignments.length > 1 || schedules.length > 1) { skip("Already has several assignments or schedules: needs individual review."); continue; }
    if (assignments.some((a) => a.clientId !== client.id)) { skip("Already assigned to a different client: needs individual review."); continue; }
    if (assignments.some((a) => a.endDate !== null) || schedules.some((s) => s.effectiveTo !== null)) { skip("Has an ended assignment or schedule: needs individual review."); continue; }
    const a = assignments[0] ?? null;
    const s = schedules[0] ?? null;
    if (a && a.startDate < firstDay) {
      // An existing assignment that began earlier than the sheet's first day would be narrowed: leave it alone.
      skip("Already assigned from an earlier date than the sheet shows: no change needed or HR review.");
      continue;
    }
    if (a && a.hoursPerWeek !== null) { skip("Has agreed weekly hours that the sheet cannot confirm: needs individual review."); continue; }
    if (s && !same({ startTime: s.startTime, endTime: s.endTime, zone: s.zone, weekdays: s.weekdays, breakMinutes: s.breakMinutes },
      { startTime: shift.startTime, endTime: shift.endTime, zone: shift.zone, weekdays: shift.weekdays, breakMinutes: shift.breakMinutes })) {
      skip("Already has a different schedule: needs individual review."); continue;
    }
    if (s && s.effectiveFrom > firstDay) { skip("Has a schedule dated later than the sheet's first day."); continue; }

    usedEmployees.add(person.id);
    included.push(k);
    entries.push({ name, client: clientName, employeeId: person.id, employeeWorkEmail: person.workEmail, clientId: client.id, clientName: client.name,
      assignmentStartDate: firstDay, scheduleText: text, shift, hoursPerWeek: null });
    decisions.push({
      employeeId: person.id,
      expectedAssignment: a ? { id: a.id, clientId: a.clientId, startDate: a.startDate, endDate: a.endDate, hoursPerWeek: a.hoursPerWeek } : null,
      expectedSchedule: s ? { id: s.id, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo, startTime: s.startTime, endTime: s.endTime, zone: s.zone, weekdays: s.weekdays, breakMinutes: s.breakMinutes } : null,
      acknowledgeAttendanceReview: false as unknown as true,
      acknowledgeApprovalAndExportReview: false as unknown as true,
    });
    review.push({ name, employee: `${person.first} ${person.last}`, workEmail: person.workEmail, client: client.name, scheduleText: text, start: shift.startTime, end: shift.endTime,
      zone: shift.zone, weekdays: shift.weekdays.map((d) => DAY_LABEL[d]).join(", "), breakMinutes: shift.breakMinutes, firstDay, existing });
  }

  entries.sort((x, y) => x.employeeId.localeCompare(y.employeeId));
  decisions.sort((x, y) => x.employeeId.localeCompare(y.employeeId));
  const mapping = entries.length ? ({ entries, period: { from: "2026-10-01", to: "2026-10-31" }, decisions } as HistoricalMapping) : null;
  return { mapping, manual, review, includedPairs: included };
}

/** Flips the two literal HR acknowledgments on a drafted mapping, then proves it passes the importer's own schema. */
export function finalizeMapping(draft: unknown): HistoricalMapping {
  const d = structuredClone(draft) as { decisions?: { acknowledgeAttendanceReview: boolean; acknowledgeApprovalAndExportReview: boolean }[] };
  if (!Array.isArray(d.decisions) || d.decisions.length === 0) throw new Error("This is not a drafted mapping.");
  for (const x of d.decisions) { x.acknowledgeAttendanceReview = true; x.acknowledgeApprovalAndExportReview = true; }
  return historicalSchema.parse(d);
}

/** The sheet restricted to the included pairs, keeping the sheet's own lines (so the importer can still read it). */
export function filterSheet(text: string, includedPairs: string[]): string {
  const keep = new Set(includedPairs);
  const out: string[] = [];
  const fields = (l: string) => { const o: string[] = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; };
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const f = fields(line);
    if (!f[0] && f[1] && f[1] !== "Name") {
      if (keep.has(JSON.stringify([f[1].trim(), f[2].trim()]))) out.push(line);
      continue;
    }
    out.push(line); // date lines, header lines and blanks
  }
  return out.join("\n");
}

export function draftFromSheet(sheet: string, data: ProductionExport) {
  return buildDraft(parseTimesheet(sheet), data);
}
