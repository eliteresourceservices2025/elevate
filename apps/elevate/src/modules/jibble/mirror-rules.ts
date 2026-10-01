// Pure rules for the Jibble link. No database, no network, no clock: easy to test.
// ELEVATE is the time clock; Jibble is only told when screenshots should run (CLAUDE.md rule 10).

import type { ClockType } from "@/modules/attendance/clock";

/** What is sent to Jibble's TimeEntries endpoint (EndBreak has its own endpoint). */
export type JibbleAction = "In" | "Out" | "StartBreak" | "EndBreak";

/**
 * How a break is shown to Jibble so screenshots stop while the person is on break:
 * native = Jibble's own break entries (the default; needs break types created in Jibble, see pickBreak);
 * clock = clock out at the start and back in at the end (works with no break types set up);
 * off = breaks are not mirrored (screenshots keep running during a break).
 */
export type BreakMode = "clock" | "native" | "off";

export const parseBreakMode = (value: string | undefined): BreakMode => (value === "clock" || value === "off" ? value : "native");

/**
 * A break available to a person in Jibble (breaks come from the person's schedule, so they are listed per person). A null length is
 * a flexible ("staggered") break with no fixed length of its own. ELEVATE's breaks are unpaid, so unpaid ones are preferred.
 */
export type JibbleBreak = { id: string; name: string; durationMinutes: number | null; paid?: boolean };

/**
 * Which Jibble break to use for an ELEVATE break of a chosen length (15, 30 or 60 minutes, or null for no limit). Unpaid breaks
 * are preferred. A break of exactly that length wins; then a flexible one (it fits any length, so Jibble does not count a full fixed
 * break for a short one); then the shortest fixed break that is long enough; then the longest. Null when the person has no break in Jibble.
 */
export function pickBreak(breaks: readonly JibbleBreak[], plannedMinutes: number | null): JibbleBreak | null {
  const unpaid = breaks.filter((b) => b.paid !== true);
  const pool = unpaid.length > 0 ? unpaid : breaks;
  if (pool.length === 0) return null;
  const longestFirst = [...pool].sort((a, b) => (b.durationMinutes ?? 0) - (a.durationMinutes ?? 0));
  const flexible = pool.find((b) => b.durationMinutes === null);
  if (plannedMinutes === null) return flexible ?? longestFirst[0];
  const exact = pool.find((b) => b.durationMinutes === plannedMinutes);
  if (exact) return exact;
  const longEnough = pool.filter((b) => b.durationMinutes !== null && b.durationMinutes >= plannedMinutes).sort((a, b) => (a.durationMinutes ?? 0) - (b.durationMinutes ?? 0))[0];
  return flexible ?? longEnough ?? longestFirst[0];
}

export type MirrorInput = { id: string; type: ClockType };
export type MirrorStep = { eventId: string; action: JibbleAction };

/**
 * The Jibble calls for the clock events one ELEVATE click wrote, in order. A clock-out on a break writes two events
 * (break end, clock out): in clock mode the person is already out in Jibble from the break start, so only the clock-out is sent.
 */
export function mirrorSteps(events: readonly MirrorInput[], mode: BreakMode): MirrorStep[] {
  const endsShift = events.some((e) => e.type === "clock_out");
  const steps: MirrorStep[] = [];
  for (const e of events) {
    if (e.type === "clock_in") steps.push({ eventId: e.id, action: "In" });
    else if (e.type === "clock_out") steps.push({ eventId: e.id, action: "Out" });
    else if (mode === "off") continue;
    else if (e.type === "break_start") steps.push({ eventId: e.id, action: mode === "native" ? "StartBreak" : "Out" });
    else if (e.type === "break_end" && !(mode === "clock" && endsShift)) steps.push({ eventId: e.id, action: mode === "native" ? "EndBreak" : "In" });
  }
  return steps;
}

export const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 2, 5, 10, 20, 30];

/** Milliseconds to wait before the next try, after `attempt` tries have failed (1-based). About 68 minutes in all. */
export const backoffMs = (attempt: number) => (BACKOFF_MINUTES[Math.min(Math.max(attempt, 1), BACKOFF_MINUTES.length) - 1] ?? 30) * 60_000;

/**
 * Jibble returns durations as ISO 8601 ("PT7H30M", "P1DT2H") or clock style ("07:30:00", "1.02:00:00"). Minutes, or null when unreadable.
 */
export function parseDuration(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const value = text.trim();
  if (value === "") return null;
  const total = (() => {
    if (value.startsWith("P")) {
      const [datePart, timePart = ""] = value.slice(1).split("T");
      const sum = (part: string, units: Record<string, number>) => {
        const token = /(\d+\.?\d*)([A-Z])/g;
        if (part.replace(token, "") !== "") return Number.NaN;
        return [...part.matchAll(token)].reduce((t, m) => t + Number(m[1]) * (units[m[2]] ?? Number.NaN), 0);
      };
      if (datePart === "" && timePart === "") return Number.NaN;
      return sum(datePart, { D: 1440 }) + sum(timePart, { H: 60, M: 1, S: 1 / 60 });
    }
    const parts = value.split(":");
    if (parts.length < 2 || parts.length > 3 || !parts.every((x) => /^[0-9.]+$/.test(x))) return Number.NaN;
    const [first, m, sec = "0"] = parts;
    const [d, h] = first.includes(".") ? first.split(".") : ["0", first];
    return Number(d) * 1440 + Number(h) * 60 + Number(m) + Number(sec) / 60;
  })();
  return Number.isFinite(total) ? total : null;
}

/** ELEVATE and Jibble disagree when their totals differ by more than the tolerance. */
export const isMismatch = (elevateMinutes: number, jibbleMinutes: number, toleranceMinutes: number) => Math.abs(elevateMinutes - jibbleMinutes) > toleranceMinutes;

/** What is stored of an error: a short code and the HTTP status. Never a response body, a token or a name. */
export function describeFailure(status: number | null, code: string): string {
  const safe = code.replace(/[^a-z0-9_ .-]/gi, "").slice(0, 80);
  return status === null ? `network: ${safe}` : `http ${status}: ${safe}`;
}

/** Whether another try could help: network trouble, rate limits and server errors yes; a refusal no. */
export const isRetryable = (status: number | null) => status === null || status === 408 || status === 429 || status >= 500;
