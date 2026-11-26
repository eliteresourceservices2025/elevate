import "server-only";
import type { db } from "@/lib/db";
import type { Replay } from "./clock";
import { breakAllowanceLeft, dailyBreakAllowance } from "./day-limits";
import { loadEffectiveSchedules } from "./schedule-service";
import { shiftsForWork } from "./schedule";

type Executor = Pick<typeof db, "execute" | "insert" | "select" | "update" | "delete">;

/**
 * Minutes of the day's break allowance a person has not used yet (server-only: reads the person's schedules). Callers authorize first.
 * The day is the one the current session started in (a night shift keeps one allowance across midnight), or today when not working.
 */
export async function breakLeftToday(executor: Executor, input: { employeeId: string; zone: string; replay: Replay; defaultBreakMinutes: number; nowMs: number }): Promise<number> {
  const open = input.replay.sessions[input.replay.sessions.length - 1];
  const refMs = open && open.endAt === null ? open.startAt : input.nowMs;
  const work = shiftsForWork(await loadEffectiveSchedules(executor, input.employeeId), input.zone, refMs);
  const allowanceMinutes = dailyBreakAllowance({ shifts: work.shifts, defaultBreakMinutes: input.defaultBreakMinutes });
  const dayStart = work.startMs;
  const breaks = input.replay.sessions.filter((s) => s.startAt >= dayStart).flatMap((s) => s.breaks);
  return breakAllowanceLeft({ allowanceMinutes, breaks, nowMs: input.nowMs });
}
