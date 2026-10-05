import type { AttendancePoint, MovementPoint } from "@/modules/analytics/view";
import type { PeriodProgress } from "@/modules/attendance/hours-queries";
import type { PayPeriod } from "@/modules/attendance/pay-periods";
import { plural, type Severity } from "./attention";
import type { Lens } from "./lens";

// Early warnings. Every rule is plain arithmetic on counts and rates that are already hidden for small groups (fewer than 5 people),
// and every card says what its rule is. They are about teams and operations, never about one named person: ELEVATE does not score
// individuals or guess who might leave.

export type RiskCard = { id: string; severity: Severity; title: string; rule: string; href: string; lenses: Lens[] };

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The mean of the values, or null when there are none or any is hidden (a hidden week must never be guessed at). */
export function meanOrNull(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0) / values.length;
}

export type Trend = { recent: number; prior: number; delta: number };

/**
 * Recent weeks against the weeks before them, in percentage points. Only complete weeks count (the newest week is dropped unless it
 * ended on or before the snapshot day), and a trend needs every week in both windows to be visible.
 */
export function rateTrend(points: Pick<AttendancePoint, "week" | "lateRate" | "absentRate">[], key: "lateRate" | "absentRate", asOf: string, weeks = 4): Trend | null {
  const complete = points.filter((p) => addDays(p.week, 6) <= asOf).sort((a, b) => a.week.localeCompare(b.week));
  if (complete.length < weeks * 2) return null;
  const last = complete.slice(-weeks * 2);
  // eslint-disable-next-line security/detect-object-injection -- key is one of two typed names
  const recent = meanOrNull(last.slice(weeks).map((p) => p[key]));
  // eslint-disable-next-line security/detect-object-injection -- key is one of two typed names
  const prior = meanOrNull(last.slice(0, weeks).map((p) => p[key]));
  if (recent === null || prior === null) return null;
  return { recent: Math.round(recent * 10) / 10, prior: Math.round(prior * 10) / 10, delta: Math.round((recent - prior) * 10) / 10 };
}

/** A rise of at least this many percentage points, to a rate of at least MIN_RATE, is worth a look. */
export const RISE_POINTS = 3;
export const MIN_RATE = 5;

export function attendanceRisk(trend: Trend | null, kind: "late" | "absent"): RiskCard | null {
  if (!trend || trend.delta < RISE_POINTS || trend.recent < MIN_RATE) return null;
  const word = kind === "late" ? "Late arrivals" : "Absences";
  return {
    id: `${kind}-rising`,
    severity: trend.delta >= RISE_POINTS * 2 ? "urgent" : "warn",
    title: `${word} are up ${trend.delta} points`,
    rule: `${trend.recent}% of working days in the last 4 weeks, against ${trend.prior}% in the 4 weeks before. Shown when the rise is ${RISE_POINTS}+ points and the rate is ${MIN_RATE}%+.`,
    href: "/analytics",
    lenses: ["admin", "hr", "executive", "team_lead"],
  };
}

/** More people left than joined over the months given (their own months, this month so far included). */
export function netLossRisk(movement: Pick<MovementPoint, "joiners" | "leavers">[], months = 3, threshold = 3): RiskCard | null {
  const last = movement.slice(-months);
  if (last.length === 0 || last.some((m) => m.joiners === null || m.leavers === null)) return null;
  const joined = last.reduce((n, m) => n + (m.joiners as number), 0);
  const left = last.reduce((n, m) => n + (m.leavers as number), 0);
  if (left - joined < threshold) return null;
  return {
    id: "net-loss",
    severity: left - joined >= threshold * 3 ? "urgent" : "warn",
    title: `${plural(left - joined, "more person", "more people")} left than joined`,
    rule: `${left} left and ${joined} joined over the last ${last.length} months (this month so far included). Shown when the gap is ${threshold}+.`,
    href: "/analytics",
    lenses: ["admin", "hr", "executive", "team_lead"],
  };
}

/** A pay period that has ended but still has hours nobody approved. Several periods may qualify; the oldest is the most pressing. */
export function payrollRisks(periods: PayPeriod[], progress: Pick<PeriodProgress, "start" | "pendingDays" | "pendingPeople">[], today: string): RiskCard[] {
  return progress
    .map((p) => ({ p, period: periods.find((x) => x.start === p.start) }))
    .filter((x): x is { p: (typeof progress)[number]; period: PayPeriod } => x.period !== undefined && x.period.end < today && x.p.pendingDays > 0)
    .map(({ p, period }) => {
      const ago = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${period.end}T00:00:00Z`)) / 86_400_000);
      return {
        id: `payroll-${period.start}`,
        severity: ago >= 3 ? ("urgent" as const) : ("warn" as const),
        title: `${period.label}: ${plural(p.pendingDays, "day", "days")} of hours not approved`,
        rule: `That pay period ended ${ago} ${ago === 1 ? "day" : "days"} ago and ${plural(p.pendingPeople, "person has", "people have")} finished days nobody has approved yet. Shown while any are left.`,
        href: "/hours-review",
        lenses: ["admin", "hr"] as Lens[],
      };
    });
}

/** The busiest day in the window, when many people are off at once. */
export function crowdedDayRisk(days: { date: string; count: number }[], headcount: number | null, minimum = 5): RiskCard | null {
  if (days.length === 0) return null;
  const busiest = days.reduce((a, b) => (b.count > a.count ? b : a));
  const bar = Math.max(minimum, headcount ? Math.ceil(headcount * 0.05) : minimum);
  if (busiest.count < bar) return null;
  const label = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${busiest.date}T12:00:00Z`));
  return {
    id: "crowded-day",
    severity: "info",
    title: `${plural(busiest.count, "person is", "people are")} off on ${label}`,
    rule: `The busiest day in the next 14 days. Shown when ${bar}+ people are off at once (5, or 5% of active people if that is more).`,
    href: "/time-off?tab=calendar",
    lenses: ["admin", "hr", "executive", "team_lead"],
  };
}

/** More open jobs than people applying in the last 30 days. */
export function thinPipelineRisk(openJobs: number | null, applicants30: number | null): RiskCard | null {
  if (openJobs === null || applicants30 === null || openJobs < 3 || applicants30 >= openJobs) return null;
  return {
    id: "thin-pipeline",
    severity: "info",
    title: `${plural(applicants30, "new applicant", "new applicants")} for ${plural(openJobs, "open job", "open jobs")}`,
    rule: "Fewer applicants in the last 30 days than open jobs. Shown when 3+ jobs are open.",
    href: "/recruiting",
    lenses: ["admin", "hr", "executive", "recruiter"],
  };
}

export function overdueReviewsRisk(count: number): RiskCard | null {
  if (count === 0) return null;
  return {
    id: "reviews-overdue",
    severity: count >= 5 ? "warn" : "info",
    title: `${plural(count, "review is", "reviews are")} past due`,
    rule: "A review whose current step is past its due date in the cycle. Shown while any are left.",
    href: "/reviews",
    lenses: ["admin", "hr", "team_lead"],
  };
}

const ORDER: Record<Severity, number> = { urgent: 0, warn: 1, info: 2 };

/** The cards that belong in a view, most urgent first. */
export function rankRisks(cards: RiskCard[], lens: Lens, limit = 6): RiskCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => card.lenses.includes(lens))
    .sort((a, b) => ORDER[a.card.severity] - ORDER[b.card.severity] || a.index - b.index)
    .slice(0, limit)
    .map(({ card }) => card);
}
