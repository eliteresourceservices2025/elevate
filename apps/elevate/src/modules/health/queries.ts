import "server-only";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getJibbleClient } from "@/modules/jibble/client";
import { jobHealth, type JobHealth } from "./service";

export type SystemHealth = {
  checkedAt: string;
  jobs: JobHealth[];
  jibble: { configured: boolean; paused: boolean; queued: number; oldestMinutes: number | null; failed24h: number; lastSentAt: string | null };
  clock: { workingNow: number; clockActionsLastHour: number; stillHereLast10Minutes: number; lastClockAt: string | null };
};

/** The Health tab: are the scheduled jobs running, is Jibble keeping up, is the clock being used. HR and Super Admin only. */
export async function getSystemHealth(): Promise<SystemHealth> {
  const user = await requireUser();
  await authorize(user, "health.view");

  const [jibble] = (await db.execute(sql`
    select count(*) filter (where status = 'queued')::int as queued,
           (extract(epoch from now() - min(created_at) filter (where status = 'queued')) / 60)::float8 as oldest,
           count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')::int as failed24h,
           max(sent_at) as last_sent,
           coalesce((select paused from time.jibble_settings where id = 1), false) as paused
    from time.jibble_link_log`)) as unknown as { queued: number; oldest: number | null; failed24h: number; last_sent: Date | null; paused: boolean }[];

  const [clock] = (await db.execute(sql`
    select
      (select count(*)::int from (
        select distinct on (employee_id) type from time.clock_events where occurred_at > now() - interval '48 hours' order by employee_id, occurred_at desc, created_at desc
      ) last where last.type <> 'clock_out') as working,
      (select count(*)::int from time.clock_events where source = 'web' and created_at > now() - interval '1 hour') as actions,
      (select count(*)::int from time.clock_presence where last_seen_at > now() - interval '10 minutes') as pings,
      (select max(created_at) from time.clock_events) as last_event`)) as unknown as { working: number; actions: number; pings: number; last_event: Date | null }[];

  return {
    checkedAt: new Date().toISOString(),
    jobs: await jobHealth(),
    jibble: {
      configured: getJibbleClient() !== null,
      paused: Boolean(jibble?.paused),
      queued: jibble?.queued ?? 0,
      oldestMinutes: jibble?.oldest === null || jibble?.oldest === undefined ? null : Math.round(Number(jibble.oldest)),
      failed24h: jibble?.failed24h ?? 0,
      lastSentAt: jibble?.last_sent ? new Date(jibble.last_sent).toISOString() : null,
    },
    clock: { workingNow: clock?.working ?? 0, clockActionsLastHour: clock?.actions ?? 0, stillHereLast10Minutes: clock?.pings ?? 0, lastClockAt: clock?.last_event ? new Date(clock.last_event).toISOString() : null },
  };
}
