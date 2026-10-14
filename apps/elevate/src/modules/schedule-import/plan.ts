import { clientKey, closest, dayNames, employeeKeys, hoursPerWeek, minutes, parseScheduleText, personKey, suggestedBreak, type ParsedSchedule } from "./parse";
import type { Observation } from "./reader";

// Compares an attendance sheet with what ELEVATE already holds and says what each person would get: a new assignment and schedule, a
// change, or nothing. PURE and read-only: it never writes. Anything it cannot match with certainty becomes a decision for a person,
// with the reason, instead of a guess. The sheet's own totals and hours are never used.
//
// A person listed under several clients gets one row per client (each with its own assignment). Their segments are combined into ONE
// shift when they are on the same days, in the same zone, one after another with a gap of at most 4 hours: ELEVATE keeps a single open
// schedule per person. When they cannot be combined (overlap, different days or zones) the assignments are still proposed and the
// schedule is left for a person to set.

export type LivePerson = { id: string; workEmail: string; first: string; middle: string | null; last: string; preferred: string | null; status: string };
export type LiveClient = { id: string; name: string };
export type LiveAssignment = { id: string; employeeId: string; clientId: string; startDate: string; endDate: string | null; hoursPerWeek: number | null };
export type LiveSchedule = { id: string; employeeId: string; effectiveFrom: string; effectiveTo: string | null; startTime: string; endTime: string; zone: string; weekdays: number[]; breakMinutes: number };
/** Matches HR confirmed earlier: normalized sheet spelling to the real person or client id. */
export type LiveAliases = { persons: Record<string, string>; clients: Record<string, string> };
export type LiveData = { employees: LivePerson[]; clients: LiveClient[]; assignments: LiveAssignment[]; schedules: LiveSchedule[]; aliases?: LiveAliases };

export type AssignmentAction = "add" | "keep" | "change_client";
/** `shared`: set together with the person's other client row. `unset`: not set by this import, a person sets it (reason in attention). */
export type ScheduleAction = "add" | "same" | "change" | "shared" | "unset";

export type PlanRow = {
  key: string;
  sheetName: string;
  sheetClient: string;
  personId: string;
  personName: string;
  workEmail: string;
  clientId: string;
  clientName: string;
  /** The person's other clients on this plan (ids), empty for a person on one client. */
  siblingClientIds: string[];
  siblingClientNames: string[];
  scheduleText: string;
  startTime: string;
  endTime: string;
  zone: string;
  weekdays: number[];
  weekdayLabel: string;
  /** Assumed from the shift length: the sheet does not say. HR confirms before anything is applied. */
  breakMinutes: number;
  /** Estimated from the schedule; goes to the client assignment's hours per week once confirmed. For a person on several clients it is
   * the person's total across them, on each client. */
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
/** The closest active person or client, offered as the pre-selected choice (a person still confirms it). */
export type Suggestion = { id: string; label: string };
export type Decision = { key: string; sheetName: string; sheetClient: string; reasons: string[]; kind: DecisionKind; suggestion: Suggestion | null };
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
const round1 = (n: number) => Math.round(n * 10) / 10;
/** The longest gap between a person's segments that still counts as one working day with a break. */
export const MAX_GAP_MINUTES = 240;

type Good = Exclude<ParsedSchedule, { error: string }>;
type Segment = {
  key: string; sheetClient: string; text: string; parsed: Good; clientId: string; clientName: string;
  firstDay: string; lastDay: string; daysSeen: number; breakMinutes: number; hours: number; attention: string[];
};
type Shift = { startTime: string; endTime: string; zone: string; weekdays: number[]; breakMinutes: number };

/** One shift for a person's segments, or the reason they cannot be combined. A single segment is its own shift. */
export function combineSegments(segs: Pick<Segment, "parsed" | "breakMinutes">[]): Shift | { error: string } {
  if (segs.length === 1) {
    const s = segs[0];
    return { startTime: s.parsed.startTime, endTime: s.parsed.endTime, zone: s.parsed.zone, weekdays: s.parsed.weekdays, breakMinutes: s.breakMinutes };
  }
  const sorted = [...segs].sort((a, b) => a.parsed.startTime.localeCompare(b.parsed.startTime) || a.parsed.endTime.localeCompare(b.parsed.endTime));
  if (new Set(segs.map((s) => s.parsed.zone)).size > 1) return { error: "the clients' times are in different time zones" };
  if (new Set(segs.map((s) => JSON.stringify(s.parsed.weekdays))).size > 1) return { error: "the clients are worked on different days" };
  if (segs.some((s) => s.parsed.endTime <= s.parsed.startTime)) return { error: "a shift runs past midnight" };
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = minutes(sorted[i].parsed.startTime) - minutes(sorted[i - 1].parsed.endTime);
    if (gap < 0) return { error: "the clients' times overlap" };
    if (gap > MAX_GAP_MINUTES) return { error: "the clients' times are more than 4 hours apart" };
    gaps += gap;
  }
  return {
    startTime: sorted[0].parsed.startTime,
    endTime: sorted.reduce((m, s) => (s.parsed.endTime > m ? s.parsed.endTime : m), sorted[0].parsed.endTime),
    zone: sorted[0].parsed.zone,
    weekdays: sorted[0].parsed.weekdays,
    breakMinutes: gaps + segs.reduce((n, s) => n + s.breakMinutes, 0),
  };
}

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
  // pair keys grouped by the person's spelling on the sheet
  const pairsOfName = new Map<string, string[]>();
  for (const k of [...pairs.keys()].sort()) {
    const [name] = JSON.parse(k) as [string, string];
    pairsOfName.set(name, [...(pairsOfName.get(name) ?? []), k]);
  }

  const usedPeople = new Set<string>();
  for (const [sheetName, keys] of [...pairsOfName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const decide = (key: string, kind: DecisionKind, suggestion: Suggestion | null, ...reasons: string[]) => {
      const [, sheetClient] = JSON.parse(key) as [string, string];
      decisions.push({ key, sheetName, sheetClient, reasons, kind, suggestion });
    };

    // Each pair's schedule is read first; a pair that cannot be read is a decision on its own.
    type Pair = { key: string; sheetClient: string; obs: Observation[]; text: string; parsed: Good; attention: string[] };
    const readable: Pair[] = [];
    let unresolved = 0;
    for (const key of keys) {
      const obs = pairs.get(key)!;
      const [, sheetClient] = JSON.parse(key) as [string, string];
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
      if ("error" in parsed) { decide(key, "other", null, parsed.error); unresolved += 1; continue; }
      if (parsed.pattern) attention.push(`Working days read as ${dayNames(parsed.weekdays)} from "${parsed.pattern}". Confirm.`);
      readable.push({ key, sheetClient, obs, text, parsed, attention });
    }
    if (readable.length === 0) continue;

    // A match HR confirmed before wins over guessing from the name; the name lookup is only used when there is none.
    const remembered = live.aliases?.persons[personKey(sheetName)];
    const rememberedPerson = remembered ? people.find((p) => p.id === remembered) : undefined;
    const matches = rememberedPerson ? [rememberedPerson] : [...new Map((byName.get(personKey(sheetName)) ?? []).map((m) => [m.id, m])).values()];
    if (matches.length !== 1 || usedPeople.has(matches[0].id)) {
      const suggestion = matches.length === 0 ? closest(sheetName, people.map((p) => ({ id: p.id, label: [p.first, p.middle, p.last].filter(Boolean).join(" ") }))) : null;
      for (const p of readable) {
        if (matches.length === 0) decide(p.key, "person", suggestion, "No active person in ELEVATE has this name.");
        else if (matches.length > 1) decide(p.key, "person", null, "More than one person in ELEVATE has this name.");
        else decide(p.key, "other", null, "The same person matched two different names on the sheet.");
      }
      continue;
    }
    const person = matches[0];

    const segments: Segment[] = [];
    for (const p of readable) {
      const rememberedClient = live.aliases?.clients[clientKey(p.sheetClient)];
      const found = rememberedClient && live.clients.some((c) => c.id === rememberedClient) ? live.clients.filter((c) => c.id === rememberedClient) : (byClient.get(clientKey(p.sheetClient)) ?? []);
      if (found.length !== 1) {
        decide(p.key, "client", found.length === 0 ? closest(p.sheetClient, live.clients.map((c) => ({ id: c.id, label: c.name }))) : null,
          found.length === 0 ? "The client is not in ELEVATE under this name." : "More than one client in ELEVATE has this name.");
        unresolved += 1;
        continue;
      }
      const dates = p.obs.map((o) => o.date ?? options.today).sort();
      const breakMinutes = suggestedBreak(p.parsed.startTime, p.parsed.endTime);
      segments.push({
        key: p.key, sheetClient: p.sheetClient, text: p.text, parsed: p.parsed, clientId: found[0].id, clientName: found[0].name,
        firstDay: dates[0], lastDay: dates[dates.length - 1], daysSeen: p.obs.length, breakMinutes,
        hours: hoursPerWeek(p.parsed.startTime, p.parsed.endTime, breakMinutes, p.parsed.weekdays.length), attention: p.attention,
      });
    }
    if (segments.length === 0) continue;
    // Two sheet spellings of the same client collapse onto one assignment: keep the first, the other needs a person.
    const seenClients = new Set<string>();
    for (const s of [...segments]) {
      if (seenClients.has(s.clientId)) {
        decide(s.key, "other", null, "Two names on the sheet point at the same client for this person.");
        segments.splice(segments.indexOf(s), 1);
        unresolved += 1;
      } else seenClients.add(s.clientId);
    }
    usedPeople.add(person.id);

    // The group: one shift for the person, and the person's total hours on each client.
    const multi = segments.length > 1;
    const groupNote = unresolved > 0 ? "This person is also listed under a client that still needs a match, so the shift and hours are not final." : null;
    const combined = combineSegments(segments);
    const shift = "error" in combined ? null : combined;
    const total = round1(segments.reduce((n, s) => n + s.hours, 0));
    const useCombined = shift !== null && groupNote === null;
    const groupAttention: string[] = [];
    if (groupNote) groupAttention.push(groupNote);
    if (multi && shift === null) groupAttention.push(`This person works ${segments.length} clients, but ${(combined as { error: string }).error}: the schedule is not set by this import. Set the shift on the person's Schedules page; the client assignments are proposed below.`);
    if (multi && useCombined) groupAttention.push(`Works ${segments.length} clients in one shift (${segments.map((s) => `${s.clientName}: ${s.text}`).join("; ")}). The unpaid break is the gap between them. The hours per week are the person's total on each client.`);

    const open = live.assignments.filter((a) => a.employeeId === person.id && a.endDate === null);
    const openSchedule = live.schedules.find((s) => s.employeeId === person.id && s.effectiveTo === null) ?? null;
    const groupClientIds = new Set(segments.map((s) => s.clientId));
    const others = open.filter((a) => !groupClientIds.has(a.clientId));
    const scheduleAction: ScheduleAction = !useCombined
      ? "unset"
      : !openSchedule ? "add"
      : same({ startTime: openSchedule.startTime, endTime: openSchedule.endTime, zone: openSchedule.zone, weekdays: openSchedule.weekdays, breakMinutes: openSchedule.breakMinutes }, shift) ? "same" : "change";
    const earliest = [...segments].sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.clientName.localeCompare(b.clientName))[0];
    const ownerKey = earliest.key;
    const groupFirstDay = earliest.firstDay;

    for (const seg of segments) {
      const sameClient = open.find((a) => a.clientId === seg.clientId) ?? null;
      const assignment: AssignmentAction = sameClient ? "keep" : others.length > 0 ? "change_client" : "add";
      const hours = multi && groupNote === null ? total : seg.hours;
      const hoursNote = sameClient ? (sameClient.hoursPerWeek === null ? "fill" : sameClient.hoursPerWeek !== hours ? "differs" : null) : null;
      const schedule: ScheduleAction = scheduleAction === "add" || scheduleAction === "change" ? (seg.key === ownerKey ? scheduleAction : "shared") : scheduleAction;
      const attention = [...seg.attention];
      if (seg.key === ownerKey) attention.push(...groupAttention);
      else if (groupAttention.length > 0) attention.push("See this person's other row for the shift and hours.");
      if (!multi && others.length + (sameClient ? 1 : 0) > 1) attention.push("This person has more than one current assignment.");
      if (multi && others.length > 1) attention.push("This person has other current assignments that this import would end.");
      if (openSchedule && useCombined && openSchedule.effectiveFrom > groupFirstDay && seg.key === ownerKey) attention.push(`The current schedule starts ${openSchedule.effectiveFrom}, later than the first day on the sheet.`);
      const show: Shift = useCombined ? shift : { startTime: seg.parsed.startTime, endTime: seg.parsed.endTime, zone: seg.parsed.zone, weekdays: seg.parsed.weekdays, breakMinutes: seg.breakMinutes };
      const firstDay = seg.key === ownerKey ? groupFirstDay : seg.firstDay;
      const status = assignment === "keep" && ["same", "shared", "unset"].includes(schedule) && hoursNote !== "fill" ? "unchanged" : "update";
      const siblings = segments.filter((s) => s.key !== seg.key);
      rows.push({
        key: seg.key, sheetName, sheetClient: seg.sheetClient, personId: person.id, personName: [person.first, person.last].filter(Boolean).join(" "), workEmail: person.workEmail,
        clientId: seg.clientId, clientName: seg.clientName, siblingClientIds: siblings.map((s) => s.clientId), siblingClientNames: siblings.map((s) => s.clientName),
        scheduleText: seg.text, startTime: show.startTime, endTime: show.endTime, zone: show.zone, weekdays: show.weekdays, weekdayLabel: dayNames(show.weekdays),
        breakMinutes: show.breakMinutes, hoursPerWeek: hours, firstDay, lastDay: seg.lastDay, daysSeen: seg.daysSeen,
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
