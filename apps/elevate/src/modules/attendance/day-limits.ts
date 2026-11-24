// Pure rules for strict time (design 2026-11-24): how much break a person has left today, and the moment the clock stops by itself.
// No database and no clock: shifts, worked time and approvals in, a time out.

import type { Break } from "./clock";
import type { Shift } from "./schedule";

const MINUTE = 60_000;

export type StopWindow = { startMs: number; endMs: number };
export type StopReason = "shift_end" | "client_allotment" | "daily_cap" | "approved_extra_end";

/** Minutes of break allowance still unused today. A break counts for the time it really ran (an open one up to `nowMs`), so a break that
 *  ran over leaves less, and a short one gives back what it did not use. Never below zero. */
export function breakAllowanceLeft(input: { allowanceMinutes: number; breaks: readonly Break[]; nowMs: number }): number {
  const takenMs = input.breaks.reduce((sum, b) => sum + Math.max(0, (b.endAt ?? input.nowMs) - b.startAt), 0);
  return Math.max(0, input.allowanceMinutes - Math.round(takenMs / MINUTE)); // whole minutes: a few seconds either way is the same break
}

export type StopLimitInput = {
  nowMs: number;
  /** Whether the person has any schedule around today (so no shift today means a rest day, not "no limit"). */
  hasSchedule: boolean;
  /** Today's shifts (`shiftsOn`). */
  shifts: readonly Shift[];
  /** The client the person is working for right now, or null. */
  clientId: string | null;
  /** Worked milliseconds today for each client (null key = no client), up to `nowMs`. */
  workedMsByClient: ReadonlyMap<string | null, number>;
  workedMsToday: number;
  /** HR's per-person daily cap in minutes, used only when there is no schedule. */
  dailyCapMinutes: number | null;
  companyDefaultCapMinutes: number;
  /** Approved extra-hours or make-up windows for the person (already limited to the client being worked for). */
  approvedWindows: readonly StopWindow[];
};

/**
 * The moment the clock must stop: the earliest of the end of the shift being worked, the client's allotted minutes, or (with no schedule)
 * the daily cap. An approved window that starts at or before that moment moves it to the window's end. On a rest day, or after the shift
 * has ended, the limit is "now" unless a window covers it: the person is past what they were assigned.
 */
export function stopLimit(input: StopLimitInput): { limitMs: number; reason: StopReason } {
  const { nowMs } = input;
  let limit: { limitMs: number; reason: StopReason };

  if (!input.hasSchedule) {
    const cap = input.dailyCapMinutes ?? input.companyDefaultCapMinutes;
    limit = { limitMs: nowMs + Math.max(0, cap * MINUTE - input.workedMsToday), reason: "daily_cap" };
  } else {
    const forClient = input.shifts.filter((s) => (s.schedule.clientId ?? null) === input.clientId);
    const candidates = forClient.length > 0 ? forClient : input.shifts;
    // The shift being worked now, else the next one that has not ended; none means the person is outside every shift.
    const shift = candidates.find((s) => s.startMs <= nowMs && nowMs < s.endMs) ?? candidates.find((s) => s.startMs > nowMs);
    if (!shift) {
      limit = { limitMs: nowMs, reason: "shift_end" };
    } else {
      limit = { limitMs: shift.endMs, reason: "shift_end" };
      const allotted = shift.schedule.allottedMinutesPerDay ?? null;
      if (allotted !== null) {
        const left = Math.max(0, allotted * MINUTE - (input.workedMsByClient.get(input.clientId) ?? 0));
        if (nowMs + left < limit.limitMs) limit = { limitMs: nowMs + left, reason: "client_allotment" };
      }
    }
  }

  // Approved windows chain: one that starts at or before the limit moves it to its end, and so can the next.
  const windows = [...input.approvedWindows].sort((a, b) => a.startMs - b.startMs);
  for (const w of windows) {
    if (w.startMs <= limit.limitMs && w.endMs > limit.limitMs) limit = { limitMs: w.endMs, reason: "approved_extra_end" };
  }
  return limit;
}

/** Minutes of break a person may take in a day: the break time of today's shifts, or the company default when they have none (no schedule, or schedules with no break set). */
export function dailyBreakAllowance(input: { shifts: readonly Shift[]; defaultBreakMinutes: number }): number {
  const scheduled = input.shifts.reduce((sum, s) => sum + s.schedule.breakMinutes, 0);
  return scheduled > 0 ? scheduled : input.defaultBreakMinutes;
}
