import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { formatInZone, resolveTimeZone } from "@/lib/time";
import { reportName } from "@/modules/org/service";
import { holidaysInRange } from "@/modules/timeoff/request-service";
import { requestDays } from "@/modules/timeoff/workdays";
import { approvalKey, attendanceRows, dayState, latestApprovals, zonesFor, type DayState } from "./hours-service";
import { toHours } from "./pay-periods";
import { shiftOn, shiftRange } from "./schedule";
import { loadSchedulesFor, workingWeekdaysFor } from "./schedule-service";

// Builds the hours export for payroll. ELEVATE only labels and totals hours; it never computes pay. By default only days whose
// numbers are exactly what a lead approved are included; the rest can be added and are labelled.

type Person = { id: string; name: string; email: string | null; team: string | null; clients: string };

async function peopleFor(ids: string[]): Promise<Map<string, Person>> {
  if (ids.length === 0) return new Map();
  const rows = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, e.work_email as email, t.name as team,
      (select coalesce(string_agg(distinct c.name, '; '), '') from core.client_assignments a join core.clients c on c.id = a.client_id where a.employee_id = e.id) as clients
    from core.employees e left join core.teams t on t.id = e.team_id where e.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)) as unknown as { id: string; first: string; last: string; preferred: string | null; email: string | null; team: string | null; clients: string }[];
  return new Map(rows.map((r) => [r.id, { id: r.id, name: reportName({ first: r.first, last: r.last, preferred: r.preferred }), email: r.email, team: r.team, clients: r.clients }]));
}

async function approverNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = (await db.execute(sql`select u.id, u.email, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from core.users u left join core.employees e on e.user_id = u.id where u.id in (${sql.join([...new Set(userIds)].map((id) => sql`${id}`), sql`, `)})`)) as unknown as { id: string; email: string; first: string | null; last: string | null; preferred: string | null }[];
  return new Map(rows.map((r) => [r.id, r.first && r.last ? reportName({ first: r.first, last: r.last, preferred: r.preferred }) : r.email]));
}

const STATE_TEXT = new Map<DayState, string>([["approved", "Approved"], ["changed", "Changed after approval"], ["none", "Not approved"]]);

export type HoursExport = { fileName: string; csv: string; rows: number };

/** The daily detail (one row per person and day) or the per-person summary for a pay period. */
export async function buildHoursExport(input: { periodStart: string; periodEnd: string; kind: "daily" | "summary"; includeUnapproved: boolean }): Promise<HoursExport> {
  const { periodStart, periodEnd } = input;
  const days = await attendanceRows(db, null, periodStart, periodEnd);
  const ids = [...new Set(days.map((d) => d.employeeId))];
  const approvals = await latestApprovals(db, ids, periodStart, periodEnd);
  const people = await peopleFor(ids);
  const zones = await zonesFor(db, ids);
  const schedules = await loadSchedulesFor(db, ids);
  const names = await approverNames([...approvals.values()].map((a) => a.approvedBy));

  const included = days
    .map((d) => ({ d, state: dayState(d, approvals.get(approvalKey(d.employeeId, d.date))), approval: approvals.get(approvalKey(d.employeeId, d.date)) }))
    .filter((x) => x.d.sessions > 0 || x.d.scheduledMinutes !== null)
    .filter((x) => input.includeUnapproved || x.state === "approved")
    .sort((a, b) => (people.get(a.d.employeeId)?.name ?? "").localeCompare(people.get(b.d.employeeId)?.name ?? "") || a.d.date.localeCompare(b.d.date));

  const regular = (extra: number, worked: number) => Math.max(0, worked - extra);
  const stamp = `${periodStart}_to_${periodEnd}`;

  if (input.kind === "daily") {
    const header = ["Person", "Work email", "Team", "Client(s)", "Date", "Shift", "Scheduled hours", "First in", "Last out", "Breaks (hours)", "Worked hours", "Regular hours", "Extra hours (approved)", "Extra hours (not approved)", "Late (minutes)", "Left early (minutes)", "Flags", "Approval", "Approved by", "Approved on"];
    const rows = included.map(({ d, state, approval }) => {
      const p = people.get(d.employeeId)!;
      const zone = resolveTimeZone(zones.get(d.employeeId));
      const shift = shiftOn(schedules.get(d.employeeId) ?? [], zone, d.date);
      return [
        p.name,
        p.email,
        p.team,
        p.clients,
        d.date,
        shift ? `${shiftRange(shift, shift.schedule.zone)} ${shift.schedule.zone}` : "",
        d.scheduledMinutes === null ? "" : toHours(d.scheduledMinutes),
        d.firstIn ? formatInZone(d.firstIn, zone, "yyyy-MM-dd HH:mm") : "",
        d.lastOut ? formatInZone(d.lastOut, zone, "yyyy-MM-dd HH:mm") : "",
        toHours(d.breakMinutes),
        toHours(d.workedMinutes),
        toHours(regular(d.extraMinutes, d.workedMinutes)),
        toHours(d.approvedExtraMinutes),
        toHours(Math.max(0, d.extraMinutes - d.approvedExtraMinutes)),
        d.lateMinutes,
        d.earlyLeaveMinutes,
        d.flags.join("; "),
        STATE_TEXT.get(state),
        approval && state !== "none" ? (names.get(approval.approvedBy) ?? "") : "",
        approval && state !== "none" ? formatInZone(approval.approvedAt, undefined, "yyyy-MM-dd") : "",
      ];
    });
    return { fileName: `hours-daily-${stamp}.csv`, csv: toCsv(header, rows), rows: rows.length };
  }

  // Summary: one row per person with totals for the period.
  const header = ["Person", "Work email", "Team", "Client(s)", "Days included", "Days not approved", "Scheduled hours", "Worked hours", "Regular hours", "Extra hours (approved)", "Extra hours (not approved)", "Absent days", "Late days", "Approved leave days"];
  const byPerson = new Map<string, typeof included>();
  for (const x of included) byPerson.set(x.d.employeeId, [...(byPerson.get(x.d.employeeId) ?? []), x]);
  // People with approved leave but no hours still appear, so payroll sees their days off.
  const leave = (await db.execute(sql`
    select employee_id, start_date::text as start_date, end_date::text as end_date, half_day from time.leave_requests
    where status = 'approved' and start_date <= ${periodEnd}::date and end_date >= ${periodStart}::date`)) as unknown as { employee_id: string; start_date: string; end_date: string; half_day: boolean }[];
  const leaveIds = [...new Set(leave.map((l) => l.employee_id))].filter((id) => !people.has(id));
  const extraPeople = await peopleFor(leaveIds);
  for (const [id, p] of extraPeople) people.set(id, p);

  const rows: (string | number | null)[][] = [];
  const allIds = [...new Set([...byPerson.keys(), ...leave.map((l) => l.employee_id)])].filter((id) => people.has(id));
  allIds.sort((a, b) => (people.get(a)?.name ?? "").localeCompare(people.get(b)?.name ?? ""));
  for (const id of allIds) {
    const list = byPerson.get(id) ?? [];
    const p = people.get(id)!;
    const sum = (f: (x: (typeof list)[number]) => number) => list.reduce((n, x) => n + f(x), 0);
    let leaveDays = 0;
    const mine = leave.filter((l) => l.employee_id === id);
    if (mine.length > 0) {
      const holidays = new Set((await holidaysInRange(db, id, periodStart, periodEnd)).map((h) => h.date));
      const weekdays = await workingWeekdaysFor(db, id, periodStart);
      for (const l of mine) {
        const start = l.start_date < periodStart ? periodStart : l.start_date;
        const end = l.end_date > periodEnd ? periodEnd : l.end_date;
        leaveDays += requestDays(start, end, l.half_day && l.start_date === l.end_date, holidays, weekdays);
      }
    }
    rows.push([
      p.name,
      p.email,
      p.team,
      p.clients,
      list.filter((x) => x.state === "approved").length,
      list.filter((x) => x.state !== "approved").length,
      toHours(sum((x) => x.d.scheduledMinutes ?? 0)),
      toHours(sum((x) => x.d.workedMinutes)),
      toHours(sum((x) => regular(x.d.extraMinutes, x.d.workedMinutes))),
      toHours(sum((x) => x.d.approvedExtraMinutes)),
      toHours(sum((x) => Math.max(0, x.d.extraMinutes - x.d.approvedExtraMinutes))),
      list.filter((x) => x.d.flags.includes("absent")).length,
      list.filter((x) => x.d.lateMinutes > 0).length,
      leaveDays,
    ]);
  }
  return { fileName: `hours-summary-${stamp}.csv`, csv: toCsv(header, rows), rows: rows.length };
}
