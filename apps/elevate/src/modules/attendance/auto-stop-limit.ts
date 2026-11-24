import "server-only";
import { sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import type { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { segmentMs, type Replay } from "./clock";
import { clockSourceOf } from "./clock-source";
import { stopLimit, type StopLimit } from "./day-limits";
import { approvedWindows } from "./extra-hours-service";
import { hasScheduleAround, shiftsOn } from "./schedule";
import { loadSchedules } from "./schedule-service";
import { prefsFor, rulesFor } from "./service";

type Executor = Pick<typeof db, "execute" | "insert" | "select" | "update" | "delete">;

const HOUR = 3_600_000;

/** The client the open session is working for right now (null when none or not working). */
export function currentClientOf(replay: Replay): string | null {
  const open = replay.sessions[replay.sessions.length - 1];
  if (!open || open.endAt !== null || replay.state === "out") return null;
  return open.switches[open.switches.length - 1]?.clientId ?? open.clientId;
}

/**
 * When the clock must stop for this person, or null when it never does (they are on the Jibble clock). Server-only: reads the person's
 * schedules, the day's worked time, approved extra hours and HR's daily cap. `clientId` overrides the client being worked for (a clock-in or
 * a switch asks "would there be time left for that client?"). Callers authorize first.
 */
export async function computeStopLimit(executor: Executor, employeeId: string, nowMs: number, opts: { replay: Replay; clientId?: string | null }): Promise<StopLimit | null> {
  if ((await clockSourceOf(executor, employeeId)) === "jibble") return null;
  const { replay } = opts;
  const prefs = await prefsFor(executor, employeeId);
  const rules = await rulesFor(executor, employeeId);
  const open = replay.sessions[replay.sessions.length - 1];
  const working = Boolean(open && open.endAt === null && replay.state !== "out");
  // The day is the one the session started in (a night shift keeps one set of limits across midnight), or today when not working.
  const day = formatInZone(working ? open.startAt : nowMs, prefs.zone, "yyyy-MM-dd");
  const dayStart = fromZonedTime(`${day}T00:00:00`, prefs.zone).getTime();
  const schedules = await loadSchedules(executor, employeeId);

  const workedMsByClient = new Map<string | null, number>();
  let workedMsToday = 0;
  for (const session of replay.sessions.filter((s) => s.startAt >= dayStart)) {
    for (const seg of segmentMs(session, nowMs)) {
      workedMsByClient.set(seg.clientId, (workedMsByClient.get(seg.clientId) ?? 0) + seg.workedMs);
      workedMsToday += seg.workedMs;
    }
  }

  const clientId = opts.clientId !== undefined ? opts.clientId : currentClientOf(replay);
  const [person] = (await executor.execute(sql`select daily_cap_minutes as cap from core.employees where id = ${employeeId}`)) as unknown as { cap: number | null }[];
  const windows = (await approvedWindows(executor, employeeId, nowMs - 12 * HOUR, nowMs + 24 * HOUR)).filter((w) => clientId === null || w.clientId === clientId);

  return stopLimit({
    nowMs,
    hasSchedule: hasScheduleAround(schedules, day),
    shifts: shiftsOn(schedules, prefs.zone, day),
    clientId,
    workedMsByClient,
    workedMsToday,
    dailyCapMinutes: person?.cap ?? null,
    companyDefaultCapMinutes: rules.defaultDailyCapMinutes,
    approvedWindows: windows.map((w) => ({ startMs: w.startMs, endMs: w.endMs })),
  });
}

/**
 * Asks the job service to wait until this person's limit and stop their clock then (it re-checks when it wakes, so a limit that moved
 * is followed). A newer request for the same person replaces the older one. Never throws: if the job service cannot be reached the 15-minute
 * sweep still stops the clock. Call after the clock transaction has committed.
 */
export async function requestAutoStop(employeeId: string): Promise<void> {
  if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) return; // nothing to send to; the sweep covers it
  try {
    const { inngest } = await import("@/inngest/client");
    await Promise.race([inngest.send({ name: "attendance/auto-stop.requested", data: { employeeId } }), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch (error) {
    console.error("auto-stop request failed:", error instanceof Error ? error.name : "unknown error");
  }
}
