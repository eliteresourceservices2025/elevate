import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { holidaysInRange } from "@/modules/timeoff/request-service";
import { downlineEmployeeIds, managerChainUserIds, reportName, todayInZone } from "@/modules/org/service";
import { teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { EOD_EDIT_WINDOW_MS, MAX_OPEN_SESSION_MS, buildDays, isPossiblyOffline, needsHrDecision, replayClock, type ClockState, type DayTotals, type SessionDetail } from "./clock";
import { describeSchedule, extraMinutes, hasScheduleAround, scheduleFor, shiftOn, shiftRange } from "./schedule";
import { clockRules } from "./schema";
import { loadSchedules, loadSchedulesFor } from "./schedule-service";
import { loadEventsBetween, loadRecentEvents, monitoringPolicyPublished, pendingClockOut, prefsFor, rulesFor } from "./service";

// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

type Row = Record<string, unknown>;
const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
const DAY_MS = 86_400_000;

async function myEmployee(userId: string) {
  const [e] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).limit(1);
  return e ?? null;
}

export type ClockStatus = {
  state: ClockState;
  /** When the current session started (ms), if there is one. */
  sessionStartMs: number | null;
  /** Break time already finished in this session (ms), and when an open break started. */
  breakDoneMs: number;
  breakStartMs: number | null;
  /** The length chosen for the break in progress (15, 30 or 60), or null for no limit. */
  breakPlannedMinutes: number | null;
  /** The server's clock, so the browser counts from the server's time and not its own. */
  serverNowMs: number;
  idleMinutes: number | null;
  needsSelfie: boolean;
  locationOn: boolean;
  zone: string;
  /** A waiting "I stopped at ..." request: the clock-out time asked for. Other clock actions wait until it is decided or cancelled. */
  pendingClockOut: { id: string; atMs: number } | null;
};

/** The signed-in person's clock: what the header widget shows. Null when they have no people record. */
export async function getClockStatus(): Promise<ClockStatus | null> {
  const user = await requireUser();
  await authorize(user, "attendance.clock", { ownerUserId: user.id });
  const me = await myEmployee(user.id);
  if (!me) return null;

  const replay = replayClock(await loadRecentEvents(db, me.id));
  const open = replay.sessions[replay.sessions.length - 1];
  const live = replay.state !== "out" && open && open.endAt === null ? open : null;
  const rules = await rulesFor(db, me.id);
  const prefs = await prefsFor(db, me.id);
  const monitoring = await monitoringPolicyPublished(db);
  const openBreak = live?.breaks.find((b) => b.endAt === null) ?? null;
  return {
    state: replay.state,
    sessionStartMs: live?.startAt ?? null,
    breakDoneMs: live ? live.breaks.filter((b) => b.endAt !== null).reduce((sum, b) => sum + (b.endAt! - b.startAt), 0) : 0,
    breakStartMs: openBreak?.startAt ?? null,
    breakPlannedMinutes: openBreak?.plannedMinutes ?? null,
    serverNowMs: Date.now(),
    idleMinutes: rules.idleMinutes,
    needsSelfie: rules.selfieRequired && monitoring,
    locationOn: prefs.shareLocation && monitoring,
    zone: prefs.zone,
    pendingClockOut: replay.state === "out" ? null : await pendingClockOut(db, me.id),
  };
}

export type EvidenceItem = { id: string; mime: string; purged: boolean };

/** The screenshots attached to each of these claims. */
async function evidenceFor(ids: string[]): Promise<Map<string, EvidenceItem[]>> {
  const out = new Map<string, EvidenceItem[]>();
  if (ids.length === 0) return out;
  const rows = (await db.execute(sql`select id, correction_id, mime, purged_at from time.correction_evidence where correction_id in (${list(ids)}) order by created_at`)) as unknown as { id: string; correction_id: string; mime: string; purged_at: Date | null }[];
  for (const r of rows) out.set(r.correction_id, [...(out.get(r.correction_id) ?? []), { id: r.id, mime: r.mime, purged: r.purged_at !== null }]);
  return out;
}

export type WeekDay = DayTotals & { weekday: string };
export type CorrectionItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  reason: string;
  proposed: { type: string; at: string }[];
  status: string;
  decisionNote: string | null;
  createdAt: string;
  canDecide: boolean;
  /** forgot, connection_problem, device_problem or other. */
  kind: string;
  evidence: EvidenceItem[];
  /** The name of the lead or HR person who filed it for them, or null when the person filed it themselves. */
  filedBy: string | null;
  /** What the person first asked for, when the reviewer changed the times. */
  originalProposed: { type: string; at: string }[] | null;
  /** Only HR can decide it: filed for the person, or older than a week when filed. */
  hrOnly: boolean;
};

export type MyTime = {
  zone: string;
  weekStart: string;
  days: { date: string; weekday: string; workedMinutes: number; breakMinutes: number; overbreakMinutes: number; sessions: number; firstIn: number | null; lastOut: number | null; open: boolean; sessionList: SessionDetail[]; scheduledMinutes: number | null; extraMinutes: number; shift: { range: string; clientRange: string; zone: string } | null; holiday: boolean }[];
  /** The person's schedule in force this week, described in the client's zone and Manila; null when they have none. */
  schedule: { days: string; client: string; manila: string; zone: string; effectiveFrom: string } | null;
  weekMinutes: number;
  prefs: { shareLocation: boolean; timeZone: string | null };
  monitoringPublished: boolean;
  corrections: CorrectionItem[];
  /** End-of-day notes by the clock-in event of the session they belong to. */
  notes: Record<string, { body: string; edited: boolean }>;
  serverNowMs: number;
  noteWindowMs: number;
};

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Monday of the week containing a date. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/** The signed-in person's week, computed straight from their clock events (so it is current, not yesterday's). */
export async function getMyTime(weekStartInput?: string): Promise<MyTime | null> {
  const user = await requireUser();
  await authorize(user, "attendance.view", { ownerUserId: user.id });
  const me = await myEmployee(user.id);
  if (!me) return null;
  const prefs = await prefsFor(db, me.id);
  const today = formatInZone(Date.now(), prefs.zone, "yyyy-MM-dd");
  const weekStart = mondayOf(weekStartInput && /^\d{4}-\d{2}-\d{2}$/.test(weekStartInput) ? weekStartInput : today);

  // A day boundary in the person's zone can sit a day either side of UTC, so look a day wide.
  const from = Date.parse(`${addDays(weekStart, -1)}T00:00:00Z`);
  const to = Date.parse(`${addDays(weekStart, 8)}T00:00:00Z`);
  const byDate = new Map(buildDays(await loadEventsBetween(db, me.id, from, to), prefs.zone, Date.now()).map((d) => [d.date, d]));
  const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
  const schedules = await loadSchedules(db, me.id);
  const holidays = new Set((await holidaysInRange(db, me.id, weekStart, addDays(weekStart, 6))).map((h) => h.date));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const d = byDate.get(date);
    const shift = shiftOn(schedules, prefs.zone, date);
    const worked = d?.workedMinutes ?? 0;
    const holiday = holidays.has(date);
    return {
      date,
      weekday: WEEKDAY.format(new Date(`${date}T00:00:00Z`)),
      workedMinutes: worked,
      breakMinutes: d?.breakMinutes ?? 0,
      overbreakMinutes: d?.overbreakMinutes ?? 0,
      sessions: d?.sessions ?? 0,
      firstIn: d?.firstIn ?? null,
      lastOut: d?.lastOut ?? null,
      open: d?.open ?? false,
      sessionList: d?.sessionList ?? [],
      scheduledMinutes: shift?.scheduledMinutes ?? null,
      extraMinutes: extraMinutes({ workedMinutes: worked, shift, hasSchedule: hasScheduleAround(schedules, date), holiday }),
      shift: shift ? { range: shiftRange(shift, prefs.zone), clientRange: shiftRange(shift, shift.schedule.zone), zone: shift.schedule.zone } : null,
      holiday,
    };
  });
  const current = scheduleFor(schedules, weekStart) ?? scheduleFor(schedules, addDays(weekStart, 6));

  const rows = (await db.execute(sql`
    select c.id, c.employee_id, c.reason, c.proposed, c.status, c.decision_note, c.created_at, c.kind, c.original_proposed, c.requested_by,
           (select e2.legal_first_name || ' ' || e2.legal_last_name from core.employees e2 where e2.user_id = c.requested_by and c.requested_by <> ${user.id}) as filed_by
    from time.clock_corrections c where c.employee_id = ${me.id} order by c.created_at desc limit 20`)) as unknown as Row[];
  const evidence = await evidenceFor(rows.map((r) => String(r.id)));
  const sessionIds = days.flatMap((d) => d.sessionList.map((s) => s.eventId).filter((id): id is string => Boolean(id)));
  const noteRows = sessionIds.length === 0 ? [] : ((await db.execute(sql`select session_event_id, body, edited from time.shift_notes where employee_id = ${me.id} and session_event_id in (${list(sessionIds)})`)) as unknown as { session_event_id: string; body: string; edited: boolean }[]);
  return {
    schedule: current ? { ...describeSchedule(current, weekStart), effectiveFrom: current.effectiveFrom } : null,
    notes: Object.fromEntries(noteRows.map((n) => [n.session_event_id, { body: n.body, edited: n.edited }])),
    serverNowMs: Date.now(),
    noteWindowMs: EOD_EDIT_WINDOW_MS,
    zone: prefs.zone,
    weekStart,
    days,
    weekMinutes: days.reduce((sum, d) => sum + d.workedMinutes, 0),
    prefs: { shareLocation: prefs.shareLocation, timeZone: prefs.timeZone },
    monitoringPublished: await monitoringPolicyPublished(db),
    corrections: rows.map((r) => ({
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeName: "You",
      reason: String(r.reason),
      proposed: r.proposed as { type: string; at: string }[],
      status: String(r.status),
      decisionNote: (r.decision_note as string | null) ?? null,
      createdAt: new Date(r.created_at as string | Date).toISOString(),
      canDecide: false,
      kind: String(r.kind),
      evidence: evidence.get(String(r.id)) ?? [],
      filedBy: (r.filed_by as string | null) ?? null,
      originalProposed: (r.original_proposed as { type: string; at: string }[] | null) ?? null,
      hrOnly: false,
    })),
  };
}

export type WorkingNowRow = { employeeId: string; name: string; team: string | null; state: "working" | "break"; sinceMs: number; outsideRange: boolean; longOpen: boolean; lastSeenMs: number | null; possiblyOffline: boolean };

/** Who is clocked in right now. HR sees everyone; a Team Lead their downline. */
export async function listWorkingNow(): Promise<{ rows: WorkingNowRow[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "attendance.view");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.view");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { rows: [], scope };
  const filter = restrict ? sql`and e.employee_id in (${list(restrict)})` : sql``;

  const rows = (await db.execute(sql`
    select * from (
      select distinct on (e.employee_id) e.employee_id, e.type, (extract(epoch from e.occurred_at) * 1000)::float8 as at, e.outside_allowed_range
      from time.clock_events e
      where e.occurred_at > now() - interval '48 hours' ${filter}
      order by e.employee_id, e.occurred_at desc, e.created_at desc
    ) last
    where last.type <> 'clock_out'`)) as unknown as { employee_id: string; type: string; at: number; outside_allowed_range: boolean }[];
  if (rows.length === 0) return { rows: [], scope };

  const people = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, t.name as team
    from core.employees e left join core.teams t on t.id = e.team_id where e.id in (${list(rows.map((r) => r.employee_id))})`)) as unknown as { id: string; first: string; last: string; preferred: string | null; team: string | null }[];
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = (await db.execute(sql`select employee_id, (extract(epoch from last_seen_at) * 1000)::float8 as ms from time.clock_presence where employee_id in (${list(rows.map((r) => r.employee_id))})`)) as unknown as { employee_id: string; ms: number }[];
  const seenBy = new Map(seen.map((s) => [s.employee_id, Number(s.ms)]));
  const now = Date.now();
  return {
    scope,
    rows: rows
      .map((r) => {
        const p = byId.get(r.employee_id)!;
        return {
          employeeId: r.employee_id,
          name: reportName({ first: p.first, last: p.last, preferred: p.preferred }),
          team: p.team,
          state: (r.type === "break_start" ? "break" : "working") as "working" | "break",
          sinceMs: Number(r.at),
          outsideRange: r.outside_allowed_range,
          longOpen: now - Number(r.at) > MAX_OPEN_SESSION_MS,
          lastSeenMs: seenBy.get(r.employee_id) ?? null,
          // Only someone actually working can be "possibly offline"; people on a break often close the page.
          possiblyOffline: r.type !== "break_start" && isPossiblyOffline(seenBy.get(r.employee_id) ?? null, Number(r.at), now),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type FlagRow = { employeeId: string; name: string; date: string; flags: string[]; workedMinutes: number; overbreakMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; extraMinutes: number };

/** Days with something worth a look in the last two weeks, from the nightly rebuild. */
export async function listFlags(): Promise<{ rows: FlagRow[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "attendance.view");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.view");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { rows: [], scope };
  const filter = restrict ? sql`and d.employee_id in (${list(restrict)})` : sql``;
  const rows = (await db.execute(sql`
    select d.employee_id, d.date::text as date, d.flags, d.worked_minutes, d.overbreak_minutes, d.late_minutes, d.early_leave_minutes, d.extra_minutes, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.attendance_days d join core.employees e on e.id = d.employee_id
    where d.date >= current_date - 14 and cardinality(d.flags) > 0 ${filter}
    order by d.date desc, e.legal_last_name limit 300`)) as unknown as { employee_id: string; date: string; flags: string[]; worked_minutes: number; overbreak_minutes: number; late_minutes: number; early_leave_minutes: number; extra_minutes: number; first: string; last: string; preferred: string | null }[];
  return { scope, rows: rows.map((r) => ({ employeeId: r.employee_id, name: reportName({ first: r.first, last: r.last, preferred: r.preferred }), date: r.date, flags: r.flags, workedMinutes: r.worked_minutes, overbreakMinutes: r.overbreak_minutes, lateMinutes: r.late_minutes, earlyLeaveMinutes: r.early_leave_minutes, extraMinutes: r.extra_minutes })) };
}

/** Corrections waiting for the signed-in person to decide: their downline's (lead) or everyone's (HR). */
export async function listCorrectionQueue(): Promise<{ items: CorrectionItem[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "attendance.approve_correction");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.approve_correction");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { items: [], scope };
  const filter = restrict ? sql`and c.employee_id in (${list(restrict)})` : sql``;
  const rows = (await db.execute(sql`
    select c.id, c.employee_id, c.reason, c.proposed, c.status, c.decision_note, c.created_at, c.requested_by, c.kind, c.original_proposed,
           (select e2.legal_first_name || ' ' || e2.legal_last_name from core.employees e2 where e2.user_id = c.requested_by and c.requested_by is distinct from e.user_id limit 1) as filed_by,
           e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.clock_corrections c join core.employees e on e.id = c.employee_id
    where c.status = 'pending' ${filter} order by c.created_at limit 100`)) as unknown as Row[];

  const evidence = await evidenceFor(rows.map((r) => String(r.id)));
  const items: CorrectionItem[] = [];
  for (const r of rows) {
    const own = r.user_id === user.id || r.requested_by === user.id;
    // A lead decides for people below them; HR may decide for anyone. Filed-for-them and older-than-a-week ones are HR only.
    const proposed = r.proposed as { type: string; at: string }[];
    const filedFor = r.requested_by !== r.user_id;
    const hrOnly = filedFor || needsHrDecision(Math.min(...proposed.map((p) => Date.parse(p.at))), new Date(r.created_at as string | Date).getTime());
    const allowed = scope === "all" || (!hrOnly && (await managerChainUserIds(db, String(r.employee_id))).includes(user.id));
    items.push({
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeName: reportName({ first: String(r.first), last: String(r.last), preferred: (r.preferred as string | null) ?? null }),
      reason: String(r.reason),
      proposed: r.proposed as { type: string; at: string }[],
      status: String(r.status),
      decisionNote: null,
      createdAt: new Date(r.created_at as string | Date).toISOString(),
      canDecide: !own && allowed,
      kind: String(r.kind),
      evidence: evidence.get(String(r.id)) ?? [],
      filedBy: (r.filed_by as string | null) ?? null,
      originalProposed: (r.original_proposed as { type: string; at: string }[] | null) ?? null,
      hrOnly,
    });
  }
  return { items, scope };
}

export type RulesRow = { teamId: string; teamName: string; allowedCidrs: string[]; selfieRequired: boolean; idleMinutes: number | null; graceMinutes: number; eodExpected: boolean; jibbleMirror: boolean; lateGraceMinutes: number; hasRow: boolean };

/** Every team with its clock rules (defaults for teams without a row). HR only. */
export async function listClockRules(): Promise<{ rows: RulesRow[]; monitoringPublished: boolean }> {
  const user = await requireUser();
  await authorize(user, "attendance.manage_rules");
  const all = await db.select({ id: teams.id, name: teams.name }).from(teams).where(sql`${teams.archivedAt} is null`).orderBy(asc(teams.name));
  const rules = await db.select().from(clockRules);
  const byTeam = new Map(rules.map((r) => [r.teamId, r]));
  return {
    monitoringPublished: await monitoringPolicyPublished(db),
    rows: all.map((t) => {
      const r = byTeam.get(t.id);
      return { teamId: t.id, teamName: t.name, allowedCidrs: r?.allowedCidrs ?? [], selfieRequired: r?.selfieRequired ?? false, idleMinutes: r ? r.idleMinutes : 30, graceMinutes: r?.graceMinutes ?? 60, eodExpected: r?.eodExpected ?? false, jibbleMirror: r?.jibbleMirror ?? false, lateGraceMinutes: r?.lateGraceMinutes ?? 10, hasRow: Boolean(r) };
    }),
  };
}

export type FilablePerson = { id: string; name: string };

/** Who the signed-in lead (their downline) or HR (everyone active) can file a correction for. */
export async function listFilablePeople(): Promise<FilablePerson[]> {
  const user = await requireUser();
  const scope = scopeFor(user, "attendance.file_for_others");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.file_for_others");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return [];
  const filter = restrict ? sql`and e.id in (${list(restrict)})` : sql``;
  const rows = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred from core.employees e
    where e.archived_at is null and e.status <> 'separated' and e.user_id is distinct from ${user.id} ${filter}
    order by e.legal_last_name, e.legal_first_name limit 500`)) as unknown as { id: string; first: string; last: string; preferred: string | null }[];
  return rows.map((r) => ({ id: r.id, name: reportName({ first: r.first, last: r.last, preferred: r.preferred }) }));
}

export type NoteRow = { id: string; employeeId: string; name: string; sessionStartMs: number; body: string; edited: boolean; updatedAt: string };

/** End-of-day notes of the last 7 days: HR sees everyone, a Team Lead their downline. */
export async function listShiftNotes(): Promise<{ rows: NoteRow[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "attendance.notes_view");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.notes_view");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { rows: [], scope };
  const filter = restrict ? sql`and n.employee_id in (${list(restrict)})` : sql``;
  const rows = (await db.execute(sql`
    select n.id, n.employee_id, n.body, n.edited, n.updated_at, (extract(epoch from ev.occurred_at) * 1000)::float8 as start_ms,
           e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.shift_notes n
    join time.clock_events ev on ev.id = n.session_event_id
    join core.employees e on e.id = n.employee_id
    where ev.occurred_at > now() - interval '7 days' ${filter}
    order by ev.occurred_at desc limit 200`)) as unknown as { id: string; employee_id: string; body: string; edited: boolean; updated_at: string | Date; start_ms: number; first: string; last: string; preferred: string | null }[];
  return {
    scope,
    rows: rows.map((r) => ({ id: r.id, employeeId: r.employee_id, name: reportName({ first: r.first, last: r.last, preferred: r.preferred }), sessionStartMs: Number(r.start_ms), body: r.body, edited: r.edited, updatedAt: new Date(r.updated_at).toISOString() })),
  };
}

export type ScheduleListRow = {
  employeeId: string;
  name: string;
  team: string | null;
  zone: string | null;
  current: { days: string; client: string; manila: string; effectiveFrom: string; breakMinutes: number } | null;
  /** A schedule that starts later, when one is already set. */
  upcoming: { effectiveFrom: string; days: string; client: string } | null;
};

/** Everyone active with their current schedule (or none). HR only. */
export async function listSchedules(): Promise<{ rows: ScheduleListRow[]; withoutSchedule: number }> {
  const user = await requireUser();
  await authorize(user, "schedules.manage");
  const people = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, t.name as team
    from core.employees e left join core.teams t on t.id = e.team_id
    where e.archived_at is null and e.status <> 'separated' order by e.legal_last_name, e.legal_first_name limit 1000`)) as unknown as { id: string; first: string; last: string; preferred: string | null; team: string | null }[];
  const byPerson = await loadSchedulesFor(db, people.map((p) => p.id));
  const today = todayInZone();
  const rows = people.map((p) => {
    const list = byPerson.get(p.id) ?? [];
    const now = scheduleFor(list, today);
    const later = list.find((s) => s.effectiveFrom > today);
    return {
      employeeId: p.id,
      name: reportName({ first: p.first, last: p.last, preferred: p.preferred }),
      team: p.team,
      zone: now?.zone ?? later?.zone ?? null,
      current: now ? { ...pickDescription(now, today), effectiveFrom: now.effectiveFrom, breakMinutes: now.breakMinutes } : null,
      upcoming: later ? { effectiveFrom: later.effectiveFrom, days: describeSchedule(later, later.effectiveFrom).days, client: describeSchedule(later, later.effectiveFrom).client } : null,
    };
  });
  return { rows, withoutSchedule: rows.filter((r) => !r.current).length };
}

const pickDescription = (s: Parameters<typeof describeSchedule>[0], date: string) => {
  const d = describeSchedule(s, date);
  return { days: d.days, client: `${d.client} (${d.zone})`, manila: d.manila };
};

