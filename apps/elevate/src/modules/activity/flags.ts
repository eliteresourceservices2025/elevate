import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { replayClock } from "@/modules/attendance/clock";
import { clockSourceOf } from "@/modules/attendance/clock-source";
import { loadEventsBetween, monitoringPolicyPublished } from "@/modules/attendance/service";
import { clipToIntervals, trackerFlags, workingIntervals, type Interval } from "./logic";
import { activitySettings } from "./schema";

/** Working time inside [fromMs, toMs]: the person's clocked-in sessions minus breaks, cut to the window. */
export async function workingBetween(employeeId: string, fromMs: number, toMs: number): Promise<Interval[]> {
  const events = await loadEventsBetween(db, employeeId, fromMs - 36 * 3_600_000, toMs);
  const intervals = workingIntervals(replayClock(events).sessions, toMs);
  return intervals.map((i) => ({ start: Math.max(i.start, fromMs), end: Math.min(i.end, toMs) })).filter((i) => i.end > i.start);
}

/**
 * The tracker's flags for one stretch of a person's day (normally first clock-in to last clock-out), merged into the day's flags by the
 * nightly attendance rebuild. Empty when no monitoring policy is published or the person had no tracker during the stretch: a person
 * without a tracker is never flagged for not having one.
 */
export async function activityFlagsFor(employeeId: string, fromMs: number, toMs: number): Promise<string[]> {
  if (!(await monitoringPolicyPublished(db))) return [];
  // Someone on the Jibble clock has no ELEVATE working time to judge the tracker against (their hours arrive by import).
  if ((await clockSourceOf(db, employeeId)) === "jibble") return [];
  const [device] = (await db.execute(sql`
    select 1 as ok from time.tracker_devices
    where employee_id = ${employeeId} and created_at <= to_timestamp(${toMs / 1000})
      and (revoked_at is null or revoked_at >= to_timestamp(${fromMs / 1000})) limit 1`)) as unknown as { ok: number }[];
  if (!device) return [];

  const working = await workingBetween(employeeId, fromMs, toMs);
  const workingMs = working.reduce((sum, i) => sum + (i.end - i.start), 0);
  const segs = (await db.execute(sql`
    select (extract(epoch from started_at) * 1000)::float8 as s, (extract(epoch from ended_at) * 1000)::float8 as e, state
    from time.activity_segments
    where employee_id = ${employeeId} and started_at < to_timestamp(${toMs / 1000}) and ended_at > to_timestamp(${fromMs / 1000})`)) as unknown as { s: number; e: number; state: "active" | "idle" }[];
  let coveredMs = 0;
  let activeMs = 0;
  for (const r of segs) {
    for (const piece of clipToIntervals({ start: Number(r.s), end: Number(r.e), app: "", state: r.state }, working)) {
      coveredMs += piece.end - piece.start;
      if (piece.state === "active") activeMs += piece.end - piece.start;
    }
  }
  const [shots] = (await db.execute(sql`
    select count(*)::int as n from time.activity_shots
    where employee_id = ${employeeId} and finalized_at is not null and taken_at between to_timestamp(${fromMs / 1000}) and to_timestamp(${toMs / 1000})`)) as unknown as { n: number }[];
  const [settings] = await db.select().from(activitySettings).where(eq(activitySettings.scope, "default")).limit(1);
  return trackerFlags({ workingMs, coveredMs, activeMs, shots: shots?.n ?? 0, lowActivityPercent: settings?.lowActivityPercent ?? 30 });
}
