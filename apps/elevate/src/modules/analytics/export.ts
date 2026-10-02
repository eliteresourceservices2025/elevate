import { toCsv } from "@/lib/csv";
import { FEWER_THAN } from "./constants";
import type { Cell, Dashboard } from "./view";

// The CSV of exactly what the dashboard displays: aggregates only, one value per row, and a hidden cell reads "fewer than 5" (never
// the number). Every cell goes through csvCell (src/lib/csv.ts), so a job title typed by a person cannot run as a spreadsheet formula.

type Row = [section: string, period: string, group: string, metric: string, value: string | number];
const cell = (v: Cell): string | number => (v === null ? FEWER_THAN : v);

export function dashboardRows(d: Dashboard): Row[] {
  const rows: Row[] = [];
  const scope = d.scope.label;
  const p = d.people;
  if (p) {
    rows.push(["Headcount", d.asOf ?? "", scope, "People now", cell(p.headcountNow)]);
    for (const h of p.headcount) rows.push(["Headcount", h.date, scope, "People", cell(h.headcount)]);
    for (const m of p.movement) {
      rows.push(["Joiners and leavers", m.month, scope, "Joiners", cell(m.joiners)]);
      rows.push(["Joiners and leavers", m.month, scope, "Leavers", cell(m.leavers)]);
      rows.push(["Turnover", m.month, scope, "Average headcount", cell(m.avgHeadcount)]);
      rows.push(["Turnover", m.month, scope, "Turnover percent (leavers / average headcount)", cell(m.turnover)]);
    }
    for (const l of p.leave) rows.push(["Prize days used", l.month, scope, "Days used", cell(l.daysUsed)]);
    for (const a of p.attendance) {
      rows.push(["Attendance", a.week, scope, "Person-days recorded", cell(a.dayCount)]);
      rows.push(["Attendance", a.week, scope, "Late days", cell(a.late)]);
      rows.push(["Attendance", a.week, scope, "Absent days", cell(a.absent)]);
      rows.push(["Attendance", a.week, scope, "Left early days", cell(a.leftEarly)]);
      rows.push(["Attendance", a.week, scope, "Extra hours days", cell(a.extraHours)]);
      rows.push(["Attendance", a.week, scope, "Unapproved extra hours days", cell(a.unapprovedExtra)]);
      rows.push(["Attendance", a.week, scope, "Late percent", cell(a.lateRate)]);
      rows.push(["Attendance", a.week, scope, "Absent percent", cell(a.absentRate)]);
    }
  }
  for (const [name, b] of [["Headcount by team", d.teams], ["Headcount by client", d.clients]] as const) {
    if (!b) continue;
    for (const r of b.rows) rows.push([name, d.asOf ?? "", r.name, "People", r.headcount]);
    if (b.other) rows.push([name, d.asOf ?? "", `Other (${b.other.groups} smaller groups)`, "People", b.other.headcount]);
  }
  const h = d.hiring;
  if (h) {
    for (const f of h.funnel) {
      rows.push(["Hiring funnel", "range", "All jobs", `${f.label}: applications`, cell(f.applications)]);
      rows.push(["Hiring funnel", "range", "All jobs", `${f.label}: percent of applied`, cell(f.ofApplied)]);
    }
    for (const j of h.byJob) for (const [stage, n] of Object.entries(j.stages)) rows.push(["Hiring funnel by job", "range", j.title, `${stage}: applications`, n]);
    if (h.otherJobs) for (const [stage, n] of Object.entries(h.otherJobs.stages)) rows.push(["Hiring funnel by job", "range", `Other (${h.otherJobs.jobs} smaller jobs)`, `${stage}: applications`, n]);
    for (const t of h.timeToHire) {
      rows.push(["Time to hire", t.month, "All jobs", "Hires", t.hires]);
      rows.push(["Time to hire", t.month, "All jobs", "Average days applied to hired", cell(t.avgDays)]);
      rows.push(["Time to hire", t.month, "All jobs", "Median days applied to hired", cell(t.medianDays)]);
    }
    rows.push(["Time to hire", "range", "All jobs", "Average days applied to hired", cell(h.overall.avgDays)]);
  }
  return rows;
}

export function dashboardCsv(d: Dashboard): { csv: string; rows: number } {
  const rows = dashboardRows(d);
  return { csv: toCsv(["Section", "Period", "Group", "Metric", "Value"], rows), rows: rows.length };
}
