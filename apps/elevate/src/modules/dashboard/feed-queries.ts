import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listCorrectionQueue, listWorkingNow } from "@/modules/attendance/queries";
import { listExtraHoursQueue } from "@/modules/attendance/extra-hours-queries";
import { getTeamReview } from "@/modules/attendance/hours-queries";
import { jobHealth } from "@/modules/health/service";
import { listMyTasks } from "@/modules/onboarding/queries";
import { downlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { countPendingChangeRequests } from "@/modules/people/queries";
import { listReviews } from "@/modules/reviews/queries";
import { getTeamCalendar, listApprovalQueue } from "@/modules/timeoff/request-queries";
import { byWaiting, correctionItem, extraHoursItem, timeOffItem, type QueueItem } from "./approvals";
import { plural, rankAttention, type AttentionItem } from "./attention";
import type { Lens } from "./lens";
import { orFallback } from "./or-fallback";
import { monthsTouched, weekAhead, type DayOut } from "./week-ahead";

async function me() {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });
  return user;
}

// ---- Approval queue ------------------------------------------------------------------------------------------------------

/** Everything waiting for THIS person to decide, oldest first. Each source applies its own rule about who may decide what. */
export const getApprovalQueue = cache(async (): Promise<QueueItem[]> => {
  await me();
  const [timeOff, corrections, extra] = await Promise.all([
    orFallback(async () => (await listApprovalQueue()).items.filter((r) => r.canDecide).map(timeOffItem), [] as QueueItem[]),
    orFallback(async () => (await listCorrectionQueue()).items.filter((c) => c.canDecide).map(correctionItem), [] as QueueItem[]),
    orFallback(async () => (await listExtraHoursQueue()).pending.filter((x) => x.canDecide).map(extraHoursItem), [] as QueueItem[]),
  ]);
  return [...timeOff, ...corrections, ...extra].sort(byWaiting);
});

// ---- Needs attention -----------------------------------------------------------------------------------------------------

/**
 * What needs a person's eyes now, from the pages that already know. Counts and wording only: never a name, a reason or a
 * private detail. Safe Voice is deliberately NOT here: its in-app notice is hourly and batched so the time a report arrived
 * cannot be read off a live counter.
 */
export async function getAttention(lens: Lens): Promise<AttentionItem[]> {
  const user = await me();
  const items: AttentionItem[] = [];
  const add = (item: AttentionItem) => items.push(item);

  const [working, review, changes, tasks, reviews, jobs, onboarding, expiring] = await Promise.all([
    orFallback(async () => (await listWorkingNow()).rows, []),
    orFallback(async () => (await getTeamReview()).pending, 0),
    orFallback(() => countPendingChangeRequests(), 0),
    orFallback(() => listMyTasks(), []),
    orFallback(() => listReviews(), []),
    scopeFor(user, "health.view") ? orFallback(() => jobHealth(), []) : Promise.resolve([]),
    orgOnboardingCounts(user.id),
    documentCounts(user),
  ]);

  const longOpen = working.filter((w) => w.longOpen).length;
  if (longOpen > 0) add({ id: "long-open", severity: "urgent", title: `${plural(longOpen, "person has", "people have")} been clocked in for over 12 hours`, detail: "Check for a missed clock-out.", href: "/team-attendance", lenses: ["admin", "hr", "team_lead"] });
  const offline = working.filter((w) => w.possiblyOffline).length;
  if (offline > 0) add({ id: "offline", severity: "info", title: `${plural(offline, "person is", "people are")} possibly offline`, detail: "Clocked in, but nothing heard for 10+ minutes.", href: "/team-attendance", lenses: ["admin", "hr", "team_lead"] });
  const outside = working.filter((w) => w.outsideRange).length;
  if (outside > 0) add({ id: "outside-range", severity: "info", title: `${plural(outside, "person", "people")} clocked in from outside the allowed network`, href: "/team-attendance", lenses: ["admin", "hr", "team_lead"] });

  if (review > 0) add({ id: "timesheets", severity: "warn", title: `${plural(review, "timesheet is", "timesheets are")} waiting for approval`, detail: "Last week's hours.", href: "/hours-review", lenses: ["admin", "hr", "team_lead"] });
  if (changes > 0) add({ id: "change-requests", severity: "warn", title: `${plural(changes, "profile change request", "profile change requests")} waiting`, href: "/people/requests", lenses: ["admin", "hr"] });

  if (onboarding.overdueTasks > 0) add({ id: "onboarding-overdue", severity: "warn", title: `${plural(onboarding.overdueTasks, "required onboarding or offboarding task is", "required onboarding or offboarding tasks are")} overdue`, href: "/onboarding", lenses: ["admin", "hr", "team_lead"] });
  if (onboarding.leavingSoon > 0) add({ id: "leaving-soon", severity: "info", title: `${plural(onboarding.leavingSoon, "person", "people")} ${onboarding.leavingSoon === 1 ? "has" : "have"} a last working day in the next 3 days`, href: "/offboarding", lenses: ["admin", "hr", "team_lead"] });
  if (expiring.expired > 0) add({ id: "docs-expired", severity: "warn", title: `${plural(expiring.expired, "document has", "documents have")} expired`, href: "/documents", lenses: ["admin", "hr"] });
  if (expiring.soon > 0) add({ id: "docs-soon", severity: "info", title: `${plural(expiring.soon, "document expires", "documents expire")} in the next 30 days`, href: "/documents", lenses: ["admin", "hr"] });

  const lateJobs = jobs.filter((j) => j.state === "late" || j.state === "failing").length;
  if (lateJobs > 0) add({ id: "jobs-late", severity: "urgent", title: `${plural(lateJobs, "background job is", "background jobs are")} late or failing`, detail: "Scheduled work such as the nightly hours rebuild may not have run.", href: "/attendance?tab=health", lenses: ["admin", "hr"] });

  const overdueTasks = tasks.filter((t) => t.overdue).length;
  if (overdueTasks > 0) add({ id: "my-tasks", severity: "warn", title: `${plural(overdueTasks, "of your tasks is", "of your tasks are")} overdue`, href: "/onboarding", lenses: ["my_work", "admin", "hr", "team_lead"] });
  const toWrite = reviews.filter((r) => r.toWrite && r.stage === "awaiting_lead").length;
  if (toWrite > 0) add({ id: "reviews-to-write", severity: reviews.some((r) => r.toWrite && r.overdue) ? "warn" : "info", title: `${plural(toWrite, "review is", "reviews are")} waiting for you to write`, href: "/reviews", lenses: ["my_work", "admin", "hr", "team_lead"] });
  const selfDue = reviews.filter((r) => r.mine && r.stage === "awaiting_self").length;
  if (selfDue > 0) add({ id: "self-review", severity: "info", title: selfDue === 1 ? "Your self review is waiting" : `${selfDue} self reviews are waiting`, href: "/reviews", lenses: ["my_work", "admin", "hr", "team_lead", "executive", "recruiter"] });

  return rankAttention(items, lens);
}

/** Overdue required checklist tasks on open cases and people whose last day is within 3 days, for HR (everyone) or a lead (their downline). */
async function orgOnboardingCounts(userId: string): Promise<{ overdueTasks: number; leavingSoon: number }> {
  const user = await requireUser();
  const scope = scopeFor(user, "onboarding.view");
  if (scope !== "all" && scope !== "team") return { overdueTasks: 0, leavingSoon: 0 };
  const today = todayInZone();
  const ids = scope === "team" ? await downlineEmployeeIds(db, userId) : null;
  if (ids && ids.length === 0) return { overdueTasks: 0, leavingSoon: 0 };
  const restrict = ids ? sql`and t.employee_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  const [t] = (await db.execute(sql`
    select count(*)::int as n from talent.checklist_tasks t
    where t.status = 'todo' and t.required and t.due_on < ${today}::date ${restrict}
      and (exists (select 1 from talent.onboarding_cases c where c.id = t.onboarding_case_id and c.status = 'open')
        or exists (select 1 from talent.offboarding_cases c where c.id = t.offboarding_case_id and c.status = 'open'))`)) as unknown as { n: number }[];
  const restrictOff = ids ? sql`and c.employee_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 3);
  const [o] = (await db.execute(sql`
    select count(*)::int as n from talent.offboarding_cases c
    where c.status = 'open' and c.access_removed_at is null and c.last_working_day between ${today}::date and ${soon.toISOString().slice(0, 10)}::date ${restrictOff}`)) as unknown as { n: number }[];
  return { overdueTasks: t?.n ?? 0, leavingSoon: o?.n ?? 0 };
}

/** Documents past their expiry date or expiring within 30 days, counted for HR only. */
async function documentCounts(user: { id: string; roles: readonly import("@/lib/roles").RoleSlug[] }): Promise<{ expired: number; soon: number }> {
  if (scopeFor(user, "documents.view_overview") !== "all") return { expired: 0, soon: 0 };
  const today = todayInZone();
  const later = new Date(`${today}T00:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 30);
  const [r] = (await db.execute(sql`
    select count(*) filter (where expires_on < ${today}::date)::int as expired,
           count(*) filter (where expires_on >= ${today}::date and expires_on <= ${later.toISOString().slice(0, 10)}::date)::int as soon
    from docs.documents where status = 'active' and archived_at is null and expires_on is not null`)) as unknown as { expired: number; soon: number }[];
  return { expired: r?.expired ?? 0, soon: r?.soon ?? 0 };
}

// ---- Who is out ----------------------------------------------------------------------------------------------------------

export type WhosOut = { days: DayOut[]; mode: "all" | "team" | "peers" | "counts"; anniversaries: { name: string; years: number; date: string }[] };

/** The next week: who is out (as much as this person may see), holidays, and work anniversaries for HR and leads. */
export async function getWhosOut(): Promise<WhosOut | null> {
  const user = await me();
  const today = todayInZone();
  const views = await orFallback(async () => Promise.all(monthsTouched(today, 7).map((m) => getTeamCalendar(m))), null);
  if (!views) return null;
  const days = weekAhead(views, today, 7);

  const scope = scopeFor(user, "people.view_profile");
  let anniversaries: WhosOut["anniversaries"] = [];
  if (scope === "all" || scope === "team") {
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const ids = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
    if (!ids || ids.length > 0) {
      const restrict = ids ? sql`and e.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
      const rows = (await db.execute(sql`
        select e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, e.start_date::text as start_date
        from core.employees e
        where e.archived_at is null and e.status = 'active' and e.start_date is not null and e.start_date < ${today}::date ${restrict}`)) as unknown as { first: string; last: string; preferred: string | null; start_date: string }[];
      const wanted = new Set<string>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        wanted.add(d.toISOString().slice(0, 10));
      }
      anniversaries = rows
        .flatMap((r) => {
          const md = r.start_date.slice(5);
          const hit = [...wanted].find((w) => w.slice(5) === md);
          const years = hit ? Number(hit.slice(0, 4)) - Number(r.start_date.slice(0, 4)) : 0;
          return hit && years >= 1 ? [{ name: `${r.preferred?.trim() || r.first} ${r.last}`, years, date: hit }] : [];
        })
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
        .slice(0, 6);
    }
  }
  return { days, mode: views[0].mode, anniversaries };
}

