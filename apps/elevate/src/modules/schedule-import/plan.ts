import { clientKey, dayNames, employeeKeys, hoursPerWeek, parseScheduleText, personKey, suggestedBreak } from "./parse";
import type { Observation } from "./reader";

// Compares an attendance sheet with what ELEVATE already holds and says what each person would get: a new assignment and schedule, a
// change, or nothing. PURE and read-only: it never writes. Anything it cannot match with certainty becomes a decision for a person,
// with the reason, instead of a guess. The sheet's own totals and hours are never used.

export type LivePerson = { id: string; workEmail: string; first: string; middle: string | null; last: string; preferred: string | null; status: string };
export type LiveClient = { id: string; name: string };
export type LiveAssignment = { id: string; employeeId: string; clientId: string; startDate: string; endDate: string | null; hoursPerWeek: number | null };
export type LiveSchedule = { id: string; employeeId: string; effectiveFrom: string; effectiveTo: string | null; startTime: string; endTime: string; zone: string; weekdays: number[]; breakMinutes: number };
/** Matches HR confirmed earlier: normalized sheet spelling to the real person or client id. */
export type LiveAliases = { persons: Record<string, string>; clients: Record<string, string> };
export type LiveData = { employees: LivePerson[]; clients: LiveClient[]; assignments: LiveAssignment[]; schedules: LiveSchedule[]; aliases?: LiveAliases };

export type AssignmentAction = "add" | "keep" | "change_client";
export type ScheduleAction = "add" | "same" | "change";

export type PlanRow = {
  key: string;
  sheetName: string;
  sheetClient: string;
  personId: string;
  personName: string;
  workEmail: string;
  clientId: string;
  clientName: string;
  scheduleText: string;
  startTime: string;
  endTime: string;
  zone: string;
  weekdays: number[];
  weekdayLabel: string;
  /** Assumed from the shift length: the sheet does not say. HR confirms before anything is applied. */
  breakMinutes: number;
  /** Estimated from the schedule; goes to the client assignment's hours per week once confirmed. */
  hoursPerWeek: number;
  firstDay: string;
  lastDay: string;
  daysSeen: number;
  assignment: AssignmentAction;
  schedule: ScheduleAction;
  /** What would change for this person. */
  status: "update" | "unchanged";
  hoursNote: "fill" | "differs" | null;
  /** True when the effective date is more than 7 days back: the ordinary screens refuse that, so it needs the impact review. */
  backdated: boolean;
  /** Things a person should look at before accepting this row. */
  attention: string[];
  /** For a backdated row: what already exists from the start date on. Null when the row is not backdated. */
  impact: Impact | null;
  current: { clientName: string | null; assignmentStart: string | null; assignmentHours: number | null; shift: string | null; scheduleFrom: string | null };
};

/** `person` and `client` can be resolved on screen by choosing the real record (and remembering it); `other` needs the sheet or the records fixed. */
export type DecisionKind = "person" | "client" | "other";
export type Decision = { key: string; sheetName: string; sheetClient: string; reasons: string[]; kind: DecisionKind };
export type NotOnSheet = { assignmentId: string; employeeId: string; personName: string; clientName: string; assignmentStart: string };
/** How many dated records a backdated change would touch (counts only). Filled in by the service, which can read them. */
export type Impact = { attendanceDays: number; clockEvents: number; approvals: number; leaveRequests: number; extraHoursRequests: number };
export type Plan = {
  rows: PlanRow[];
  decisions: Decision[];
  notOnSheet: NotOnSheet[];
  totals: { pairs: number; ready: number; update: number; unchanged: number; needsDecision: number; backdated: number; attention: number; notOnSheet: number };
};

const ACTIVE = (status: string) => !["separated", "terminated", "archived"].includes(status);
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const shiftText = (s: { startTime: string; endTime: string; zone: string; weekdays: number[] }) => `${s.startTime}-${s.endTime} ${s.zone}, ${dayNames(s.weekdays)}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function buildPlan(observations: Observation[], live: LiveData, options: { today: string }): Plan {
  const rows: PlanRow[] = [];
  const decisions: Decision[] = [];

  const people = live.employees.filter((e) => ACTIVE(e.status));
  const byName = new Map<string, LivePerson[]>();
  for (const p of people) for (const k of employeeKeys(p)) byName.set(k, [...(byName.get(k) ?? []), p]);
  const byClient = new Map<string, LiveClient[]>();
  for (const c of live.clients) byClient.set(clientKey(c.name), [...(byClient.get(clientKey(c.name)) ?? []), c]);
  const clientName = new Map(live.clients.map((c) => [c.id, c.name]));

  const pairs = new Map<string, Observation[]>();
  for (const o of observations) {
    const k = JSON.stringify([o.name, o.client]);
    pairs.set(k, [...(pairs.get(k) ?? []), o]);
  }
  const clientsOfName = new Map<string, Set<string>>();
  for (const o of observations) clientsOfName.set(o.name, (clientsOfName.get(o.name) ?? new Set()).add(o.client));

  const usedPeople = new Set<string>();
  for (const [key, obs] of [...pairs.entries()].sort()) {
    const [sheetName, sheetClient] = JSON.parse(key) as [string, string];
    const decide = (kind: DecisionKind, ...reasons: string[]) => void decisions.push({ key, sheetName, sheetClient, reasons, kind });

    if ((clientsOfName.get(sheetName)?.size ?? 0) > 1) { decide("other", "Listed under more than one client on the sheet: choose which is current."); continue; }

    // The schedule text in use: the latest one on the sheet. Earlier texts are shown so a person can see the change.
    const byText = new Map<string, { n: number; first: string; last: string }>();
    for (const o of obs) {
      const d = o.date ?? options.today;
      const t = byText.get(o.schedule) ?? { n: 0, first: d, last: d };
      t.n += 1;
      if (d < t.first) t.first = d;
      if (d > t.last) t.last = d;
      byText.set(o.schedule, t);
    }
    const texts = [...byText.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last) || b[1].n - a[1].n);
    const [text] = texts[0];
    const attention: string[] = [];
    if (texts.length > 1) attention.push(`The schedule changed on the sheet. Using the latest, "${text}" (from ${texts[0][1].first}). Earlier: ${texts.slice(1).map(([t, v]) => `"${t}" until ${v.last}`).join("; ")}.`);

    const parsed = parseScheduleText(text);
    if ("error" in parsed) { decide("other", parsed.error); continue; }
    if (parsed.pattern) attention.push(`Working days read as ${dayNames(parsed.weekdays)} from "${parsed.pattern}". Confirm.`);

    // A match HR confirmed before wins over guessing from the name; the name lookup is only used when there is none.
    const remembered = live.aliases?.persons[personKey(sheetName)];
    const rememberedPerson = remembered ? people.find((p) => p.id === remembered) : undefined;
    const matches = rememberedPerson ? [rememberedPerson] : [...new Map((byName.get(personKey(sheetName)) ?? []).map((m) => [m.id, m])).values()];
    if (matches.length === 0) { decide("person", "No active person in ELEVATE has this name."); continue; }
    if (matches.length > 1) { decide("person", "More than one person in ELEVATE has this name."); continue; }
    const person = matches[0];
    if (usedPeople.has(person.id)) { decide("other", "The same person matched two different names on the sheet."); continue; }

    const rememberedClient = live.aliases?.clients[clientKey(sheetClient)];
    const clients = rememberedClient && live.clients.some((c) => c.id === rememberedClient) ? live.clients.filter((c) => c.id === rememberedClient) : (byClient.get(clientKey(sheetClient)) ?? []);
    if (clients.length !== 1) { decide("client", clients.length === 0 ? "The client is not in ELEVATE under this name." : "More than one client in ELEVATE has this name."); continue; }
    const client = clients[0];

    const dates = obs.map((o) => o.date ?? options.today).sort();
    const firstDay = dates[0];
    const lastDay = dates[dates.length - 1];
    const breakMinutes = suggestedBreak(parsed.startTime, parsed.endTime);
    const hours = hoursPerWeek(parsed.startTime, parsed.endTime, breakMinutes, parsed.weekdays.length);

    const open = live.assignments.filter((a) => a.employeeId === person.id && a.endDate === null);
    const openSchedule = live.schedules.find((s) => s.employeeId === person.id && s.effectiveTo === null) ?? null;
    const sameClient = open.find((a) => a.clientId === client.id) ?? null;
    const assignment: AssignmentAction = sameClient ? "keep" : open.length > 0 ? "change_client" : "add";
    const proposed = { startTime: parsed.startTime, endTime: parsed.endTime, zone: parsed.zone, weekdays: parsed.weekdays, breakMinutes };
    const schedule: ScheduleAction = !openSchedule ? "add" : same({ startTime: openSchedule.startTime, endTime: openSchedule.endTime, zone: openSchedule.zone, weekdays: openSchedule.weekdays, breakMinutes: openSchedule.breakMinutes }, proposed) ? "same" : "change";
    const hoursNote = sameClient ? (sameClient.hoursPerWeek === null ? "fill" : sameClient.hoursPerWeek !== hours ? "differs" : null) : null;
    if (open.length > 1) attention.push("This person has more than one current assignment.");
    if (openSchedule && openSchedule.effectiveFrom > firstDay) attention.push(`The current schedule starts ${openSchedule.effectiveFrom}, later than the first day on the sheet.`);

    usedPeople.add(person.id);
    const status = assignment === "keep" && schedule === "same" && hoursNote !== "fill" ? "unchanged" : "update";
    rows.push({
      key, sheetName, sheetClient, personId: person.id, personName: [person.first, person.last].filter(Boolean).join(" "), workEmail: person.workEmail,
      clientId: client.id, clientName: client.name, scheduleText: text, startTime: parsed.startTime, endTime: parsed.endTime, zone: parsed.zone,
      weekdays: parsed.weekdays, weekdayLabel: dayNames(parsed.weekdays), breakMinutes, hoursPerWeek: hours, firstDay, lastDay, daysSeen: obs.length,
      assignment, schedule, status, hoursNote, backdated: firstDay < addDays(options.today, -7), attention, impact: null,
      current: {
        clientName: open[0] ? (clientName.get(open[0].clientId) ?? null) : null,
        assignmentStart: open[0]?.startDate ?? null,
        assignmentHours: sameClient?.hoursPerWeek ?? open[0]?.hoursPerWeek ?? null,
        shift: openSchedule ? shiftText(openSchedule) : null,
        scheduleFrom: openSchedule?.effectiveFrom ?? null,
      },
    });
  }

  // People currently on a client that appears on the sheet, who do not appear on it: a prompt to look, never an automatic end.
  const sheetClients = new Set(rows.map((r) => r.clientId));
  const personName = new Map(live.employees.map((e) => [e.id, [e.first, e.last].filter(Boolean).join(" ")]));
  const notOnSheet: NotOnSheet[] = live.assignments
    .filter((a) => a.endDate === null && sheetClients.has(a.clientId) && !usedPeople.has(a.employeeId) && people.some((p) => p.id === a.employeeId))
    .map((a) => ({ assignmentId: a.id, employeeId: a.employeeId, personName: personName.get(a.employeeId) ?? "", clientName: clientName.get(a.clientId) ?? "", assignmentStart: a.startDate }))
    .sort((x, y) => x.clientName.localeCompare(y.clientName) || x.personName.localeCompare(y.personName));

  rows.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.personName.localeCompare(b.personName));
  return {
    rows,
    decisions,
    notOnSheet,
    totals: {
      pairs: pairs.size,
      ready: rows.length,
      update: rows.filter((r) => r.status === "update").length,
      unchanged: rows.filter((r) => r.status === "unchanged").length,
      needsDecision: decisions.length,
      backdated: rows.filter((r) => r.backdated).length,
      attention: rows.filter((r) => r.attention.length > 0).length,
      notOnSheet: notOnSheet.length,
    },
  };
}
