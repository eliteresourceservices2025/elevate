import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { downlineEmployeeIds, managerChainUserIds, reportName } from "@/modules/org/service";
import { teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { MAX_OPEN_SESSION_MS, buildDays, replayClock, type ClockState, type DayTotals } from "./clock";
import { clockRules } from "./schema";
import { loadEventsBetween, loadRecentEvents, monitoringPolicyPublished, prefsFor, rulesFor } from "./service";

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
  /** The server's clock, so the browser counts from the server's time and not its own. */
  serverNowMs: number;
  idleMinutes: number | null;
  needsSelfie: boolean;
  locationOn: boolean;
  zone: string;
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
    serverNowMs: Date.now(),
    idleMinutes: rules.idleMinutes,
    needsSelfie: rules.selfieRequired && monitoring,
    locationOn: prefs.shareLocation && monitoring,
    zone: prefs.zone,
  };
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
};

export type MyTime = {
  zone: string;
  weekStart: string;
  days: { date: string; weekday: string; workedMinutes: number; breakMinutes: number; sessions: number; firstIn: number | null; lastOut: number | null; open: boolean }[];
  weekMinutes: number;
  prefs: { shareLocation: boolean; timeZone: string | null };
  monitoringPublished: boolean;
  corrections: CorrectionItem[];
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
  const byDate = new Map(buildDays(await loadEventsBetween(db, me.id, from, to), prefs.zone).map((d) => [d.date, d]));
  const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const d = byDate.get(date);
    return { date, weekday: WEEKDAY.format(new Date(`${date}T00:00:00Z`)), workedMinutes: d?.workedMinutes ?? 0, breakMinutes: d?.breakMinutes ?? 0, sessions: d?.sessions ?? 0, firstIn: d?.firstIn ?? null, lastOut: d?.lastOut ?? null, open: d?.open ?? false };
  });

  const rows = (await db.execute(sql`
    select c.id, c.employee_id, c.reason, c.proposed, c.status, c.decision_note, c.created_at
    from time.clock_corrections c where c.employee_id = ${me.id} order by c.created_at desc limit 20`)) as unknown as Row[];
  return {
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
    })),
  };
}

export type WorkingNowRow = { employeeId: string; name: string; team: string | null; state: "working" | "break"; sinceMs: number; outsideRange: boolean; longOpen: boolean };

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
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type FlagRow = { employeeId: string; name: string; date: string; flags: string[]; workedMinutes: number };

/** Days with something worth a look in the last two weeks, from the nightly rebuild. */
export async function listFlags(): Promise<{ rows: FlagRow[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "attendance.view");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.view");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { rows: [], scope };
  const filter = restrict ? sql`and d.employee_id in (${list(restrict)})` : sql``;
  const rows = (await db.execute(sql`
    select d.employee_id, d.date::text as date, d.flags, d.worked_minutes, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.attendance_days d join core.employees e on e.id = d.employee_id
    where d.date >= current_date - 14 and cardinality(d.flags) > 0 ${filter}
    order by d.date desc, e.legal_last_name limit 300`)) as unknown as { employee_id: string; date: string; flags: string[]; worked_minutes: number; first: string; last: string; preferred: string | null }[];
  return { scope, rows: rows.map((r) => ({ employeeId: r.employee_id, name: reportName({ first: r.first, last: r.last, preferred: r.preferred }), date: r.date, flags: r.flags, workedMinutes: r.worked_minutes })) };
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
    select c.id, c.employee_id, c.reason, c.proposed, c.status, c.decision_note, c.created_at, c.requested_by,
           e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.clock_corrections c join core.employees e on e.id = c.employee_id
    where c.status = 'pending' ${filter} order by c.created_at limit 100`)) as unknown as Row[];

  const items: CorrectionItem[] = [];
  for (const r of rows) {
    const own = r.user_id === user.id || r.requested_by === user.id;
    // A lead decides for people below them; HR may decide for anyone.
    const allowed = scope === "all" || (await managerChainUserIds(db, String(r.employee_id))).includes(user.id);
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
    });
  }
  return { items, scope };
}

export type RulesRow = { teamId: string; teamName: string; allowedCidrs: string[]; selfieRequired: boolean; idleMinutes: number | null; graceMinutes: number; hasRow: boolean };

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
      return { teamId: t.id, teamName: t.name, allowedCidrs: r?.allowedCidrs ?? [], selfieRequired: r?.selfieRequired ?? false, idleMinutes: r ? r.idleMinutes : 30, graceMinutes: r?.graceMinutes ?? 60, hasRow: Boolean(r) };
    }),
  };
}
