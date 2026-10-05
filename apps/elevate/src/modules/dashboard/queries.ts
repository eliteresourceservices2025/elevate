import "server-only";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveTimeZone } from "@/lib/time";
import { clockPrefs } from "@/modules/attendance/schema";
import { employees } from "@/modules/people/schema";
import { downlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { listWorkingNow } from "@/modules/attendance/queries";
import { getTeamReview } from "@/modules/attendance/hours-queries";
import { getRecruitingSummary } from "@/modules/recruiting/queries";
import { getApprovalQueue } from "./feed-queries";
import { greetingFor, hourInZone } from "./greeting";
import { orFallback } from "./or-fallback";
import type { Lens } from "./lens";

// ---- Greeting ------------------------------------------------------------------------------------------------------------

export type Greeting = { greeting: string; name: string | null; zone: string; dateLabel: string };

export async function getGreeting(): Promise<Greeting> {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });
  const [row] = await db
    .select({ first: employees.legalFirstName, preferred: employees.preferredName, zone: clockPrefs.timeZone })
    .from(employees)
    .leftJoin(clockPrefs, eq(clockPrefs.employeeId, employees.id))
    .where(eq(employees.userId, user.id))
    .limit(1);
  const zone = resolveTimeZone(row?.zone);
  const now = new Date();
  const name = row ? row.preferred?.trim() || row.first : null;
  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(now);
  return { greeting: greetingFor(hourInZone(now, zone)), name, zone, dateLabel };
}

// ---- Key numbers ---------------------------------------------------------------------------------------------------------

export type Kpi = { id: string; label: string; value: number | null; hint?: string; href: string };

async function countPeople(where: ReturnType<typeof and>): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(employees).where(where);
  return r.n;
}

/** The numbers at the top of a view. Live counts only; every card opens the page it comes from. */
export async function getKpis(lens: Lens): Promise<Kpi[]> {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });
  const today = todayInZone();
  const monthStart = `${today.slice(0, 7)}-01`;
  const directory = scopeFor(user, "analytics.view") === "all";
  const working = await orFallback(async () => (await listWorkingNow()).rows.length, null);

  if (lens === "team_lead") {
    if (scopeFor(user, "attendance.view") !== "team" && scopeFor(user, "attendance.view") !== "all") return [];
    const team = await downlineEmployeeIds(db, user.id);
    const [approvals, review] = await Promise.all([getApprovalQueue().then((x) => x.length), orFallback(async () => (await getTeamReview()).pending, null)]);
    return [
      { id: "team-size", label: "People in my team", value: team.length, href: "/org-chart" },
      { id: "clocked-in", label: "Clocked in now", value: working, href: "/team-attendance" },
      { id: "approvals", label: "Waiting for my decision", value: approvals, href: "#approvals" },
      { id: "hours", label: "Timesheets to approve", value: review, hint: "Last week", href: "/hours-review" },
    ];
  }

  const recruiting = await orFallback(() => getRecruitingSummary(), null);
  const openJobs: Kpi = { id: "open-jobs", label: "Open jobs", value: recruiting?.openJobs ?? null, href: "/recruiting" };
  const applicants: Kpi = { id: "applicants", label: "New applicants", value: recruiting?.applicationsLast30Days ?? null, hint: "Last 30 days", href: "/recruiting" };

  if (lens === "recruiter") {
    // No hiring access means no cards at all, not cards full of dashes.
    if (!recruiting) return [];
    return [
      openJobs,
      applicants,
      { id: "interviewing", label: "In interviews", value: recruiting?.counts.interview ?? null, href: "/recruiting" },
      { id: "offers", label: "Offers out", value: recruiting?.counts.offer ?? null, href: "/recruiting" },
    ];
  }

  if ((lens === "admin" || lens === "hr" || lens === "executive") && directory) {
    const active = and(eq(employees.status, "active"), isNull(employees.archivedAt));
    const [people, onboarding, joined, left] = await Promise.all([
      countPeople(active),
      countPeople(and(eq(employees.status, "onboarding"), isNull(employees.archivedAt))),
      countPeople(and(gte(employees.startDate, monthStart), lte(employees.startDate, today), isNull(employees.archivedAt))),
      countPeople(and(eq(employees.status, "separated"), gte(employees.endDate, monthStart), lte(employees.endDate, today))),
    ]);
    if (lens === "executive") {
      return [
        { id: "people", label: "Active people", value: people, href: "/analytics" },
        { id: "joined", label: "Joined this month", value: joined, href: "/analytics" },
        { id: "left", label: "Left this month", value: left, href: "/analytics" },
        openJobs,
        applicants,
        { id: "hired", label: "Hired", value: recruiting?.hiredLast90Days ?? null, hint: "Last 90 days", href: "/analytics" },
      ];
    }
    const approvals = (await getApprovalQueue()).length;
    return [
      { id: "people", label: "Active people", value: people, href: "/people" },
      { id: "onboarding", label: "In onboarding", value: onboarding, href: "/onboarding" },
      { id: "clocked-in", label: "Clocked in now", value: working, href: "/team-attendance" },
      { id: "approvals", label: "Waiting for my decision", value: approvals, href: "#approvals" },
      openJobs,
      applicants,
    ];
  }

  return [];
}
