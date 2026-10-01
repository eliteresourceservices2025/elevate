// Pure rules for extra hours requests. No database and no clock.
//
// Extra time = worked time beyond the scheduled hours (see schedule.ts). A request grants minutes for a window; the part of a
// day's extra time that the day's approved requests cover is "approved extra", the rest is "unapproved extra". Nothing blocks
// the clock: this only decides how the hours are labelled.

import { formatInTimeZone } from "date-fns-tz";
import { EXTRA_THRESHOLD_MINUTES } from "./schedule";

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

export const MIN_REQUEST_MINUTES = 15;
export const DEFAULT_MAX_EXTRA_MINUTES_PER_DAY = 240;
export const DEFAULT_MAX_DAY_MINUTES = 720;
/** A request may be asked for at most this far ahead, and after the fact at most this far back. */
export const MAX_AHEAD_MS = 30 * DAY_MS;
export const MAX_BACK_MS = 31 * DAY_MS;
/** A lead can approve something asked for after the fact only this far back; older goes to HR. */
export const LEAD_AFTER_THE_FACT_MS = 7 * DAY_MS;

export type Window = { startMs: number; endMs: number };
export const windowMinutes = (w: Window) => Math.round((w.endMs - w.startMs) / MINUTE);

/**
 * Why a window cannot be requested, or null when it is fine. alreadyGrantedMinutes is what the person already has
 * pending or approved that day.
 */
export function checkWindow(input: { startMs: number; endMs: number; nowMs: number; maxPerDayMinutes: number; alreadyGrantedMinutes: number }): string | null {
  const minutes = windowMinutes(input);
  if (!(input.endMs > input.startMs)) return "The end must be after the start.";
  if (minutes < MIN_REQUEST_MINUTES) return `Ask for at least ${MIN_REQUEST_MINUTES} minutes.`;
  if (minutes > 24 * 60) return "A request cannot be longer than a day.";
  if (input.startMs > input.nowMs + MAX_AHEAD_MS) return "Requests can be made up to 30 days ahead.";
  if (input.startMs < input.nowMs - MAX_BACK_MS) return "That is too long ago to ask for. Ask HR.";
  if (input.alreadyGrantedMinutes + minutes > input.maxPerDayMinutes) {
    const hours = input.maxPerDayMinutes / 60;
    return `That is more than ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours of extra time for one day (counting what is already asked or approved).`;
  }
  return null;
}

/** The window had already started: it is asked for after the fact. */
export const isAfterTheFact = (startMs: number, nowMs: number) => startMs < nowMs;

/** After the fact and more than 7 days before it was filed: HR decides, not the lead. */
export const needsHrForAge = (startMs: number, filedAtMs: number) => startMs < filedAtMs - LEAD_AFTER_THE_FACT_MS;

/** A warning (never a block) when scheduled hours plus the extra asked for pass the day's limit. */
export function dayLimitWarning(scheduledMinutes: number | null, extraMinutes: number, maxDayMinutes: number): string | null {
  const total = (scheduledMinutes ?? 0) + extraMinutes;
  if (total <= maxDayMinutes) return null;
  const hours = Math.round((total / 60) * 10) / 10;
  return `That makes about ${hours} hours that day, which is a long day. The lead will see this.`;
}

/**
 * Splits a day's extra minutes into approved (covered by what was granted that day) and unapproved. Anything left under the
 * threshold is not counted as unapproved.
 */
export function approvedExtra(extraMinutes: number, grantedMinutes: number, threshold = EXTRA_THRESHOLD_MINUTES): { approved: number; unapproved: number } {
  if (extraMinutes <= 0) return { approved: 0, unapproved: 0 };
  const approved = Math.min(extraMinutes, Math.max(0, grantedMinutes));
  const rest = extraMinutes - approved;
  return { approved, unapproved: rest >= threshold ? rest : 0 };
}

/** Granted minutes per calendar day of the person's own zone, by the day each window STARTS. */
export function grantedByDate(requests: readonly { startMs: number; minutes: number }[], zone: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of requests) {
    const date = formatInTimeZone(r.startMs, zone, "yyyy-MM-dd");
    out.set(date, (out.get(date) ?? 0) + r.minutes);
  }
  return out;
}

/**
 * The approved window that covers now (or starts within the lead time), so the header does not nag someone who is
 * allowed to be working. Null when none.
 */
export function coveringWindow(windows: readonly Window[], nowMs: number, leadMs = 5 * MINUTE): Window | null {
  return windows.filter((w) => w.startMs <= nowMs + leadMs && w.endMs > nowMs).sort((a, b) => b.endMs - a.endMs)[0] ?? null;
}

/**
 * Where an open session stops being "inside the approved time": the shift end, or the end of a chain of approved windows that
 * start by the shift end (plus a little slack) and run on from there.
 */
export function effectiveEndMs(shiftEndMs: number, windows: readonly Window[], slackMs = 15 * MINUTE): number {
  let end = shiftEndMs;
  for (const w of [...windows].sort((a, b) => a.startMs - b.startMs)) {
    if (w.startMs <= end + slackMs && w.endMs > end) end = w.endMs;
  }
  return end;
}
