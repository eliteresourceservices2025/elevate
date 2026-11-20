import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CLEAN_FLAGS } from "@/modules/attendance/hours-service";
import { getTeamReview } from "@/modules/attendance/hours-queries";
import { FLAG_LABELS } from "@/modules/attendance/flag-labels";
import { listFlags, listWorkingNow } from "@/modules/attendance/queries";
import { timeDownlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { listGoals, listReviews } from "@/modules/reviews/queries";
import { getTrainingCounts } from "@/modules/learn/queries";
import { countPendingChangeRequests } from "@/modules/people/queries";
import { documentCounts } from "./feed-queries";
import { orFallback } from "./or-fallback";
import { getKpis } from "./queries";
import { flagCounts, percentOf, shapeHrKpis, type HrKpi } from "./manager-math";

// Tiles for the manager views. Each starts with `requireUser()` + `authorize()` (or calls a query that does), returns counts and short
// lines only, and returns null or an empty result when the person has no reach for it; a tile never throws for lack of access.

async function me() {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });
  return user;
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---- Team lead -----------------------------------------------------------------------------------------------------------

export type TeamHours = { rows: { name: string; workedMinutes: number; scheduledMinutes: number; percent: number }[]; people: number; daysWaiting: number };

/** Last week's hours for the lead's team (the week they approve), worst-covered first, and how many finished days still wait for approval. Null for someone who approves no hours. */
export async function getTeamHoursTile(): Promise<TeamHours | null> {
  await me();
  const review = await getTeamReview();
  const days = review.rows.flatMap((r) => r.days);
  return {
    people: review.rows.length,
    daysWaiting: days.filter((d) => d.finished && d.workedMinutes > 0 && d.state !== "approved").length,
    rows: review.rows
      .map((r) => ({ name: r.name, workedMinutes: r.workedMinutes, scheduledMinutes: r.scheduledMinutes, percent: percentOf(r.workedMinutes, r.scheduledMinutes) }))
      .sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name))
      .slice(0, 6),
  };
}

export type ClockedIn = { working: number; onBreak: number; total: number; longOpen: number };

/** How many of the lead's team are clocked in now. Counts only. Null for someone who sees no team attendance. */
export async function getClockedInTile(): Promise<ClockedIn | null> {
  const user = await me();
  const now = await listWorkingNow();
  const total = now.scope === "team" ? (await timeDownlineEmployeeIds(db, user.id)).length : now.rows.length;
  return {
    working: now.rows.filter((r) => r.state === "working").length,
    onBreak: now.rows.filter((r) => r.state === "break").length,
    total: Math.max(total, now.rows.length),
    longOpen: now.rows.filter((r) => r.longOpen).length,
  };
}

/** Days worth a look in the last two weeks, by kind, skipping informational flags. Empty for someone without team attendance. */
export async function getTeamFlagsTile(): Promise<{ label: string; count: number }[]> {
  await me();
  return flagCounts((await listFlags()).rows, FLAG_LABELS, CLEAN_FLAGS);
}

export type ReviewsGoals = { toWrite: number; selfReviews: number; goalsToUpdate: number };

/** Reviews to write, reviews waiting on the team's own self review, and open goals due within two weeks. Counts only, never a name. */
export async function getReviewsGoalsTile(): Promise<ReviewsGoals> {
  await me();
  const soon = addDays(todayInZone(), 14);
  const [reviews, goals] = await Promise.all([listReviews(), listGoals().then((g) => g.goals)]);
  return {
    toWrite: reviews.filter((r) => r.toWrite && r.stage === "awaiting_lead").length,
    selfReviews: reviews.filter((r) => !r.mine && r.stage === "awaiting_self").length,
    goalsToUpdate: goals.filter((g) => !g.mine && (g.status === "not_started" || g.status === "in_progress") && g.targetOn !== null && g.targetOn <= soon).length,
  };
}

// ---- HR ------------------------------------------------------------------------------------------------------------------------

/** The six HR number tiles. One read shared by the six tiles of a page; a source this person may not see arrives as a dash, not a zero. */
export const getHrKpiTiles = cache(async (): Promise<HrKpi[]> => {
  const user = await me();
  const [kpis, offboarding, changeRequests, docs, training] = await Promise.all([
    orFallback(() => getKpis("hr"), []),
    scopeFor(user, "onboarding.view") === "all"
      ? db.execute(sql`select count(*)::int as n from talent.offboarding_cases where status = 'open'`).then((r) => (r as unknown as { n: number }[])[0]?.n ?? 0)
      : Promise.resolve(null),
    orFallback(() => countPendingChangeRequests(), null),
    scopeFor(user, "documents.view_overview") === "all" ? documentCounts(user).then((d) => d.soon) : Promise.resolve(null),
    orFallback(async () => (await getTrainingCounts()).reduce((sum, c) => sum + c.overdue, 0), null),
  ]);
  const byId = new Map(kpis.map((k) => [k.id, k.value]));
  return shapeHrKpis({
    active: byId.get("people") ?? null,
    onboarding: byId.get("onboarding") ?? null,
    offboarding,
    changeRequests,
    docsExpiring: docs,
    trainingOverdue: training,
  });
});
