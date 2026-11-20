import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { listMyPending } from "@/modules/announcements/queries";
import type { ClockState } from "@/modules/attendance/clock";
import { approvalKey, dayState, latestApprovals } from "@/modules/attendance/hours-service";
import { getClockStatus, getMyTime } from "@/modules/attendance/queries";
import { addDays } from "@/modules/attendance/schedule";
import { todayInZone } from "@/modules/org/service";
import { listGoals } from "@/modules/reviews/queries";
import { getAttention } from "./feed-queries";
import { orFallback } from "./or-fallback";

// The VA's own tiles ("My work"): hours, schedule and to-do. Everything here is about the signed-in person only.

/** One read of a week per request: the Me strip, the hours tile and the schedule tile all need the same week, and each read is heavy. */
const myWeek = cache((weekStart?: string) => getMyTime(weekStart));

async function me() {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });
  return user;
}

// ---- Hours this week -----------------------------------------------------------------------------------------------------

export type MyHours = {
  state: ClockState;
  weekMinutes: number;
  /** Null when the person has no schedule this week. */
  scheduledMinutes: number | null;
  /** Last week's hours, and whether a lead has approved every day that has hours. Null when nothing was worked. */
  lastWeek: { workedMinutes: number; approved: boolean } | null;
};

/** Hours from ELEVATE's own clock (never Jibble): this week so far, the scheduled total, and last week's approval. */
export async function getMyHours(): Promise<MyHours | null> {
  const user = await me();
  const week = await myWeek();
  if (!week) return null;
  const clock = await orFallback(() => getClockStatus(), null);
  const scheduled = week.days.reduce((sum, d) => sum + (d.scheduledMinutes ?? 0), 0);

  let lastWeek: MyHours["lastWeek"] = null;
  const prevStart = addDays(week.weekStart, -7);
  const prev = await myWeek(prevStart);
  const worked = prev?.days.filter((d) => d.workedMinutes > 0) ?? [];
  if (prev && worked.length > 0) {
    const [row] = (await db.execute(sql`select id from core.employees where user_id = ${user.id} limit 1`)) as unknown as { id: string }[];
    const approvals = row ? await latestApprovals(db, [row.id], prevStart, addDays(prevStart, 6)) : new Map();
    const approved = worked.every((d) => dayState({ scheduledMinutes: d.scheduledMinutes, workedMinutes: d.workedMinutes, breakMinutes: d.breakMinutes, extraMinutes: d.extraMinutes, approvedExtraMinutes: d.approvedExtraMinutes }, row ? approvals.get(approvalKey(row.id, d.date)) : undefined) === "approved");
    lastWeek = { workedMinutes: prev.weekMinutes, approved };
  }
  return { state: clock?.state ?? "out", weekMinutes: week.weekMinutes, scheduledMinutes: scheduled > 0 ? scheduled : null, lastWeek };
}

// ---- Schedule ------------------------------------------------------------------------------------------------------------

export type MyScheduleDay = { date: string; label: string; today: boolean; range: string | null; holiday: boolean };
export type MyScheduleTile = { zone: string; client: string | null; clientZone: string | null; clientRange: string | null; days: MyScheduleDay[] };

/** Today and the next two days of the person's schedule, in their own zone (with the client's hours for today). */
export async function getMyScheduleTile(): Promise<MyScheduleTile | null> {
  await me();
  const week = await myWeek();
  if (!week) return null;
  const today = formatInZone(Date.now(), week.zone, "yyyy-MM-dd");
  let days = week.days.filter((d) => d.date >= today);
  let next = null;
  if (days.length < 3) {
    next = await myWeek(addDays(week.weekStart, 7));
    days = [...days, ...(next?.days ?? [])];
  }
  const shown = days.slice(0, 3);
  const hasAnyShift = week.schedule !== null || next?.schedule != null;
  if (!hasAnyShift) return null;
  const first = shown[0];
  return {
    zone: week.zone,
    client: week.schedule?.client ?? null,
    clientZone: first?.shift?.zone ?? null,
    clientRange: first?.date === today ? (first.shift?.clientRange ?? null) : null,
    days: shown.map((d) => ({ date: d.date, label: d.date === today ? "Today" : d.weekday, today: d.date === today, range: d.shift?.range ?? null, holiday: d.holiday })),
  };
}

// ---- To-do ---------------------------------------------------------------------------------------------------------------

export type TodoItem = { id: string; kind: "training" | "goal" | "policy" | "task"; title: string; detail: string | null; href: string; overdue: boolean };

/** One short list: things waiting for the person in training, goals, policies and reviews. Counts and wording only. */
export async function getMyTodo(): Promise<{ items: TodoItem[]; total: number }> {
  const user = await me();
  const today = todayInZone();
  const soon = addDays(today, 14);

  const [attention, pending, training, goals] = await Promise.all([
    orFallback(() => getAttention("my_work"), []),
    orFallback(() => listMyPending(), []),
    db
      .execute(sql`
        select a.id::text as id, c.title, a.due_on::text as due_on
        from learn.assignments a join learn.courses c on c.id = a.course_id
        where a.user_id = ${user.id} and a.status in ('assigned', 'in_progress')
        order by a.due_on nulls last limit 5`)
      .then((r) => r as unknown as { id: string; title: string; due_on: string | null }[])
      .catch(() => []),
    orFallback(async () => (await listGoals()).goals.filter((g) => g.mine && (g.status === "not_started" || g.status === "in_progress") && g.targetOn !== null && g.targetOn <= soon), []),
  ]);

  const items: TodoItem[] = [
    ...attention.map((a): TodoItem => ({ id: `a-${a.id}`, kind: "task", title: a.title, detail: a.detail ?? null, href: a.href, overdue: a.severity !== "info" })),
    ...training.map((t): TodoItem => ({ id: `t-${t.id}`, kind: "training", title: `${t.title} training`, detail: t.due_on ? (t.due_on < today ? "Overdue" : `Due ${t.due_on}`) : null, href: "/learn", overdue: t.due_on !== null && t.due_on < today })),
    ...pending.map((p): TodoItem => ({ id: `p-${p.kind}-${p.versionId ?? p.id}`, kind: "policy", title: p.kind === "policy" ? `Acknowledge ${p.title}` : `Read ${p.title}`, detail: p.dueOn ? `Due ${p.dueOn}` : null, href: p.link, overdue: p.due === "overdue" })),
    ...goals.map((g): TodoItem => ({ id: `g-${g.id}`, kind: "goal", title: `Update goal: ${g.title}`, detail: g.targetOn ? `Target ${g.targetOn}` : null, href: "/reviews/goals", overdue: g.targetOn !== null && g.targetOn < today })),
  ];
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue));
  // Nothing waiting is ever hidden: the tile scrolls inside itself instead of cutting the list.
  return { items: items.slice(0, 40), total: items.length };
}
