import { turnoverPercent } from "./calc";
import { FUNNEL_LABELS, FUNNEL_STAGES, NIL_UUID } from "./constants";
import { eachMonth, monthStart } from "./dates";
import { groupWithOther, isSmall, percent } from "./suppress";

// Turns summary rows into what the screen and the CSV show. Pure. This is where small groups are hidden: a number whose group has
// fewer than 5 people becomes null here, on the server, so it never reaches the browser. Nothing in this file names a person.

export type Cell = number | null;

export type HeadcountPoint = { date: string; headcount: Cell };
export type MovementPoint = { month: string; joiners: Cell; leavers: Cell; avgHeadcount: Cell; turnover: Cell };
export type LeavePoint = { month: string; daysUsed: Cell };
export type AttendancePoint = { week: string; dayCount: Cell; late: Cell; absent: Cell; leftEarly: Cell; extraHours: Cell; unapprovedExtra: Cell; lateRate: Cell; absentRate: Cell };
export type BreakdownRow = { id: string; name: string; headcount: number };
export type Breakdown = { rows: BreakdownRow[]; other: { headcount: number; groups: number } | null; hiddenAll: boolean };

export type PeopleView = {
  /** True when the chosen group is too small to show at all. */
  hidden: boolean;
  headcountNow: Cell;
  headcount: HeadcountPoint[];
  movement: MovementPoint[];
  leave: LeavePoint[];
  attendance: AttendancePoint[];
};

export type HiringView = {
  /** Applications that reached each stage in the range, all jobs; null cells when fewer than 5 people applied. */
  funnel: { stage: string; label: string; applications: Cell; ofApplied: Cell }[];
  byJob: { title: string; applied: number; stages: Record<string, number> }[];
  otherJobs: { applied: number; jobs: number; stages: Record<string, number> } | null;
  timeToHire: { month: string; hires: number; avgDays: Cell; medianDays: Cell }[];
  overall: { hires: number; avgDays: Cell };
};

export type Dashboard = {
  /** The newest day with a snapshot (null before the first nightly run). */
  asOf: string | null;
  rangeMonths: number;
  scope: { value: string; label: string };
  scopeOptions: { value: string; label: string }[];
  people: PeopleView | null;
  peopleNote: string | null;
  teams: Breakdown | null;
  clients: Breakdown | null;
  hiring: HiringView | null;
};

// ---------------------------------------------------------------------------------------------------------------------------------

export function headcountPoints(rows: { date: string; headcount: number }[], from: string, to: string): HeadcountPoint[] {
  const lastOfMonth = new Map<string, { date: string; headcount: number }>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const m = monthStart(r.date);
    const seen = lastOfMonth.get(m);
    if (!seen || seen.date < r.date) lastOfMonth.set(m, r);
  }
  return [...lastOfMonth.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, headcount: isSmall(r.headcount) ? null : r.headcount }));
}

type MovementRowIn = { month: string; joiners: number; leavers: number; avgHeadcount: number; endHeadcount: number };
export function movementPoints(rows: MovementRowIn[], from: string, to: string): MovementPoint[] {
  const by = new Map(rows.map((r) => [r.month, r]));
  return eachMonth(from, to).map((month) => {
    const r = by.get(month);
    // The smaller of the average and the end-of-month headcount decides, so a shrinking group is never shown just under the line.
    if (!r || isSmall(Math.min(r.avgHeadcount, r.endHeadcount))) return { month, joiners: null, leavers: null, avgHeadcount: null, turnover: null };
    return { month, joiners: r.joiners, leavers: r.leavers, avgHeadcount: Math.round(r.avgHeadcount * 10) / 10, turnover: turnoverPercent(r.leavers, r.avgHeadcount) };
  });
}

export function leavePoints(rows: { month: string; daysUsed: number; groupSize: number }[], from: string, to: string, sizeByMonth: Map<string, number> = new Map()): LeavePoint[] {
  const by = new Map(rows.map((r) => [r.month, r]));
  return eachMonth(from, to).map((month) => {
    const r = by.get(month);
    if (!r) return { month, daysUsed: isSmall(sizeByMonth.get(month)) ? null : 0 };
    return { month, daysUsed: isSmall(r.groupSize) ? null : r.daysUsed };
  });
}

type WeekRowIn = { weekStart: string; dayCount: number; late: number; absent: number; leftEarly: number; extraHours: number; unapprovedExtra: number; groupSize: number };
export function attendancePoints(rows: WeekRowIn[], from: string, to: string): AttendancePoint[] {
  return rows
    .filter((r) => r.weekStart >= from && r.weekStart <= to)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((r) => {
      if (isSmall(r.groupSize)) return { week: r.weekStart, dayCount: null, late: null, absent: null, leftEarly: null, extraHours: null, unapprovedExtra: null, lateRate: null, absentRate: null };
      return { week: r.weekStart, dayCount: r.dayCount, late: r.late, absent: r.absent, leftEarly: r.leftEarly, extraHours: r.extraHours, unapprovedExtra: r.unapprovedExtra, lateRate: percent(r.late, r.dayCount), absentRate: percent(r.absent, r.dayCount) };
    });
}

/** Headcount by team or client on one day: small groups are merged into "Other", which is itself kept above the line. */
export function breakdown(groups: { id: string; name: string; headcount: number }[]): Breakdown {
  const grouped = groupWithOther(groups.map((g) => ({ ...g, size: g.headcount })));
  const hiddenAll = groups.length > 0 && grouped.visible.length === 0 && grouped.other === null;
  return {
    rows: grouped.visible.map((g) => ({ id: g.id, name: g.name, headcount: g.headcount })),
    other: grouped.other ? { headcount: grouped.other.size, groups: grouped.other.members } : null,
    hiddenAll,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hiring

type FunnelRowIn = { month: string; openingId: string; stage: string; applications: number };
type HireRowIn = { month: string; openingId: string; hires: number; totalDays: number; medianDays: number };

export function hiringView(funnelRows: FunnelRowIn[], hireRows: HireRowIn[], titles: Map<string, string>, from: string, to: string): HiringView {
  const months = eachMonth(from, to);
  const inRange = new Set(months);
  const sumFor = (opening: string) => {
    const out: Record<string, number> = {};
    for (const r of funnelRows) if (r.openingId === opening && inRange.has(r.month)) out[r.stage] = (out[r.stage] ?? 0) + r.applications;
    return out;
  };
  const all = sumFor(NIL_UUID);
  const applied = all.applied ?? 0;
  const funnel = FUNNEL_STAGES.map((stage) => {
    const n = all[stage] ?? 0;
    return { stage, label: FUNNEL_LABELS[stage], applications: isSmall(applied) ? null : n, ofApplied: isSmall(applied) ? null : percent(n, applied) };
  });

  const openings = [...new Set(funnelRows.filter((r) => r.openingId !== NIL_UUID && inRange.has(r.month)).map((r) => r.openingId))];
  const jobs = openings.map((id) => {
    const stages = sumFor(id);
    return { id, title: titles.get(id) ?? "Job", size: stages.applied ?? 0, stages };
  });
  const grouped = isSmall(applied) ? { visible: [], other: null } : groupWithOther(jobs);
  const other = grouped.other
    ? (() => {
        const stages: Record<string, number> = {};
        for (const j of grouped.other.items) for (const [s, n] of Object.entries(j.stages)) stages[s] = (stages[s] ?? 0) + n;
        return { applied: grouped.other.size, jobs: grouped.other.members, stages };
      })()
    : null;

  const tth = hireRows.filter((r) => r.openingId === NIL_UUID && inRange.has(r.month));
  const timeToHire = months.map((month) => {
    const r = tth.find((x) => x.month === month);
    if (!r) return { month, hires: 0, avgDays: null, medianDays: null };
    return { month, hires: r.hires, avgDays: isSmall(r.hires) ? null : Math.round((r.totalDays / r.hires) * 10) / 10, medianDays: isSmall(r.hires) ? null : r.medianDays };
  });
  const hires = tth.reduce((n, r) => n + r.hires, 0);
  const days = tth.reduce((n, r) => n + r.totalDays, 0);
  return {
    funnel,
    byJob: grouped.visible.map((j) => ({ title: j.title, applied: j.size, stages: j.stages })),
    otherJobs: other,
    timeToHire,
    overall: { hires, avgDays: isSmall(hires) ? null : Math.round((days / hires) * 10) / 10 },
  };
}
