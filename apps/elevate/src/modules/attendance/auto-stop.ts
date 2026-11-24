import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { reportName, timeChainUserIds } from "@/modules/org/service";
import { replayClock } from "./clock";
import { clockSourceOf } from "./clock-source";
import { computeStopLimit } from "./auto-stop-limit";
import { loadRecentEvents, performClock } from "./service";

// The clock stopping by itself when a person's hours are used up (design 2026-11-24). It appends a clock-out (and the end of a break)
// with source 'auto_stop', stamped at the moment the limit was reached, never earlier than the person's last event. Safe to run twice.

export type AutoStopResult = { status: "stopped" } | { status: "stale" } | { status: "excluded" } | { status: "early"; limitMs: number };

type Row = { user_id: string | null; email: string | null; first: string; last: string; preferred: string | null };

/** Stops one person's clock if their limit has passed. Returns "early" with the moment to try again when there is still time left. */
export async function runAutoStop(employeeId: string, nowMs = Date.now()): Promise<AutoStopResult> {
  if ((await clockSourceOf(db, employeeId)) === "jibble") return { status: "excluded" };
  const events = await loadRecentEvents(db, employeeId);
  const replay = replayClock(events);
  if (replay.state === "out") return { status: "stale" };

  const limit = await computeStopLimit(db, employeeId, nowMs, { replay });
  if (!limit) return { status: "excluded" };
  if (limit.limitMs > nowMs) return { status: "early", limitMs: limit.limitMs };

  const [who] = (await db.execute(sql`
    select e.user_id, u.email, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from core.employees e left join core.users u on u.id = e.user_id where e.id = ${employeeId}`)) as unknown as Row[];
  if (!who?.user_id || !who.email) return { status: "stale" }; // no sign-in account, so no clock to stop
  const userId = who.user_id;

  // The time the limit was reached, but never before the person's last event (a break that began after it, a clock-in after it).
  const lastEventAt = events.length > 0 ? Math.max(...events.map((e) => e.at)) : 0;
  const stampMs = Math.min(nowMs, Math.max(lastEventAt, nowMs - limit.overrunMs));

  try {
    await performClock({ id: userId, email: who.email }, "clock_out", {}, { stampMs });
  } catch (error) {
    if (error instanceof ActionFailure) return { status: "stale" }; // someone clocked out first
    throw error;
  }

  const name = reportName({ first: who.first, last: who.last, preferred: who.preferred });
  await db.transaction(async (tx) => {
    const chain = await timeChainUserIds(tx, employeeId);
    const leads = (chain.length > 0 ? chain.slice(0, 1) : await hrUserIds()).filter((id) => id !== userId);
    await notify(tx, [
      { userId, kind: "attendance.auto_stopped", title: "Your clock stopped automatically", body: "Your hours for today were used up. If you need to keep working, ask your lead for extra hours first.", link: "/attendance" },
      ...leads.map((lead) => ({ userId: lead, kind: "attendance.auto_stopped", title: `${name} was clocked out automatically`, body: "Their hours for today were used up.", link: "/team-attendance" })),
    ]);
  });
  return { status: "stopped" };
}

/** Everyone still clocked in is checked against their limit. Run by the job service and by the host's 15-minute backstop. */
export async function runAutoStopSweep(nowMs = Date.now()): Promise<{ checked: number; stopped: number }> {
  const open = (await db.execute(sql`
    select last.employee_id from (
      select distinct on (employee_id) employee_id, type
      from time.v_clock_events where occurred_at > to_timestamp(${(nowMs - 36 * 3_600_000) / 1000})
      order by employee_id, occurred_at desc, created_at desc
    ) last where last.type <> 'clock_out'`)) as unknown as { employee_id: string }[];
  let stopped = 0;
  for (const r of open) {
    const result = await runAutoStop(r.employee_id, nowMs);
    if (result.status === "stopped") stopped += 1;
  }
  return { checked: open.length, stopped };
}
