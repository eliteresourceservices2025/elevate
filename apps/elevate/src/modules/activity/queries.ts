import "server-only";
import { fromZonedTime } from "date-fns-tz";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { addDays } from "@/modules/attendance/schedule";
import { monitoringPolicyPublished, personForUser, prefsFor } from "@/modules/attendance/service";
import { reportName, timeDownlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { authorizeForEmployee, requireScope } from "./access";
import { isNewer, parseVersion } from "./releases-logic";
import { latestPublishedVersion } from "./releases-service";
import { workingBetween } from "./flags";
import { activePercent, summarizeDay, type CategoryRule, type DaySummary } from "./logic";
import { activityCategories, activitySettings, activityShots, trackerDevices } from "./schema";
import { allDevicesSchema, daySchema, deviceListSchema, floorSchema, personDaySchema } from "./validators";

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
  /** Clocked-in time (breaks left out) inside the day, as a faint underlay on the timeline. */
  working: { start: string; end: string }[];
  /** The zone the day is in: the person's own. */
  zone: string;
  /** The day's start and end (ms since the epoch) in that zone, for laying out the timeline. */
  dayStart: number;
  dayEnd: number;
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
    working: (await workingBetween(employeeId, dayStart, dayEnd)).map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })),
    zone,
    dayStart,
    dayEnd,
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

export type PersonDay = ActivityDay & {
  person: { name: string; team: string | null };
  /** True when the viewer is looking at their own day. */
  own: boolean;
  /** Whether the viewer may open this person's screenshots (the list is empty when not). */
  canShots: boolean;
  viewerZone: string;
  today: string;
};

/** One person's day: their own, a team's (time chain) or anyone's, by role. Screenshots only for those who may see them. */
export async function getPersonDay(input: unknown): Promise<PersonDay> {
  const user = await requireUser();
  requireScope(user, "activity.view");
  const parsed = personDaySchema.parse(input);
  const { ownerUserId } = await authorizeForEmployee(user, "activity.view", parsed.employeeId);
  let canShots = true;
  try {
    await authorizeForEmployee(user, "activity.view_shots", parsed.employeeId);
  } catch {
    canShots = false;
  }
  const { zone } = await prefsFor(db, parsed.employeeId);
  const today = formatInZone(Date.now(), zone, "yyyy-MM-dd");
  const date = parsed.date && parsed.date <= today ? parsed.date : today;
  const [who] = (await db.execute(sql`
    select e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, t.name as team
    from core.employees e left join core.teams t on t.id = e.team_id where e.id = ${parsed.employeeId}`)) as unknown as { first: string; last: string; preferred: string | null; team: string | null }[];
  let viewerZone = DEFAULT_TIMEZONE;
  try {
    viewerZone = (await prefsFor(db, (await personForUser(db, user.id)).id)).zone;
  } catch {
    // The viewer has no people record: the company zone.
  }
  const day = await dayFor(parsed.employeeId, date, canShots);
  return { ...day, person: { name: reportName({ first: who.first, last: who.last, preferred: who.preferred }), team: who.team }, own: ownerUserId === user.id, canShots, viewerZone, today };
}

export type FloorState = "active" | "idle" | "break" | "offline" | "out";
export type FloorRow = { employeeId: string; name: string; state: FloorState; minutesInState: number; activePercentToday: number; teamName: string | null; lastSeenMinutes: number | null };

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
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, t.name as team_name
    from core.employees e
    left join core.teams t on t.id = e.team_id
    where e.archived_at is null and e.status = 'active' ${only} ${team}
      and exists (select 1 from time.tracker_devices d where d.employee_id = e.id and d.status = 'active')
    order by e.legal_last_name, e.legal_first_name limit 200`)) as unknown as { id: string; first: string; last: string; preferred: string | null; team_name: string | null }[];
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
      teamName: p.team_name,
      lastSeenMinutes: seg ? Math.max(0, Math.round((now - Number(seg.e)) / MINUTE)) : null,
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

export type ActivitySettingsView = { idleTimeoutSeconds: number; offlineGraceMinutes: number; lowActivityPercent: number; updatedAt: string | null };

/** The company-wide thresholds (defaults when nobody has saved any). */
export async function getActivitySettings(): Promise<ActivitySettingsView> {
  const user = await requireUser();
  await authorize(user, "activity.manage");
  const [row] = await db.select().from(activitySettings).where(eq(activitySettings.scope, "default")).limit(1);
  return {
    idleTimeoutSeconds: row?.idleTimeoutSeconds ?? 180,
    offlineGraceMinutes: row?.offlineGraceMinutes ?? 5,
    lowActivityPercent: row?.lowActivityPercent ?? 30,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export type ShotViewRow = { viewer: string; day: string; reason: string; count: number };

/** Who looked at the signed-in person's screenshots in the last 30 days (grouped by viewer, day and reason). Their own views are left out. */
export async function listMyShotViews(): Promise<ShotViewRow[]> {
  const user = await requireUser();
  await authorize(user, "activity.view_own", { ownerUserId: user.id });
  const person = await personForUser(db, user.id);
  const rows = (await db.execute(sql`
    select coalesce(nullif(trim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), a.actor_email, 'Someone') as viewer,
           to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD') as day,
           a.metadata->>'reason' as reason,
           count(*)::int as n
    from ops.audit_log a
    left join core.employees e on e.user_id = a.actor_user_id
    where a.action = 'activity.shot_view'
      and a.metadata->>'employeeId' = ${person.id}
      and a.actor_user_id is distinct from ${user.id}
      and a.occurred_at > now() - interval '30 days'
    group by 1, 2, 3
    order by day desc, viewer
    limit 50`)) as unknown as { viewer: string; day: string; reason: string; n: number }[];
  return rows.map((r) => ({ viewer: r.viewer, day: r.day, reason: r.reason, count: r.n }));
}

export type MyDayCardData = { date: string; today: string; policy: boolean; hasDevice: boolean; zone: string; day: ActivityDay | null; views: ShotViewRow[]; devices: DeviceRow[] };

/** Everything the "My day" card shows. Nothing is read unless a monitoring policy is published (the tracker is off before that). */
export async function getMyDayCard(input: unknown): Promise<MyDayCardData> {
  const user = await requireUser();
  await authorize(user, "activity.view_own", { ownerUserId: user.id });
  const person = await personForUser(db, user.id);
  const { zone } = await prefsFor(db, person.id);
  // A missing, malformed or future day becomes today (in the person's own zone).
  const today = formatInZone(Date.now(), zone, "yyyy-MM-dd");
  const asked = daySchema.safeParse(input);
  const date = asked.success && asked.data.date <= today ? asked.data.date : today;
  if (!(await monitoringPolicyPublished(db))) return { date, today, policy: false, hasDevice: false, zone, day: null, views: [], devices: [] };
  const devices = await db.select().from(trackerDevices).where(and(eq(trackerDevices.employeeId, person.id), eq(trackerDevices.status, "active"))).orderBy(trackerDevices.createdAt).limit(10);
  const rows: DeviceRow[] = devices.map((d) => ({ id: d.id, employeeId: d.employeeId, name: d.name, os: d.os, appVersion: d.appVersion, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, status: d.status, permissionsOk: d.permissionsOk, queueSize: d.queueSize }));
  if (rows.length === 0) return { date, today, policy: true, hasDevice: false, zone, day: null, views: [], devices: [] };
  return { date, today, policy: true, hasDevice: true, zone, day: await dayFor(person.id, date, true), views: await listMyShotViews(), devices: rows };
}

export type FleetRow = DeviceRow & { person: string; behind: boolean };

/**
 * Every computer, for HR and Super Admin. "attention" = still signed in and (permission missing, or silent for a day or more, or a
 * backlog of more than 100 waiting uploads, or an app version older than the newest published release). `behind` is only true for a
 * version we can read (a computer reporting 0.0.0-sim is not "behind"). Paged in the database.
 */
export async function listAllDevices(input: unknown): Promise<{ rows: FleetRow[]; total: number; page: number; pageSize: number; latestVersion: string | null }> {
  const user = await requireUser();
  await authorize(user, "activity.manage");
  const { filter, page: asked, pageSize } = allDevicesSchema.parse(input ?? {});
  const latest = await latestPublishedVersion();
  const behindSql = latest
    ? sql`(d.app_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$' and string_to_array(d.app_version, '.')::int[] < string_to_array(${latest}, '.')::int[])`
    : sql`false`;
  const where = filter === "attention"
    ? sql`where d.status = 'active' and (d.permissions_ok = false or d.last_seen_at is null or d.last_seen_at < now() - interval '1 day' or d.queue_size > 100 or ${behindSql})`
    : sql``;
  const [count] = (await db.execute(sql`select count(*)::int as n from time.tracker_devices d ${where}`)) as unknown as { n: number }[];
  // A page past the end (a stale link after sign-outs) shows the last page, not an empty list.
  const page = Math.min(asked, Math.max(1, Math.ceil((count?.n ?? 0) / pageSize)));
  const found = (await db.execute(sql`
    select d.id, d.employee_id, d.name, d.os, d.app_version, d.last_seen_at, d.status, d.permissions_ok, d.queue_size,
           e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.tracker_devices d join core.employees e on e.id = d.employee_id
    ${where}
    order by (d.status = 'active') desc, d.permissions_ok asc, d.last_seen_at asc nulls first, d.created_at desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`)) as unknown as {
    id: string; employee_id: string; name: string; os: string; app_version: string; last_seen_at: string | Date | null; status: string; permissions_ok: boolean; queue_size: number; first: string; last: string; preferred: string | null;
  }[];
  return {
    total: count?.n ?? 0,
    page,
    pageSize,
    latestVersion: latest,
    rows: found.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      person: reportName({ first: r.first, last: r.last, preferred: r.preferred }),
      name: r.name,
      os: r.os,
      appVersion: r.app_version,
      lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
      status: r.status,
      permissionsOk: r.permissions_ok,
      queueSize: r.queue_size,
      behind: latest !== null && parseVersion(r.app_version) !== null && isNewer(latest, r.app_version),
    })),
  };
}
