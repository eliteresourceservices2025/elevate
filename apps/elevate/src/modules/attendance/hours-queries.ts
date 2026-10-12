import "server-only";
import { eq, sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatInZone, resolveTimeZone } from "@/lib/time";
import { downlineEmployeeIds, reportName, todayInZone } from "@/modules/org/service";
import { approvalKey, attendanceRows, dayState, latestApprovals, testMarks, zonesFor, type DayState } from "./hours-service";
import { addDays, mondayOf, recentPeriods, type PayPeriod, type PayPeriodKind } from "./pay-periods";
import { hoursSettings } from "./schema";

// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

export type ReviewDay = {
  date: string;
  weekday: string;
  scheduledMinutes: number | null;
  workedMinutes: number;
  extraMinutes: number;
  approvedExtraMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  flags: string[];
  firstIn: number | null;
  lastOut: number | null;
  state: DayState;
  /** The day is over in the person's own zone, so it can be approved. */
  finished: boolean;
};

export type ReviewRow = {
  employeeId: string;
  name: string;
  team: string | null;
  zone: string;
  days: ReviewDay[];
  scheduledMinutes: number;
  workedMinutes: number;
  extraMinutes: number;
  approvedExtraMinutes: number;
  lateDays: number;
  absentDays: number;
  flags: string[];
  /** approved = every finished day approved and unchanged; partly; changed = something was corrected after approval; none; empty = nothing to approve. */
  state: "approved" | "partly" | "changed" | "none" | "empty";
  /** The signed-in person may approve this week now. */
  canApprove: boolean;
};

/** A day someone marked "test only": it is not in the list above, and can be taken off again. */
export type TestDay = { employeeId: string; name: string; date: string; weekday: string; note: string; markedBy: string; markedOn: string };

export type TeamReview = { weekStart: string; weekEnd: string; rows: ReviewRow[]; scope: "all" | "team"; pending: number; /** The signed-in person may mark days as test only (and take the mark off). */ canMarkTest: boolean; testDays: TestDay[] };

/** One week of every person the signed-in lead (their team) or HR (everyone) reviews, with approval state. Defaults to last week. */
export async function getTeamReview(weekStartInput?: string): Promise<TeamReview> {
  const user = await requireUser();
  const scope = scopeFor(user, "hours.approve");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("hours.approve");
  const requested = weekStartInput && /^\d{4}-\d{2}-\d{2}$/.test(weekStartInput) ? weekStartInput : addDays(todayInZone(), -7);
  const weekStart = mondayOf(requested);
  const weekEnd = addDays(weekStart, 6);

  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  const days = (await attendanceRows(db, restrict, weekStart, weekEnd)).filter((r) => r.sessions > 0 || r.scheduledMinutes !== null);
  const ids = [...new Set(days.map((d) => d.employeeId))];
  const canMarkTest = ["all", "team"].includes(scopeFor(user, "hours.mark_test") ?? "");
  const testDays = await testDaysOf(restrict, weekStart, weekEnd);
  if (ids.length === 0) return { weekStart, weekEnd, rows: [], scope, pending: 0, canMarkTest, testDays };

  const approvals = await latestApprovals(db, ids, weekStart, weekEnd);
  const zones = await zonesFor(db, ids);
  const people = (await db.execute(sql`
    select e.id, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, t.name as team
    from core.employees e left join core.teams t on t.id = e.team_id where e.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)) as unknown as { id: string; user_id: string | null; first: string; last: string; preferred: string | null; team: string | null }[];
  const byId = new Map(people.map((p) => [p.id, p]));
  const now = Date.now();

  const rows: ReviewRow[] = ids
    .map((id) => {
      const p = byId.get(id)!;
      const zone = resolveTimeZone(zones.get(id));
      const today = formatInZone(now, zone, "yyyy-MM-dd");
      const mine = days.filter((d) => d.employeeId === id).sort((a, b) => a.date.localeCompare(b.date));
      const reviewDays: ReviewDay[] = mine.map((d) => ({
        date: d.date,
        weekday: WEEKDAY.format(new Date(`${d.date}T00:00:00Z`)),
        scheduledMinutes: d.scheduledMinutes,
        workedMinutes: d.workedMinutes,
        extraMinutes: d.extraMinutes,
        approvedExtraMinutes: d.approvedExtraMinutes,
        lateMinutes: d.lateMinutes,
        earlyLeaveMinutes: d.earlyLeaveMinutes,
        flags: d.flags,
        firstIn: d.firstIn?.getTime() ?? null,
        lastOut: d.lastOut?.getTime() ?? null,
        state: dayState(d, approvals.get(approvalKey(id, d.date))),
        finished: d.date < today,
      }));
      const finished = reviewDays.filter((d) => d.finished);
      const approved = finished.filter((d) => d.state === "approved").length;
      const state: ReviewRow["state"] = finished.length === 0 ? "empty" : finished.some((d) => d.state === "changed") ? "changed" : approved === finished.length ? "approved" : approved > 0 ? "partly" : "none";
      return {
        employeeId: id,
        name: reportName({ first: p.first, last: p.last, preferred: p.preferred }),
        team: p.team,
        zone,
        days: reviewDays,
        scheduledMinutes: reviewDays.reduce((n, d) => n + (d.scheduledMinutes ?? 0), 0),
        workedMinutes: reviewDays.reduce((n, d) => n + d.workedMinutes, 0),
        extraMinutes: reviewDays.reduce((n, d) => n + d.extraMinutes, 0),
        approvedExtraMinutes: reviewDays.reduce((n, d) => n + d.approvedExtraMinutes, 0),
        lateDays: reviewDays.filter((d) => d.lateMinutes > 0).length,
        absentDays: reviewDays.filter((d) => d.flags.includes("absent")).length,
        flags: [...new Set(reviewDays.flatMap((d) => d.flags))],
        state,
        canApprove: p.user_id !== user.id && (state === "none" || state === "partly" || state === "changed"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { weekStart, weekEnd, rows, scope, pending: rows.filter((r) => r.canApprove).length, canMarkTest, testDays };
}

/** The days marked test only in a week, with who marked them and why (names, not ids). */
async function testDaysOf(restrict: string[] | null, from: string, to: string): Promise<TestDay[]> {
  const marks = await testMarks(db, restrict, from, to);
  if (marks.length === 0) return [];
  const people = (await db.execute(sql`select id, legal_first_name as first, legal_last_name as last, preferred_name as preferred from core.employees where id in (${sql.join([...new Set(marks.map((m) => m.employeeId))].map((id) => sql`${id}`), sql`, `)})`)) as unknown as { id: string; first: string; last: string; preferred: string | null }[];
  const nameOf = new Map(people.map((p) => [p.id, reportName({ first: p.first, last: p.last, preferred: p.preferred })]));
  const by = (await db.execute(sql`select u.id, u.email, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred from core.users u left join core.employees e on e.user_id = u.id where u.id in (${sql.join([...new Set(marks.map((m) => m.setBy))].map((id) => sql`${id}`), sql`, `)})`)) as unknown as { id: string; email: string; first: string | null; last: string | null; preferred: string | null }[];
  const byName = new Map(by.map((r) => [r.id, r.first && r.last ? reportName({ first: r.first, last: r.last, preferred: r.preferred }) : r.email]));
  return marks
    .map((m) => ({ employeeId: m.employeeId, name: nameOf.get(m.employeeId) ?? "Unknown", date: m.date, weekday: WEEKDAY.format(new Date(`${m.date}T00:00:00Z`)), note: m.note, markedBy: byName.get(m.setBy) ?? "Someone", markedOn: m.setAt.toISOString() }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
}

export type PeriodProgress = { start: string; totalDays: number; pendingDays: number; pendingPeople: number; teams: { team: string; pendingDays: number; pendingPeople: number }[] };
export type HoursSettings = { kind: PayPeriodKind; biweeklyAnchor: string; periods: PayPeriod[]; /** How much of the latest periods is approved. */ progress: PeriodProgress[] };

/** Finished days (before today) of a pay period that are approved, and the rest by team. */
export async function periodProgress(period: PayPeriod): Promise<PeriodProgress> {
  const today = todayInZone();
  const days = (await attendanceRows(db, null, period.start, period.end)).filter((d) => (d.sessions > 0 || d.scheduledMinutes !== null) && d.date < today);
  const ids = [...new Set(days.map((d) => d.employeeId))];
  if (ids.length === 0) return { start: period.start, totalDays: 0, pendingDays: 0, pendingPeople: 0, teams: [] };
  const approvals = await latestApprovals(db, ids, period.start, period.end);
  const teamRows = (await db.execute(sql`select e.id, coalesce(t.name, 'No team') as team from core.employees e left join core.teams t on t.id = e.team_id where e.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)) as unknown as { id: string; team: string }[];
  const teamOf = new Map(teamRows.map((r) => [r.id, r.team]));
  const pending = days.filter((d) => dayState(d, approvals.get(approvalKey(d.employeeId, d.date))) !== "approved");
  const byTeam = new Map<string, { days: number; people: Set<string> }>();
  for (const d of pending) {
    const t = teamOf.get(d.employeeId) ?? "No team";
    const cur = byTeam.get(t) ?? { days: 0, people: new Set<string>() };
    cur.days += 1;
    cur.people.add(d.employeeId);
    byTeam.set(t, cur);
  }
  return {
    start: period.start,
    totalDays: days.length,
    pendingDays: pending.length,
    pendingPeople: new Set(pending.map((d) => d.employeeId)).size,
    teams: [...byTeam.entries()].map(([team, v]) => ({ team, pendingDays: v.days, pendingPeople: v.people.size })).sort((a, b) => b.pendingDays - a.pendingDays),
  };
}

/** How pay periods are cut and the recent ones to export. HR only. */
export async function getHoursSettings(): Promise<HoursSettings> {
  const user = await requireUser();
  await authorize(user, "hours.export");
  const [row] = await db.select().from(hoursSettings).where(eq(hoursSettings.id, 1)).limit(1);
  const kind = (row?.payPeriodKind ?? "semi_monthly") as PayPeriodKind;
  const anchor = row?.biweeklyAnchor ?? "2026-01-05";
  const periods = recentPeriods(kind, todayInZone(), 8, anchor);
  return { kind, biweeklyAnchor: anchor, periods, progress: await Promise.all(periods.slice(0, 3).map((p) => periodProgress(p))) };
}
