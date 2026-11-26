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
  /** Clients turned off today by a day change (`offClientsOn`): no work for them even inside another client's shift. */
  offClientIds?: ReadonlySet<string | null>;
  /** The client the person is working for right now, or null. */
  clientId: string | null;
  /** Worked milliseconds today for each client (null key = no client), up to `nowMs`. */
  workedMsByClient: ReadonlyMap<string | null, number>;
  /** The working stretches themselves (breaks left out). With them, time before the shift starts never uses up the client's allotted hours. */
  stretches?: readonly { from: number; to: number; clientId: string | null }[];
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
export type StopLimit = {
  limitMs: number;
  reason: StopReason;
  /** How long ago the limit was reached (0 while there is still time left; Infinity when the person was never allowed to work now, such as a rest day). */
  overrunMs: number;
};

export function stopLimit(input: StopLimitInput): StopLimit {
  const { nowMs } = input;
  let limit: StopLimit;

  if (!input.hasSchedule && input.dailyCapMinutes === 0) {
    // HR marked the day off: never allowed to work now (approved windows can still lift it).
    limit = { limitMs: nowMs, reason: "daily_cap", overrunMs: Infinity };
  } else if (input.hasSchedule && input.offClientIds?.has(input.clientId) && !input.shifts.some((s) => (s.schedule.clientId ?? null) === input.clientId)) {
    limit = { limitMs: nowMs, reason: "shift_end", overrunMs: Infinity };
  } else if (!input.hasSchedule) {
    const cap = input.dailyCapMinutes ?? input.companyDefaultCapMinutes;
    limit = { limitMs: nowMs + Math.max(0, cap * MINUTE - input.workedMsToday), reason: "daily_cap", overrunMs: Math.max(0, input.workedMsToday - cap * MINUTE) };
  } else {
    const forClient = input.shifts.filter((s) => (s.schedule.clientId ?? null) === input.clientId);
    const candidates = forClient.length > 0 ? forClient : input.shifts;
    // The shift being worked now, else the next one that has not ended; none means the person is outside every shift.
    const shift = candidates.find((s) => s.startMs <= nowMs && nowMs < s.endMs) ?? candidates.find((s) => s.startMs > nowMs);
    if (!shift) {
      const lastEnd = Math.max(-Infinity, ...candidates.filter((s) => s.endMs <= nowMs).map((s) => s.endMs));
      limit = { limitMs: nowMs, reason: "shift_end", overrunMs: lastEnd === -Infinity ? Infinity : nowMs - lastEnd };
    } else {
      limit = { limitMs: shift.endMs, reason: "shift_end", overrunMs: 0 };
      // A client with several shifts on this day (a split day) has their allotted minutes added up; if any of them has no limit, there is none.
      // Only this day's: a night shift still running from yesterday must not add the next day's hours to its own.
      const parts = forClient.length > 0 ? forClient.filter((s) => s.date === shift.date) : [shift];
      const allotted = parts.every((s) => s.schedule.allottedMinutesPerDay != null) ? parts.reduce((sum, s) => sum + (s.schedule.allottedMinutesPerDay ?? 0), 0) : null;
      if (allotted !== null) {
        // Early work counts as worked time but not against the allotment: the allotment is counted from where the client's shift starts,
        // so clocking in early never stops the clock before the shift ends (owner decision 2026-11-25).
        const startsAt = Math.min(...parts.map((s) => s.startMs));
        const worked = input.stretches
          ? input.stretches.reduce((sum, w) => (w.clientId === input.clientId ? sum + Math.max(0, w.to - Math.max(w.from, startsAt)) : sum), 0)
          : (input.workedMsByClient.get(input.clientId) ?? 0);
        const left = Math.max(0, allotted * MINUTE - worked);
        const from = input.stretches ? Math.max(nowMs, startsAt) : nowMs;
        if (from + left < limit.limitMs) limit = { limitMs: from + left, reason: "client_allotment", overrunMs: Math.max(0, worked - allotted * MINUTE) };
      }
    }
  }

  // Approved windows chain from the moment the limit was reached: one that covers that moment moves it to the window's end, and so can the
  // next. (A person who was never allowed to work now, such as on a rest day, is measured from now.)
  const windows = [...input.approvedWindows].sort((a, b) => a.startMs - b.startMs);
  let reached = Number.isFinite(limit.overrunMs) ? limit.limitMs - limit.overrunMs : nowMs;
  let lifted = false;
  for (const w of windows) {
    if (w.startMs <= reached && w.endMs > reached) {
      reached = w.endMs;
      lifted = true;
    }
  }
  if (lifted) limit = reached > nowMs ? { limitMs: reached, reason: "approved_extra_end", overrunMs: 0 } : { limitMs: nowMs, reason: "approved_extra_end", overrunMs: nowMs - reached };
  // A window that is open right now keeps the person working even when it began after the limit was reached (the gap before it shows up as
  // unapproved extra time in hours review; the clock is not stopped over it).
  if (limit.limitMs <= nowMs) {
    const open = windows.filter((w) => w.startMs <= nowMs && w.endMs > nowMs).sort((a, b) => b.endMs - a.endMs)[0];
    if (open) limit = { limitMs: open.endMs, reason: "approved_extra_end", overrunMs: 0 };
  }
  // Still past the limit: if an approved window ended after the moment the limit was reached, that window was the person's permission, so time
  // stops at its end (never back at the start of the session, which would erase time worked inside the window).
  if (limit.limitMs <= nowMs) {
    const base = Number.isFinite(limit.overrunMs) ? limit.limitMs - limit.overrunMs : -Infinity;
    const past = windows.filter((w) => w.endMs <= nowMs && w.endMs > base).sort((a, b) => b.endMs - a.endMs)[0];
    if (past) limit = { limitMs: nowMs, reason: "approved_extra_end", overrunMs: nowMs - past.endMs };
  }
  return limit;
}

/** Minutes of break a person may take in a day: the break time of today's shifts, or the company default when they have none (no schedule, or schedules with no break set). */
export function dailyBreakAllowance(input: { shifts: readonly Shift[]; defaultBreakMinutes: number }): number {
  const scheduled = input.shifts.reduce((sum, s) => sum + s.schedule.breakMinutes, 0);
  return scheduled > 0 ? scheduled : input.defaultBreakMinutes;
}
