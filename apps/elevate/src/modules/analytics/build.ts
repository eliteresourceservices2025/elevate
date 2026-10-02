import "server-only";
import { and, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { buildHiring, buildStart, buildSummaries, widenFrom, type ApplicationRec, type SourceData, type StageMove } from "./calc";
import { BACKFILL_DAYS, RECENT_REBUILD_DAYS } from "./constants";
import { addDays, monthStart, weekStart } from "./dates";
import { attendanceWeekly, funnelMonthly, headcountDaily, leaveMonthly, movementMonthly, timeToHireMonthly } from "./schema";

// Builds the analytics summary tables from the source tables. The one entry point is rebuildRange(): idempotent (a range is
// deleted and written again inside one transaction, so running it twice, or after an edit to the sources, gives the same rows and
// leaves no stale ones). The nightly job and the first-time backfill both call it.

const zoneDate = (d: Date | string) => formatInZone(d, DEFAULT_TIMEZONE, "yyyy-MM-dd");
const rowsOf = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const CHUNK = 1000;

export async function loadSource(wideFrom: string, to: string): Promise<SourceData> {
  const zone = DEFAULT_TIMEZONE;
  const people = await rowsOf<{ id: string; start_date: string | null; end_date: string | null; created: string; archived: string | null; team_id: string | null; manager_id: string | null }>(sql`
    select id, start_date::text as start_date, end_date::text as end_date,
      to_char(created_at at time zone ${zone}, 'YYYY-MM-DD') as created,
      case when archived_at is null then null else to_char(archived_at at time zone ${zone}, 'YYYY-MM-DD') end as archived,
      team_id, manager_id
    from core.employees`);
  const teamHistory = await rowsOf<{ employee_id: string; team_id: string | null; from: string; to: string | null }>(sql`
    select employee_id, team_id, effective_from::text as "from", effective_to::text as "to" from core.team_memberships`);
  const managerHistory = await rowsOf<{ employee_id: string; manager_id: string | null; from: string; to: string | null }>(sql`
    select employee_id, manager_id, effective_from::text as "from", effective_to::text as "to" from core.reporting_lines`);
  const assignments = await rowsOf<{ employee_id: string; client_id: string; from: string; to: string | null }>(sql`
    select employee_id, client_id, start_date::text as "from", end_date::text as "to" from core.client_assignments`);
  const leave = await rowsOf<{ employee_id: string; date: string; days: string }>(sql`
    select employee_id, effective_on::text as date, days::text as days from time.leave_ledger
    where entry_type in ('usage','reversal') and effective_on >= ${wideFrom}::date and effective_on <= ${to}::date`);
  const attendance = await rowsOf<{ employee_id: string; date: string; flags: string[] }>(sql`
    select employee_id, date::text as date, flags from time.attendance_days where date >= ${wideFrom}::date and date <= ${to}::date`);
  return {
    people: people.map((p) => ({ id: p.id, startDate: p.start_date, createdDate: p.created, endDate: p.end_date, archivedDate: p.archived, teamId: p.team_id, managerId: p.manager_id })),
    teamHistory: teamHistory.map((r) => ({ employeeId: r.employee_id, value: r.team_id, from: r.from, to: r.to })),
    managerHistory: managerHistory.map((r) => ({ employeeId: r.employee_id, value: r.manager_id, from: r.from, to: r.to })),
    clientAssignments: assignments.map((r) => ({ employeeId: r.employee_id, value: r.client_id, from: r.from, to: r.to })),
    leave: leave.map((r) => ({ employeeId: r.employee_id, date: r.date, days: Number(r.days) })),
    attendance: attendance.map((r) => ({ employeeId: r.employee_id, date: r.date, flags: r.flags ?? [] })),
  };
}

async function insertChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
}

export type RebuildResult = { from: string; to: string; headcountRows: number; movementRows: number; leaveRows: number; attendanceRows: number; funnelRows: number; timeToHireRows: number };

/**
 * Rebuilds the people summaries for the dates from..to (to = the last finished day) and the hiring summaries for the whole backfill
 * window ending at `to` (a stage move can change an old application's funnel). Weeks and months touched by the range are rebuilt whole.
 * This is the backfill function: calling it for any past range fills or repairs that range.
 */
export async function rebuildRange(from: string, to: string): Promise<RebuildResult> {
  if (from > to) return { from, to, headcountRows: 0, movementRows: 0, leaveRows: 0, attendanceRows: 0, funnelRows: 0, timeToHireRows: 0 };
  const wide = widenFrom(from);
  const data = await loadSource(wide, to);
  const summaries = buildSummaries(data, from, to);

  const hiringFrom = monthStart(addDays(to, -BACKFILL_DAYS));
  const apps = await rowsOf<{ id: string; opening_id: string; stage: string; applied_at: Date; closed_at: Date | null }>(sql`
    select id, opening_id, stage, applied_at, closed_at from talent.applications`);
  const moves = await rowsOf<{ application_id: string; to_stage: string; at: Date }>(sql`select application_id, to_stage, at from talent.application_stage_history`);
  const hiring = buildHiring(
    apps.map((a): ApplicationRec => ({ id: a.id, openingId: a.opening_id, stage: a.stage, appliedAt: new Date(a.applied_at), closedAt: a.closed_at ? new Date(a.closed_at) : null })),
    moves.map((m): StageMove => ({ applicationId: m.application_id, toStage: m.to_stage, at: new Date(m.at) })),
    (d) => monthStart(zoneDate(d)),
    hiringFrom,
  );

  const mFrom = monthStart(from);
  const wFrom = weekStart(from);
  await db.transaction(async (tx) => {
    await tx.delete(headcountDaily).where(and(gte(headcountDaily.date, wide), lte(headcountDaily.date, to)));
    await tx.delete(movementMonthly).where(and(gte(movementMonthly.month, mFrom), lte(movementMonthly.month, to)));
    await tx.delete(leaveMonthly).where(and(gte(leaveMonthly.month, mFrom), lte(leaveMonthly.month, to)));
    await tx.delete(attendanceWeekly).where(and(gte(attendanceWeekly.weekStart, wFrom), lte(attendanceWeekly.weekStart, to)));
    await tx.delete(funnelMonthly).where(gte(funnelMonthly.month, hiringFrom));
    await tx.delete(timeToHireMonthly).where(gte(timeToHireMonthly.month, hiringFrom));
    await insertChunks(summaries.headcount, (c) => tx.insert(headcountDaily).values(c));
    await insertChunks(summaries.movement, (c) => tx.insert(movementMonthly).values(c.map((r) => ({ ...r, avgHeadcount: String(r.avgHeadcount) }))));
    await insertChunks(summaries.leave, (c) => tx.insert(leaveMonthly).values(c.map((r) => ({ ...r, daysUsed: String(r.daysUsed) }))));
    await insertChunks(summaries.attendance, (c) => tx.insert(attendanceWeekly).values(c));
    await insertChunks(hiring.funnel, (c) => tx.insert(funnelMonthly).values(c));
    await insertChunks(hiring.timeToHire, (c) => tx.insert(timeToHireMonthly).values(c.map((r) => ({ ...r, totalDays: String(r.totalDays), medianDays: String(r.medianDays) }))));
  });
  return {
    from,
    to,
    headcountRows: summaries.headcount.length,
    movementRows: summaries.movement.length,
    leaveRows: summaries.leave.length,
    attendanceRows: summaries.attendance.length,
    funnelRows: hiring.funnel.length,
    timeToHireRows: hiring.timeToHire.length,
  };
}

/**
 * The nightly job: builds through yesterday (company zone). The first run, with no snapshots yet, backfills a whole year; later runs
 * rebuild the last few days plus any missed night inside the window (self-healing). Safe to run any number of times.
 */
export async function runAnalyticsNightly(now = new Date()): Promise<RebuildResult> {
  const today = zoneDate(now);
  const windowStart = addDays(today, -BACKFILL_DAYS);
  const existing = await rowsOf<{ date: string }>(sql`select date::text as date from ops.analytics_headcount_daily where dim_kind = 'company' and date >= ${windowStart}::date`);
  const from = buildStart(new Set(existing.map((r) => r.date)), today, BACKFILL_DAYS, RECENT_REBUILD_DAYS);
  return rebuildRange(from, addDays(today, -1));
}
