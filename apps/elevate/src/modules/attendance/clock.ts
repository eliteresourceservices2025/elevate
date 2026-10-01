// Pure rules for the time clock. No database and no clock: events in, state and hours out.
// Times are milliseconds since the epoch (UTC); calendar days are computed in a named time zone.

import { formatInZone } from "@/lib/time";

export type ClockType = "clock_in" | "break_start" | "break_end" | "clock_out";
export type ClockState = "out" | "working" | "break";

export type ClockEventLite = { id?: string; type: ClockType; at: number; createdAtMs?: number };

/** What state a person is in after this event, or null when the event is not allowed in the current state. */
export function transition(state: ClockState, type: ClockType): ClockState | null {
  if (state === "out") return type === "clock_in" ? "working" : null;
  if (state === "working") return type === "break_start" ? "break" : type === "clock_out" ? "out" : null;
  return type === "break_end" ? "working" : null; // on a break: only ending it (clock-out ends the break first)
}

const byTime = (a: ClockEventLite, b: ClockEventLite) => a.at - b.at || (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0) || (a.id ?? "").localeCompare(b.id ?? "");

export type Session = {
  startAt: number;
  endAt: number | null;
  breaks: { startAt: number; endAt: number | null }[];
  startEventId?: string;
};

export type Replay = { state: ClockState; sessions: Session[]; invalid: ClockEventLite[] };

/** Replays events in time order. An event the state machine refuses is collected in `invalid` and skipped. */
export function replayClock(events: readonly ClockEventLite[]): Replay {
  let state: ClockState = "out";
  const sessions: Session[] = [];
  const invalid: ClockEventLite[] = [];
  for (const e of [...events].sort(byTime)) {
    const next = transition(state, e.type);
    if (next === null) {
      invalid.push(e);
      continue;
    }
    const current = sessions[sessions.length - 1];
    if (e.type === "clock_in") sessions.push({ startAt: e.at, endAt: null, breaks: [], startEventId: e.id });
    else if (e.type === "break_start") current.breaks.push({ startAt: e.at, endAt: null });
    else if (e.type === "break_end") current.breaks[current.breaks.length - 1].endAt = e.at;
    else current.endAt = e.at;
    state = next;
  }
  return { state, sessions, invalid };
}

export const MINUTE = 60_000;

/** Time on breaks inside a session; an open break counts up to `until` (or the session end). */
export function breakMs(session: Session, until: number): number {
  return session.breaks.reduce((sum, b) => sum + Math.max(0, (b.endAt ?? session.endAt ?? until) - b.startAt), 0);
}

/** Worked time of a session: its length minus breaks. An open session counts up to `until`. */
export function workedMs(session: Session, until: number): number {
  const end = session.endAt ?? until;
  return Math.max(0, end - session.startAt - breakMs(session, until));
}

export type DayTotals = {
  date: string;
  sessions: number;
  workedMinutes: number;
  breakMinutes: number;
  firstIn: number;
  lastOut: number | null;
  /** A session started this day has no clock-out yet. */
  open: boolean;
};

/**
 * Groups sessions into calendar days: a session belongs to the day it STARTED in the person's own zone, so a night
 * shift stays one day. Open sessions are shown but contribute no worked time (they are not finished).
 */
export function buildDays(events: readonly ClockEventLite[], zone: string): DayTotals[] {
  const days = new Map<string, DayTotals>();
  for (const s of replayClock(events).sessions) {
    const date = formatInZone(s.startAt, zone, "yyyy-MM-dd");
    const day = days.get(date) ?? { date, sessions: 0, workedMinutes: 0, breakMinutes: 0, firstIn: s.startAt, lastOut: null, open: false };
    day.sessions += 1;
    day.firstIn = Math.min(day.firstIn, s.startAt);
    if (s.endAt === null) day.open = true;
    else {
      day.workedMinutes += Math.round(workedMs(s, s.endAt) / MINUTE);
      day.breakMinutes += Math.round(breakMs(s, s.endAt) / MINUTE);
      day.lastOut = Math.max(day.lastOut ?? 0, s.endAt);
    }
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// --- Network ranges ---------------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Accepts "1.2.3.4" or "1.2.3.0/24". */
export function isValidRange(range: string): boolean {
  const [ip, bits, ...rest] = range.trim().split("/");
  if (rest.length > 0 || ipv4ToInt(ip) === null) return false;
  return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
}

/** Whether an address is inside any allowed range. No ranges means no restriction. An unknown address is outside. */
export function ipAllowed(ip: string | null | undefined, ranges: readonly string[]): boolean {
  if (ranges.length === 0) return true;
  if (!ip) return false;
  const addr = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  const value = ipv4ToInt(addr);
  if (value === null) return false; // only IPv4 ranges are supported
  return ranges.some((range) => {
    const [base, bits] = range.trim().split("/");
    const start = ipv4ToInt(base);
    if (start === null) return false;
    const length = bits === undefined ? 32 : Number(bits);
    const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
    return ((value & mask) >>> 0) === ((start & mask) >>> 0);
  });
}

// --- Location ---------------------------------------------------------------------------------------

/** Two decimals of a degree is about 1.1 km: coarse enough that it never shows a home address. */
export const roundCoordinate = (n: number) => Math.round(n * 100) / 100;

export const validCoordinates = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// --- Formatting -------------------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MINUTE));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export const MAX_OPEN_SESSION_MS = 12 * 60 * MINUTE;
