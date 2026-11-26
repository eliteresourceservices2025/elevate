import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rebuildAttendanceDays } from "./jobs";
import { addDays } from "./schedule";

// The "Refresh this week" button of hours review. Callers authorize first and pass only the people they may see.

const DAY_MS = 86_400_000;
const PARALLEL = 4;
/** How far back a week can be refreshed by hand (older days are left as they are). */
export const REFRESH_DAYS = 31;

/**
 * The people whose clock events (or removals) of this week are newer than their rebuilt days, or who have events and no day at all.
 * `only` limits it to a lead's team.
 */
export async function stalePeople(weekStart: string, only: string[] | null): Promise<string[]> {
  if (only && only.length === 0) return [];
  const from = Date.parse(`${weekStart}T00:00:00Z`) - DAY_MS;
  const to = from + 9 * DAY_MS;
  const filter = only ? sql`and e.employee_id in (${sql.join(only.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const rows = (await db.execute(sql`
    with changed as (
      select e.employee_id, max(greatest(e.created_at, v.created_at)) as at, bool_or(v.id is null) as has_events
      from time.clock_events e left join time.clock_event_voids v on v.event_id = e.id
      where e.occurred_at between to_timestamp(${from / 1000}) and to_timestamp(${to / 1000}) ${filter}
      group by e.employee_id
    )
    select c.employee_id from changed c
    left join lateral (
      select max(d.built_at) as at from time.attendance_days d
      where d.employee_id = c.employee_id and d.date between ${addDays(weekStart, -2)}::date and ${addDays(weekStart, 8)}::date and d.sessions > 0
    ) built on true
    where (built.at is null and c.has_events) or c.at > built.at`)) as unknown as { employee_id: string }[];
  return rows.map((r) => r.employee_id);
}

/** Rebuilds the stale people's days from the week's start to today, a few at a time. Returns how many people were brought up to date. */
export async function refreshWeek(weekStart: string, only: string[] | null, now = new Date()): Promise<number> {
  const ids = await stalePeople(weekStart, only);
  const daysBack = Math.max(1, Math.ceil((now.getTime() - Date.parse(`${weekStart}T00:00:00Z`)) / DAY_MS) + 1);
  for (let i = 0; i < ids.length; i += PARALLEL) {
    await Promise.all(ids.slice(i, i + PARALLEL).map((id) => rebuildAttendanceDays(now, daysBack, id)));
  }
  return ids.length;
}
