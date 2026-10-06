import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDashboard as getAnalytics } from "@/modules/analytics/queries";
import type { Breakdown } from "@/modules/analytics/view";
import { getHoursSettings } from "@/modules/attendance/hours-queries";
import { getRecruitingSummary } from "@/modules/recruiting/queries";
import { listReviews } from "@/modules/reviews/queries";
import { getTeamCalendar } from "@/modules/timeoff/request-queries";
import { downlineEmployeeIds, reportName, todayInZone } from "@/modules/org/service";
import type { Lens } from "./lens";
import { orFallback } from "./or-fallback";
import { attendanceRisk, crowdedDayRisk, netLossRisk, overdueReviewsRisk, payrollRisks, rankRisks, rateTrend, thinPipelineRisk, type RiskCard } from "./risks";
import { orderCases, type TrackerCase } from "./tracker";
import { monthsTouched, weekAhead } from "./week-ahead";

/** One read of the nightly summaries for the whole page (the warnings and the workforce panel both use it). People half only: no hiring funnel. */
const analyticsForHome = cache(() => orFallback(() => getAnalytics({ range: 12 }, { hiring: false }), null));

async function me() {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });
  return user;
}

const idList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

// ---- Early warnings ------------------------------------------------------------------------------------------------------

export type Risks = { cards: RiskCard[]; ready: boolean };

/** Team and operations warnings from the nightly summaries and live counts. Hidden-for-small-groups numbers stay hidden: a trend needs every week visible. */
export async function getRisks(lens: Lens): Promise<Risks> {
  await me();
  if (lens === "my_work") return { cards: [], ready: true };
  const today = todayInZone();
  const wantsPeople = lens !== "recruiter";

  const analytics = wantsPeople ? await analyticsForHome() : null;
  const [recruiting, hours, calendar, reviews] = await Promise.all([
    orFallback(() => getRecruitingSummary(), null),
    lens === "admin" || lens === "hr" ? orFallback(() => getHoursSettings(), null) : Promise.resolve(null),
    wantsPeople ? orFallback(async () => Promise.all(monthsTouched(today, 14).map((m) => getTeamCalendar(m))), null) : Promise.resolve(null),
    lens === "executive" || lens === "recruiter" ? Promise.resolve([]) : orFallback(() => listReviews(), []),
  ]);

  const cards: RiskCard[] = [];
  const asOf = analytics?.asOf ?? null;
  const people = analytics?.people ?? null;
  if (asOf && people && !people.hidden) {
    for (const [key, kind] of [["lateRate", "late"], ["absentRate", "absent"]] as const) {
      const card = attendanceRisk(rateTrend(people.attendance, key, asOf), kind);
      if (card) cards.push(card);
    }
    const loss = netLossRisk(people.movement);
    if (loss) cards.push(loss);
  }
  if (hours) cards.push(...payrollRisks(hours.periods, hours.progress, today));
  if (calendar) {
    const days = weekAhead(calendar, today, 14).map((d) => ({ date: d.date, count: d.count }));
    const crowded = crowdedDayRisk(days, people?.headcountNow ?? null);
    if (crowded) cards.push(crowded);
  }
  const thin = thinPipelineRisk(recruiting?.openJobs ?? null, recruiting?.applicationsLast30Days ?? null);
  if (thin) cards.push(thin);
  const overdue = overdueReviewsRisk(reviews.filter((r) => !r.mine && r.overdue).length);
  if (overdue) cards.push(overdue);

  // "Ready" once the nightly summaries exist; before the first night there is no history to compare.
  return { cards: rankRisks(cards, lens), ready: wantsPeople ? asOf !== null : true };
}

// ---- Onboarding and offboarding tracker ----------------------------------------------------------------------------------

export type Tracker = { onboarding: TrackerCase[]; onboardingTotal: number; offboarding: TrackerCase[]; offboardingTotal: number };

type CaseRaw = { id: string; first: string; last: string; preferred: string | null; position: string | null; date: string; done: number; total: number; overdue: number; access_removed: boolean };

/** Open onboarding and offboarding cases with task progress, for HR (everyone) and a lead (their downline). Overdue first, then soonest. */
export async function getTracker(): Promise<Tracker | null> {
  const user = await me();
  const scope = scopeFor(user, "onboarding.view");
  const offScope = scopeFor(user, "offboarding.view");
  if ((scope !== "all" && scope !== "team") || (offScope !== "all" && offScope !== "team")) return null;
  const today = todayInZone();
  const ids = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (ids && ids.length === 0) return { onboarding: [], onboardingTotal: 0, offboarding: [], offboardingTotal: 0 };
  const only = ids ? sql`and e.id in (${idList(ids)})` : sql``;

  const on = (await db.execute(sql`
    select c.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, e.position, coalesce(c.start_date::text, '') as date,
           count(t.id)::int as total, (count(t.id) filter (where t.status <> 'todo'))::int as done,
           (count(t.id) filter (where t.status = 'todo' and t.required and t.due_on < ${today}::date))::int as overdue, false as access_removed
    from talent.onboarding_cases c join core.employees e on e.id = c.employee_id
    left join talent.checklist_tasks t on t.onboarding_case_id = c.id
    where c.status = 'open' ${only}
    group by c.id, e.id order by c.start_date nulls last limit 300`)) as unknown as CaseRaw[];
  const off = (await db.execute(sql`
    select c.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, e.position, c.last_working_day::text as date,
           count(t.id)::int as total, (count(t.id) filter (where t.status <> 'todo'))::int as done,
           (count(t.id) filter (where t.status = 'todo' and t.required and t.due_on < ${today}::date))::int as overdue, (c.access_removed_at is not null) as access_removed
    from talent.offboarding_cases c join core.employees e on e.id = c.employee_id
    left join talent.checklist_tasks t on t.offboarding_case_id = c.id
    where c.status = 'open' ${only}
    group by c.id, e.id order by c.last_working_day limit 300`)) as unknown as CaseRaw[];

  const map = (r: CaseRaw): TrackerCase => ({
    id: r.id,
    name: reportName({ first: r.first, last: r.last, preferred: r.preferred }),
    position: r.position,
    date: r.date,
    done: r.done,
    total: r.total,
    overdue: r.overdue,
    accessRemoved: r.access_removed,
  });
  return { onboarding: orderCases(on.map(map)), onboardingTotal: on.length, offboarding: orderCases(off.map(map)), offboardingTotal: off.length };
}

// ---- Workforce overview --------------------------------------------------------------------------------------------------

export type Workforce = {
  asOf: string;
  headcountNow: number | null;
  /** Month-end headcount for the last 12 months; null where the group was too small to show. */
  trend: { date: string; headcount: number | null }[];
  teams: Breakdown | null;
  clients: Breakdown | null;
  scopeLabel: string;
};

/** Headcount over time and how people are spread across teams and clients, from the nightly summaries (small groups already merged or hidden). */
export async function getWorkforce(): Promise<Workforce | null> {
  await me();
  const dash = await analyticsForHome();
  if (!dash || !dash.asOf || !dash.people || dash.people.hidden) return null;
  return {
    asOf: dash.asOf,
    headcountNow: dash.people.headcountNow,
    trend: dash.people.headcount,
    teams: dash.teams,
    clients: dash.clients,
    scopeLabel: dash.scope.label,
  };
}

