import "server-only";
import { eq, sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { timeChainUserIds, timeDownlineEmployeeIds, reportName } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { MAKEUP_DAYS_BACK, MAKEUP_MIN_MINUTES, shortfallMinutes } from "./makeup";
import { addDays } from "./schedule";
import { expectedMinutesByDay } from "./makeup-service";
import { loadEffectiveSchedules } from "./schedule-service";
import { prefsFor } from "./service";

// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

export type MakeupItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  absenceDate: string;
  missedMinutes: number;
  windowStart: string;
  windowEnd: string;
  minutes: number;
  reason: string;
  status: string;
  decisionNote: string | null;
  /** Minutes worked inside the window so far (kept to the missed time). */
  madeUpMinutes: number;
  createdAt: string;
  /** The signed-in person may approve or decline it now. */
  canDecide: boolean;
  canCancel: boolean;
};

type Raw = {
  id: string; employee_id: string; user_id: string | null; first: string; last: string; preferred: string | null; absence_date: string; missed_minutes: number;
  ws: number; we: number; minutes: number; reason: string; status: string; decision_note: string | null; made_up_minutes: number; created_at: string | Date;
};

const SELECT = sql`
  select r.id, r.employee_id, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, r.absence_date::text as absence_date, r.missed_minutes,
         (extract(epoch from r.window_start) * 1000)::float8 as ws, (extract(epoch from r.window_end) * 1000)::float8 as we,
         r.minutes, r.reason, r.status, r.decision_note, r.made_up_minutes, r.created_at
  from time.makeup_requests r join core.employees e on e.id = r.employee_id`;

async function toItems(rows: Raw[], viewerUserId: string, viewerScope: "all" | "team" | null): Promise<MakeupItem[]> {
  const now = Date.now();
  const items: MakeupItem[] = [];
  for (const r of rows) {
    const mine = r.user_id === viewerUserId;
    let allowed = false;
    if (viewerScope === "all") allowed = true;
    else if (viewerScope === "team") allowed = (await timeChainUserIds(db, r.employee_id)).includes(viewerUserId);
    const waiting = r.status === "pending";
    items.push({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: mine ? "You" : reportName({ first: r.first, last: r.last, preferred: r.preferred }),
      absenceDate: r.absence_date,
      missedMinutes: Number(r.missed_minutes),
      windowStart: new Date(Number(r.ws)).toISOString(),
      windowEnd: new Date(Number(r.we)).toISOString(),
      minutes: Number(r.minutes),
      reason: r.reason,
      status: r.status,
      decisionNote: r.decision_note,
      madeUpMinutes: Number(r.made_up_minutes),
      createdAt: new Date(r.created_at).toISOString(),
      canDecide: waiting && !mine && allowed,
      canCancel: (mine || allowed) && (waiting || (r.status === "approved" && Number(r.ws) > now)),
    });
  }
  return items;
}

/** A missed day the person can still make up, and how many minutes of it are not yet asked for. */
export type MakeableDay = { date: string; missedMinutes: number; leftMinutes: number };

export type MyMakeup = { zone: string; days: MakeableDay[]; items: MakeupItem[] };

/** The signed-in person's make-up hours: the missed days they can still make up (last 31 days) and their requests. Null without a people record. */
export async function getMyMakeup(): Promise<MyMakeup | null> {
  const user = await requireUser();
  await authorize(user, "makeup.request", { ownerUserId: user.id });
  const [me] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id)).limit(1);
  if (!me) return null;
  const prefs = await prefsFor(db, me.id);
  const today = formatInZone(Date.now(), prefs.zone, "yyyy-MM-dd");
  const from = addDays(today, -MAKEUP_DAYS_BACK);
  const schedules = await loadEffectiveSchedules(db, me.id);
  const worked = (await db.execute(sql`select date::text as date, worked_minutes from time.attendance_days where employee_id = ${me.id} and date between ${from}::date and ${today}::date`)) as unknown as { date: string; worked_minutes: number }[];
  const workedBy = new Map(worked.map((w) => [w.date, Number(w.worked_minutes)]));
  const live = (await db.execute(sql`select absence_date::text as date, coalesce(sum(minutes), 0)::int as asked from time.makeup_requests where employee_id = ${me.id} and status in ('pending', 'approved') and absence_date >= ${from}::date group by absence_date`)) as unknown as { date: string; asked: number }[];
  const askedBy = new Map(live.map((l) => [l.date, Number(l.asked)]));
  const expected = await expectedMinutesByDay(db, me.id, prefs.zone, from, addDays(today, -1), schedules);
  const days: MakeableDay[] = [];
  for (let date = addDays(today, -1); date >= from; date = addDays(date, -1)) {
    const missed = shortfallMinutes(expected.get(date) ?? null, workedBy.get(date) ?? 0);
    const left = missed - (askedBy.get(date) ?? 0);
    if (missed >= MAKEUP_MIN_MINUTES && left >= MAKEUP_MIN_MINUTES) days.push({ date, missedMinutes: missed, leftMinutes: left });
  }
  const rows = (await db.execute(sql`${SELECT} where r.employee_id = ${me.id} order by r.window_start desc limit 40`)) as unknown as Raw[];
  return { zone: prefs.zone, days, items: await toItems(rows, user.id, null) };
}

/** Requests waiting for the signed-in lead (their team) or HR (everyone), and the last two weeks of decided ones. */
export async function listMakeupQueue(): Promise<{ pending: MakeupItem[]; recent: MakeupItem[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "makeup.decide");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("makeup.decide");
  const restrict = scope === "team" ? await timeDownlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { pending: [], recent: [], scope };
  const filter = restrict ? sql`and r.employee_id in (${list(restrict)})` : sql``;
  const pending = (await db.execute(sql`${SELECT} where r.status = 'pending' ${filter} order by r.window_start limit 100`)) as unknown as Raw[];
  const recent = (await db.execute(sql`${SELECT} where r.status in ('approved', 'declined', 'cancelled') and r.created_at > now() - interval '14 days' ${filter} order by r.window_start desc limit 100`)) as unknown as Raw[];
  return { pending: await toItems(pending, user.id, scope), recent: await toItems(recent, user.id, scope), scope };
}
