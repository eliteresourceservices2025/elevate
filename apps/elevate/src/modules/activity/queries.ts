import "server-only";
import { fromZonedTime } from "date-fns-tz";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { addDays } from "@/modules/attendance/schedule";
import { personForUser, prefsFor } from "@/modules/attendance/service";
import { reportName, timeDownlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { authorizeForEmployee, requireScope } from "./access";
import { activePercent, summarizeDay, type CategoryRule, type DaySummary } from "./logic";
import { activityCategories, activityShots, trackerDevices } from "./schema";
import { daySchema, deviceListSchema, floorSchema, personDaySchema } from "./validators";

// Reads for the ELEVATE Tracker pages. Every query starts with requireUser(), then checks its permission before touching the database.

const MINUTE = 60_000;
const ONLINE_WITHIN_MS = 5 * MINUTE;

export type ActivityDay = {
  date: string;
  segments: { start: string; end: string; app: string; state: "active" | "idle" }[];
  minutes: { active: number; idle: number; work: number; nonWork: number };
  topApps: DaySummary["topApps"];
  shots: { id: string; takenAt: string }[];
  trackerOnline: boolean;
};

async function loadRules(): Promise<CategoryRule[]> {
  const rows = await db.select().from(activityCategories).where(isNull(activityCategories.archivedAt));
  return rows.map((r) => ({ pattern: r.pattern, category: r.category as "work" | "non_work", rank: r.rank }));
}

async function dayFor(employeeId: string, date: string, withShots: boolean): Promise<ActivityDay> {
  const { zone } = await prefsFor(db, employeeId);
  const dayStart = fromZonedTime(`${date}T00:00:00`, zone).getTime();
  const dayEnd = fromZonedTime(`${addDays(date, 1)}T00:00:00`, zone).getTime();
  const segs = (await db.execute(sql`
    select app, state, (extract(epoch from started_at) * 1000)::float8 as s, (extract(epoch from ended_at) * 1000)::float8 as e
    from time.activity_segments
    where employee_id = ${employeeId} and started_at < to_timestamp(${dayEnd / 1000}) and ended_at > to_timestamp(${dayStart / 1000})
    order by started_at limit 2000`)) as unknown as { app: string; state: "active" | "idle"; s: number; e: number }[];
  const raw = segs.map((r) => ({ start: Math.max(Number(r.s), dayStart), end: Math.min(Number(r.e), dayEnd), app: r.app, state: r.state }));
  const summary = summarizeDay(raw, dayStart, dayEnd, await loadRules());
  const shots = withShots
    ? await db
        .select({ id: activityShots.id, takenAt: activityShots.takenAt })
        .from(activityShots)
        .where(and(eq(activityShots.employeeId, employeeId), sql`${activityShots.finalizedAt} is not null`, isNull(activityShots.purgedAt), sql`${activityShots.takenAt} >= to_timestamp(${dayStart / 1000}) and ${activityShots.takenAt} < to_timestamp(${dayEnd / 1000})`))
        .orderBy(activityShots.takenAt)
        .limit(200)
    : [];
  const [last] = (await db.execute(sql`
    select (extract(epoch from max(s.ended_at)) * 1000)::float8 as ms,
           exists (select 1 from time.tracker_devices d where d.employee_id = ${employeeId} and d.status = 'active') as has_device
    from time.activity_segments s where s.employee_id = ${employeeId}`)) as unknown as { ms: number | null; has_device: boolean }[];
  return {
    date,
    segments: raw.filter((r) => r.end > r.start).map((r) => ({ start: new Date(r.start).toISOString(), end: new Date(r.end).toISOString(), app: r.app, state: r.state })),
    minutes: { active: summary.activeMinutes, idle: summary.idleMinutes, work: summary.workMinutes, nonWork: summary.nonWorkMinutes },
    topApps: summary.topApps,
    shots: shots.map((s) => ({ id: s.id, takenAt: s.takenAt.toISOString() })),
    trackerOnline: Boolean(last?.has_device) && last?.ms != null && Date.now() - Number(last.ms) <= ONLINE_WITHIN_MS,
  };
}

/** The signed-in person's own day. */
export async function getMyDay(input: unknown): Promise<ActivityDay> {
  const user = await requireUser();
  const parsed = daySchema.parse(input);
  await authorize(user, "activity.view_own", { ownerUserId: user.id });
  const person = await personForUser(db, user.id);
  return dayFor(person.id, parsed.date, true);
}

/** One person's day: their own, a team's (time chain) or anyone's, by role. Screenshots only for those who may see them. */
export async function getPersonDay(input: unknown): Promise<ActivityDay> {
  const user = await requireUser();
  requireScope(user, "activity.view");
  const parsed = personDaySchema.parse(input);
  await authorizeForEmployee(user, "activity.view", parsed.employeeId);
  let canShots = true;
  try {
    await authorizeForEmployee(user, "activity.view_shots", parsed.employeeId);
  } catch {
    canShots = false;
  }
  return dayFor(parsed.employeeId, parsed.date, canShots);
}

export type FloorState = "active" | "idle" | "break" | "offline" | "out";
export type FloorRow = { employeeId: string; name: string; state: FloorState; minutesInState: number; activePercentToday: number };

/** Who is doing what right now, for everyone with a tracker (a lead sees their team). At most 200 people. */
export async function listFloor(input: unknown): Promise<FloorRow[]> {
  const user = await requireUser();
  const scope = scopeFor(user, "activity.view");
  if (scope !== "team" && scope !== "all") throw new ForbiddenError("activity.view"); // the floor is for leads and HR, not for one's own day
  const parsed = floorSchema.parse(input);
  const restrict = scope === "team" ? await timeDownlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return [];
  const only = restrict ? sql`and e.id in (${sql.join(restrict.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const team = parsed.teamId ? sql`and e.team_id = ${parsed.teamId}` : sql``;
  const people = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from core.employees e
    where e.archived_at is null and e.status = 'active' ${only} ${team}
      and exists (select 1 from time.tracker_devices d where d.employee_id = e.id and d.status = 'active')
    order by e.legal_last_name, e.legal_first_name limit 200`)) as unknown as { id: string; first: string; last: string; preferred: string | null }[];
  if (people.length === 0) return [];
  const ids = sql.join(people.map((p) => sql`${p.id}`), sql`, `);

  const events = (await db.execute(sql`
    select distinct on (employee_id) employee_id, type, (extract(epoch from occurred_at) * 1000)::float8 as ms
    from time.v_clock_events where employee_id in (${ids}) and occurred_at > now() - interval '3 days'
    order by employee_id, occurred_at desc, created_at desc`)) as unknown as { employee_id: string; type: string; ms: number }[];
  const lastSegs = (await db.execute(sql`
    select distinct on (employee_id) employee_id, state, (extract(epoch from started_at) * 1000)::float8 as s, (extract(epoch from ended_at) * 1000)::float8 as e
    from time.activity_segments where employee_id in (${ids}) and ended_at > now() - interval '1 day'
    order by employee_id, ended_at desc`)) as unknown as { employee_id: string; state: "active" | "idle"; s: number; e: number }[];
  const dayStart = fromZonedTime(`${todayInZone()}T00:00:00`, DEFAULT_TIMEZONE).getTime();
  const totals = (await db.execute(sql`
    select employee_id,
      coalesce(sum(extract(epoch from (least(ended_at, now()) - greatest(started_at, to_timestamp(${dayStart / 1000})))) * 1000) filter (where state = 'active'), 0)::float8 as active_ms,
      coalesce(sum(extract(epoch from (least(ended_at, now()) - greatest(started_at, to_timestamp(${dayStart / 1000})))) * 1000), 0)::float8 as all_ms
    from time.activity_segments where employee_id in (${ids}) and ended_at > to_timestamp(${dayStart / 1000})
    group by employee_id`)) as unknown as { employee_id: string; active_ms: number; all_ms: number }[];

  const now = Date.now();
  const eventBy = new Map(events.map((e) => [e.employee_id, e]));
  const segBy = new Map(lastSegs.map((s) => [s.employee_id, s]));
  const totalBy = new Map(totals.map((t) => [t.employee_id, t]));
  return people.map((p): FloorRow => {
    const ev = eventBy.get(p.id);
    const seg = segBy.get(p.id);
    const t = totalBy.get(p.id);
    let state: FloorState;
    let since: number;
    if (!ev || ev.type === "clock_out") {
      state = "out";
      since = ev ? Number(ev.ms) : now;
    } else if (ev.type === "break_start") {
      state = "break";
      since = Number(ev.ms);
    } else if (seg && now - Number(seg.e) <= ONLINE_WITHIN_MS && Number(seg.e) >= Number(ev.ms) - MINUTE) {
      state = seg.state;
      since = Number(seg.s);
    } else {
      state = "offline";
      since = seg ? Number(seg.e) : Number(ev.ms);
    }
    return {
      employeeId: p.id,
      name: reportName({ first: p.first, last: p.last, preferred: p.preferred }),
      state,
      minutesInState: Math.max(0, Math.round((now - since) / MINUTE)),
      activePercentToday: t ? activePercent(Number(t.active_ms), Number(t.all_ms)) : 0,
    };
  });
}

export async function listCategories() {
  const user = await requireUser();
  await authorize(user, "activity.manage");
  return db.select().from(activityCategories).where(isNull(activityCategories.archivedAt)).orderBy(activityCategories.rank);
}

export type DeviceRow = { id: string; employeeId: string; name: string; os: string; appVersion: string; lastSeenAt: string | null; status: string; permissionsOk: boolean; queueSize: number };

/** A person's computers (their own by default). Another person's, or everyone's, is for HR and Super Admin. */
export async function listDevices(input: unknown): Promise<DeviceRow[]> {
  const user = await requireUser();
  const parsed = deviceListSchema.parse(input);
  let employeeId: string;
  if (parsed.employeeId) {
    await authorize(user, "activity.manage");
    employeeId = parsed.employeeId;
  } else {
    await authorize(user, "tracker.enroll", { ownerUserId: user.id });
    employeeId = (await personForUser(db, user.id)).id;
  }
  const rows = await db.select().from(trackerDevices).where(eq(trackerDevices.employeeId, employeeId)).orderBy(trackerDevices.createdAt).limit(50);
  return rows.map((d) => ({ id: d.id, employeeId: d.employeeId, name: d.name, os: d.os, appVersion: d.appVersion, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, status: d.status, permissionsOk: d.permissionsOk, queueSize: d.queueSize }));
}
