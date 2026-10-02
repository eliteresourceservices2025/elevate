import { EXTRA_FLAGS, FUNNEL_STAGES, NIL_UUID, type DimKind } from "./constants";
import { addDays, eachDay, eachMonth, monthEnd, monthStart, weekStart } from "./dates";

// People analytics calculations. Pure: source rows in, summary rows out, no database and no clock. Every date is a company-zone
// calendar date ("yyyy-MM-dd"). Nothing here ever returns a row about one person: groups only.

export type Dim = { kind: DimKind; id: string };
const COMPANY: Dim = { kind: "company", id: NIL_UUID };
const keyOf = (d: Dim) => `${d.kind}:${d.id}`;
const parseKey = (k: string): Dim => ({ kind: k.slice(0, k.indexOf(":")) as DimKind, id: k.slice(k.indexOf(":") + 1) });

export type PersonRec = {
  id: string;
  /** Employment start; the day the record was created when none was entered. */
  startDate: string | null;
  createdDate: string;
  endDate: string | null;
  /** When there is no end date but the person was archived, the archive date counts as the last day. */
  archivedDate: string | null;
  /** The current values, used only for a person with no dated history. */
  teamId: string | null;
  managerId: string | null;
};
export type Dated<T> = { employeeId: string; value: T; from: string; to: string | null };
export type LeaveRow = { employeeId: string; date: string; /** Signed, as in the ledger: usage negative, reversal positive. */ days: number };
export type AttendanceRow = { employeeId: string; date: string; flags: string[] };

export type SourceData = {
  people: PersonRec[];
  teamHistory: Dated<string | null>[];
  managerHistory: Dated<string | null>[];
  clientAssignments: Dated<string>[];
  leave: LeaveRow[];
  attendance: AttendanceRow[];
};

export const startOf = (p: PersonRec): string => p.startDate ?? p.createdDate;
export const endOf = (p: PersonRec): string | null => {
  const end = p.endDate ?? p.archivedDate;
  return end !== null && end < startOf(p) ? startOf(p) : end;
};
/** Whether the person counts in headcount on that date: started, and not past their last day. */
export const isActiveOn = (p: PersonRec, date: string): boolean => startOf(p) <= date && (endOf(p) === null || (endOf(p) as string) >= date);

function group<T extends { employeeId: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(r.employeeId) ?? m.set(r.employeeId, []).get(r.employeeId)!).push(r);
  return m;
}
const on = <T>(rows: Dated<T>[] | undefined, date: string): Dated<T> | undefined => rows?.find((r) => r.from <= date && (r.to === null || r.to >= date));

export type Context = {
  people: Map<string, PersonRec>;
  teams: Map<string, Dated<string | null>[]>;
  managers: Map<string, Dated<string | null>[]>;
  clients: Map<string, Dated<string>[]>;
};

export function buildContext(data: SourceData): Context {
  return { people: new Map(data.people.map((p) => [p.id, p])), teams: group(data.teamHistory), managers: group(data.managerHistory), clients: group(data.clientAssignments) };
}

/** The person's team that day: the dated history when they have any, the current value when they have none. */
export function teamOn(ctx: Context, employeeId: string, date: string): string | null {
  const rows = ctx.teams.get(employeeId);
  if (rows && rows.length > 0) return on(rows, date)?.value ?? null;
  return ctx.people.get(employeeId)?.teamId ?? null;
}
export function managerOn(ctx: Context, employeeId: string, date: string): string | null {
  const rows = ctx.managers.get(employeeId);
  if (rows && rows.length > 0) return on(rows, date)?.value ?? null;
  return ctx.people.get(employeeId)?.managerId ?? null;
}

/** Everyone above the person in the chain that day (a loop is cut off; the database refuses loops anyway). */
export function chainOn(ctx: Context, employeeId: string, date: string): string[] {
  const out: string[] = [];
  const seen = new Set([employeeId]);
  let at = managerOn(ctx, employeeId, date);
  while (at && !seen.has(at) && out.length < 50) {
    out.push(at);
    seen.add(at);
    at = managerOn(ctx, at, date);
  }
  return out;
}

/** The groups a person belongs to on a date: the company, their team, each client they are assigned to, and every manager above them. */
export function dimsOn(ctx: Context, employeeId: string, date: string): Dim[] {
  const dims: Dim[] = [COMPANY];
  const team = teamOn(ctx, employeeId, date);
  if (team) dims.push({ kind: "team", id: team });
  for (const c of ctx.clients.get(employeeId) ?? []) if (c.from <= date && (c.to === null || c.to >= date)) dims.push({ kind: "client", id: c.value });
  for (const m of chainOn(ctx, employeeId, date)) dims.push({ kind: "downline", id: m });
  return dims;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Output rows

export type HeadcountRow = { date: string; dimKind: DimKind; dimId: string; headcount: number };
export type MovementRow = { month: string; dimKind: DimKind; dimId: string; joiners: number; leavers: number; avgHeadcount: number; endHeadcount: number };
export type LeaveMonthRow = { month: string; dimKind: DimKind; dimId: string; daysUsed: number; groupSize: number };
export type AttendanceWeekRow = { weekStart: string; dimKind: DimKind; dimId: string; dayCount: number; late: number; absent: number; leftEarly: number; extraHours: number; unapprovedExtra: number; groupSize: number };
export type Summaries = { headcount: HeadcountRow[]; movement: MovementRow[]; leave: LeaveMonthRow[]; attendance: AttendanceWeekRow[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Builds the people summaries for a date range. The range is widened to whole weeks and months (so a month or a week is never
 * written half-counted) and clipped at `to`, which is the last finished day. Idempotent: the same inputs give the same rows.
 */
/** The start actually built for a requested start: back to the first of its month or the Monday of its week, whichever is earlier. */
export const widenFrom = (from: string): string => (weekStart(from) < monthStart(from) ? weekStart(from) : monthStart(from));

export function buildSummaries(data: SourceData, from: string, to: string): Summaries {
  const ctx = buildContext(data);
  const wideFrom = widenFrom(from);
  const mFrom = monthStart(from);
  const days = eachDay(wideFrom, to);

  // Daily headcount per group
  const daily = new Map<string, Map<string, number>>(); // date -> group key -> headcount
  for (const date of days) {
    const counts = new Map<string, number>();
    for (const p of data.people) {
      if (!isActiveOn(p, date)) continue;
      for (const d of dimsOn(ctx, p.id, date)) counts.set(keyOf(d), (counts.get(keyOf(d)) ?? 0) + 1);
    }
    daily.set(date, counts);
  }
  const headcount: HeadcountRow[] = [];
  for (const [date, counts] of daily) for (const [k, headcountN] of counts) headcount.push({ date, ...rowDim(k), headcount: headcountN });

  // Joiners and leavers per month
  const joiners = new Map<string, number>(); // `${month}|${groupKey}`
  const leavers = new Map<string, number>();
  const bump = (m: Map<string, number>, month: string, d: Dim, by = 1) => m.set(`${month}|${keyOf(d)}`, (m.get(`${month}|${keyOf(d)}`) ?? 0) + by);
  for (const p of data.people) {
    const start = startOf(p);
    if (start >= mFrom && start <= to) for (const d of dimsOn(ctx, p.id, start)) bump(joiners, monthStart(start), d);
    const end = endOf(p);
    if (end !== null && end >= mFrom && end <= to) for (const d of dimsOn(ctx, p.id, end)) bump(leavers, monthStart(end), d);
  }
  const months = eachMonth(mFrom, to);
  const movement: MovementRow[] = [];
  const endHeadcountOf = new Map<string, number>(); // `${month}|${groupKey}`
  for (const month of months) {
    const last = monthEnd(month) < to ? monthEnd(month) : to;
    const monthDays = eachDay(month, last);
    const sums = new Map<string, number>();
    for (const date of monthDays) for (const [k, n] of daily.get(date) ?? []) sums.set(k, (sums.get(k) ?? 0) + n);
    const keys = new Set<string>(sums.keys());
    for (const k of [...joiners.keys(), ...leavers.keys()]) if (k.startsWith(`${month}|`)) keys.add(k.slice(11));
    for (const k of keys) {
      const end = daily.get(last)?.get(k) ?? 0;
      endHeadcountOf.set(`${month}|${k}`, end);
      movement.push({ month, ...rowDim(k), joiners: joiners.get(`${month}|${k}`) ?? 0, leavers: leavers.get(`${month}|${k}`) ?? 0, avgHeadcount: round2((sums.get(k) ?? 0) / monthDays.length), endHeadcount: end });
    }
  }

  // Prize days used per month
  const used = new Map<string, number>();
  for (const l of data.leave) {
    if (l.date < mFrom || l.date > to) continue;
    for (const d of dimsOn(ctx, l.employeeId, l.date)) bump(used, monthStart(l.date), d, -l.days);
  }
  const leave: LeaveMonthRow[] = [...used].map(([k, v]) => {
    const [month, group] = [k.slice(0, 10), k.slice(11)];
    return { month, ...rowDim(group), daysUsed: round2(v), groupSize: endHeadcountOf.get(k) ?? 0 };
  });

  // Attendance flags per week
  type Acc = { dayCount: number; late: number; absent: number; leftEarly: number; extraHours: number; unapprovedExtra: number };
  const weekly = new Map<string, Acc>();
  for (const a of data.attendance) {
    if (a.date < weekStart(from) || a.date > to) continue;
    const week = weekStart(a.date);
    const extra = EXTRA_FLAGS.some((f) => a.flags.includes(f));
    for (const d of dimsOn(ctx, a.employeeId, a.date)) {
      const key = `${week}|${keyOf(d)}`;
      const acc = weekly.get(key) ?? { dayCount: 0, late: 0, absent: 0, leftEarly: 0, extraHours: 0, unapprovedExtra: 0 };
      acc.dayCount += 1;
      if (a.flags.includes("late")) acc.late += 1;
      if (a.flags.includes("absent")) acc.absent += 1;
      if (a.flags.includes("left_early")) acc.leftEarly += 1;
      if (extra) acc.extraHours += 1;
      if (a.flags.includes("unapproved_extra")) acc.unapprovedExtra += 1;
      weekly.set(key, acc);
    }
  }
  const attendance: AttendanceWeekRow[] = [...weekly].map(([k, acc]) => {
    const week = k.slice(0, 10);
    const group = k.slice(11);
    const last = addDays(week, 6) < to ? addDays(week, 6) : to;
    return { weekStart: week, ...rowDim(group), ...acc, groupSize: daily.get(last)?.get(group) ?? 0 };
  });

  return { headcount, movement, leave, attendance };
}

function rowDim(key: string): { dimKind: DimKind; dimId: string } {
  const d = parseKey(key);
  return { dimKind: d.kind, dimId: d.id };
}

/** Turnover for a month as a percentage: leavers divided by the month's average headcount. Null when there was nobody. */
export function turnoverPercent(leavers: number, avgHeadcount: number): number | null {
  return avgHeadcount > 0 ? Math.round((leavers / avgHeadcount) * 1000) / 10 : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hiring

export type ApplicationRec = { id: string; openingId: string; stage: string; appliedAt: Date; closedAt: Date | null };
export type StageMove = { applicationId: string; toStage: string; at: Date };
export type FunnelRow = { month: string; openingId: string; stage: string; applications: number };
export type TimeToHireRow = { month: string; openingId: string; hires: number; totalDays: number; medianDays: number };

/** The stages an application has reached: always "applied", every stage in its history, and where it stands now. */
export function stagesReached(app: ApplicationRec, moves: StageMove[]): Set<string> {
  const set = new Set<string>(["applied", app.stage]);
  for (const m of moves) set.add(m.toStage);
  return set;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const hiredAt = (app: ApplicationRec, moves: StageMove[]): Date | null => {
  const hired = moves.filter((m) => m.toStage === "hired").sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  return hired?.at ?? (app.stage === "hired" ? app.closedAt : null);
};

/**
 * The hiring funnel (applications that reached each stage, counted in the month they applied) and time to hire (days from applying
 * to being hired, counted in the month of the hire), per job and for all jobs together. `monthOf` turns a moment into a company-zone
 * month start. Only months from `fromMonth` onwards are returned.
 */
export function buildHiring(
  apps: ApplicationRec[],
  moves: StageMove[],
  monthOf: (d: Date) => string,
  fromMonth: string,
): { funnel: FunnelRow[]; timeToHire: TimeToHireRow[] } {
  const movesBy = new Map<string, StageMove[]>();
  for (const m of moves) (movesBy.get(m.applicationId) ?? movesBy.set(m.applicationId, []).get(m.applicationId)!).push(m);

  const funnel = new Map<string, number>(); // month|opening|stage
  const hireDays = new Map<string, number[]>(); // month|opening
  const add = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  for (const app of apps) {
    const my = movesBy.get(app.id) ?? [];
    const month = monthOf(app.appliedAt);
    if (month >= fromMonth) {
      for (const stage of stagesReached(app, my)) {
        if (!(FUNNEL_STAGES as readonly string[]).includes(stage)) continue;
        add(funnel, `${month}|${app.openingId}|${stage}`);
        add(funnel, `${month}|${NIL_UUID}|${stage}`);
      }
    }
    const hired = hiredAt(app, my);
    if (hired) {
      const hireMonth = monthOf(hired);
      if (hireMonth >= fromMonth) {
        const days = Math.max(0, (hired.getTime() - app.appliedAt.getTime()) / 86_400_000);
        for (const opening of [app.openingId, NIL_UUID]) {
          const key = `${hireMonth}|${opening}`;
          (hireDays.get(key) ?? hireDays.set(key, []).get(key)!).push(days);
        }
      }
    }
  }
  return {
    funnel: [...funnel].map(([k, applications]) => {
      const [month, openingId, stage] = k.split("|");
      return { month, openingId, stage, applications };
    }),
    timeToHire: [...hireDays].map(([k, list]) => {
      const [month, openingId] = k.split("|");
      return { month, openingId, hires: list.length, totalDays: round2(list.reduce((a, b) => a + b, 0)), medianDays: round2(median(list)) };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What the nightly job builds

/**
 * The first date to rebuild. Without any snapshot, the whole backfill window; otherwise the earliest gap in the window (a missed night)
 * or the recent-days window, whichever is earlier. `existing` is the set of dates that already have a company headcount row.
 */
export function buildStart(existing: ReadonlySet<string>, today: string, backfillDays: number, recentDays: number): string {
  const last = addDays(today, -1); // the last finished day
  const windowStart = addDays(today, -backfillDays);
  const recent = addDays(last, -(recentDays - 1));
  if (existing.size === 0) return windowStart;
  const firstExisting = [...existing].sort()[0];
  let start = recent;
  for (const d of eachDay(firstExisting > windowStart ? firstExisting : windowStart, last)) {
    if (!existing.has(d)) {
      if (d < start) start = d;
      break;
    }
  }
  return start;
}

