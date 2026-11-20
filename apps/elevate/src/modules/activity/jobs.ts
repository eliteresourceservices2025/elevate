import "server-only";
import { fromZonedTime } from "date-fns-tz";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringPolicyPublished, prefsFor } from "@/modules/attendance/service";
import { addDays } from "@/modules/attendance/schedule";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { reportName, timeNoticeUserIds } from "@/modules/org/service";
import { summarizeDay, type CategoryRule } from "./logic";
import { activityCategories, activityMinutes, activitySettings, trackerOfflineNotices } from "./schema";

// Background work of the ELEVATE Tracker (no signed-in person). src/inngest wraps these in scheduled functions.

const MINUTE = 60_000;
const DAY_MS = 86_400_000;
export const SHOT_KEEP_DAYS = 30;

/** Rebuilds the activity totals of one day (the date in each person's own zone) from the segments. Safe to run again. */
export async function rebuildActivityMinutes(date: string, onlyEmployeeId?: string): Promise<{ people: number }> {
  const ids = onlyEmployeeId
    ? [onlyEmployeeId]
    : (
        (await db.execute(sql`
          select distinct employee_id from time.activity_segments
          where started_at >= (${date}::date - 1)::timestamptz and started_at < (${date}::date + 2)::timestamptz`)) as unknown as { employee_id: string }[]
      ).map((r) => r.employee_id);
  if (ids.length === 0) return { people: 0 };

  const ruleRows = await db.select().from(activityCategories).where(sql`${activityCategories.archivedAt} is null`);
  const rules: CategoryRule[] = ruleRows.map((r) => ({ pattern: r.pattern, category: r.category as "work" | "non_work", rank: r.rank }));

  for (const employeeId of ids) {
    const { zone } = await prefsFor(db, employeeId);
    const dayStart = fromZonedTime(`${date}T00:00:00`, zone).getTime();
    const dayEnd = fromZonedTime(`${addDays(date, 1)}T00:00:00`, zone).getTime();
    const segs = (await db.execute(sql`
      select app, state, (extract(epoch from started_at) * 1000)::float8 as s, (extract(epoch from ended_at) * 1000)::float8 as e
      from time.activity_segments
      where employee_id = ${employeeId} and started_at < to_timestamp(${dayEnd / 1000}) and ended_at > to_timestamp(${dayStart / 1000})`)) as unknown as { app: string; state: string; s: number; e: number }[];

    const summary = summarizeDay(
      segs.map((r) => ({ start: Number(r.s), end: Number(r.e), app: r.app, state: r.state as "active" | "idle" })),
      dayStart,
      dayEnd,
      rules,
    );
    const values = { ...summary, rebuiltAt: new Date() };
    await db.insert(activityMinutes).values({ employeeId, date, ...values }).onConflictDoUpdate({ target: [activityMinutes.employeeId, activityMinutes.date], set: values });
  }
  return { people: ids.length };
}

/** Daily: delete screenshot files 30 days after they were taken. The row stays, marked purged. */
export async function purgeShots(now = new Date()): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - SHOT_KEEP_DAYS * DAY_MS);
  const stale = (await db.execute(sql`
    select id, storage_path as path from time.activity_shots
    where purged_at is null and taken_at < ${cutoff.toISOString()}::timestamptz limit 500`)) as unknown as { id: string; path: string }[];
  if (stale.length === 0) return { purged: 0 };
  await getDocumentStorage().remove(BUCKETS.tracker, stale.map((s) => s.path));
  for (const s of stale) await db.execute(sql`update time.activity_shots set purged_at = ${now.toISOString()}::timestamptz where id = ${s.id}`);
  return { purged: stale.length };
}

/**
 * Every 30 minutes: a person who is clocked in and whose tracker has reported nothing for the team's grace plus 10 minutes is reported
 * to their lead (HR when nobody is above them), once per clock-in. The notice names the person, never an app.
 */
export async function runTrackerOfflineAlerts(now = new Date()): Promise<{ noticed: number }> {
  if (!(await monitoringPolicyPublished(db))) return { noticed: 0 };
  const [settings] = await db.select().from(activitySettings).where(eq(activitySettings.scope, "default")).limit(1);
  const limitMs = ((settings?.offlineGraceMinutes ?? 5) + 10) * MINUTE;
  const candidates = (await db.execute(sql`
    select s.employee_id, s.event_id, s.last_ms, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred,
           (select (extract(epoch from max(g.ended_at)) * 1000)::float8 from time.activity_segments g where g.employee_id = s.employee_id and g.ended_at >= s.in_at) as seg_ms
    from (
      select employee_id,
             (array_agg(id order by occurred_at desc, created_at desc) filter (where type = 'clock_in'))[1] as event_id,
             (array_agg(type order by occurred_at desc, created_at desc))[1] as last_type,
             max(occurred_at) filter (where type = 'clock_in') as in_at,
             (extract(epoch from max(occurred_at)) * 1000)::float8 as last_ms
      from time.v_clock_events where occurred_at > now() - interval '3 days' group by employee_id
    ) s
    join core.employees e on e.id = s.employee_id
    where s.last_type in ('clock_in', 'break_end', 'switch_client') and s.event_id is not null
      and exists (select 1 from time.tracker_devices d where d.employee_id = s.employee_id and d.status = 'active')
      and not exists (select 1 from time.tracker_offline_notices n where n.clock_in_event_id = s.event_id)`)) as unknown as {
    employee_id: string; event_id: string; last_ms: number; seg_ms: number | null; user_id: string | null; first: string; last: string; preferred: string | null;
  }[];

  let noticed = 0;
  const hr = await hrUserIds();
  for (const c of candidates) {
    const lastSeen = Math.max(Number(c.last_ms), c.seg_ms === null ? 0 : Number(c.seg_ms));
    if (now.getTime() - lastSeen <= limitMs) continue;
    await db.transaction(async (tx) => {
      const claimed = await tx.insert(trackerOfflineNotices).values({ clockInEventId: c.event_id }).onConflictDoNothing().returning({ id: trackerOfflineNotices.clockInEventId });
      if (claimed.length === 0) return;
      noticed += 1;
      const name = reportName({ first: c.first, last: c.last, preferred: c.preferred });
      const chain = await timeNoticeUserIds(tx, c.employee_id);
      const targets = (chain.length > 0 ? chain : hr).filter((id) => id !== c.user_id);
      const minutes = Math.round((now.getTime() - lastSeen) / MINUTE);
      await notify(tx, targets.map((userId) => ({ userId, kind: "tracker.offline", title: `${name}'s tracker has not reported for ${minutes} minutes`, body: "They are still clocked in. The app may be closed, the computer asleep or the connection down.", link: "/team-attendance" })));
    });
  }
  return { noticed };
}
