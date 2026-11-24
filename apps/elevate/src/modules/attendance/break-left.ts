import "server-only";
import { fromZonedTime } from "date-fns-tz";
import type { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import type { Replay } from "./clock";
import { breakAllowanceLeft, dailyBreakAllowance } from "./day-limits";
import { loadSchedules } from "./schedule-service";
import { shiftsOn } from "./schedule";

type Executor = Pick<typeof db, "execute" | "insert" | "select" | "update" | "delete">;

/**
 * Minutes of the day's break allowance a person has not used yet (server-only: reads the person's schedules). Callers authorize first.
 * The day is the one the current session started in (a night shift keeps one allowance across midnight), or today when not working.
 */
export async function breakLeftToday(executor: Executor, input: { employeeId: string; zone: string; replay: Replay; defaultBreakMinutes: number; nowMs: number }): Promise<number> {
  const open = input.replay.sessions[input.replay.sessions.length - 1];
  const refMs = open && open.endAt === null ? open.startAt : input.nowMs;
  const day = formatInZone(new Date(refMs), input.zone, "yyyy-MM-dd");
  const shifts = shiftsOn(await loadSchedules(executor, input.employeeId), input.zone, day);
  const allowanceMinutes = dailyBreakAllowance({ shifts, defaultBreakMinutes: input.defaultBreakMinutes });
  const dayStart = fromZonedTime(`${day}T00:00:00`, input.zone).getTime();
  const breaks = input.replay.sessions.filter((s) => s.startAt >= dayStart).flatMap((s) => s.breaks);
  return breakAllowanceLeft({ allowanceMinutes, breaks, nowMs: input.nowMs });
}
