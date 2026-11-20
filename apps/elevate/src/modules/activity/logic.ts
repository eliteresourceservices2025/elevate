// Pure rules for the ELEVATE Tracker. No database, no clock: segments in, minutes and decisions out.
// Times are milliseconds since the epoch (UTC). Only an app name is ever handled: no window titles or URLs.

export type SegmentState = "active" | "idle";
export type RawSegment = { start: number; end: number; app: string; state: SegmentState };
export type Interval = { start: number; end: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const MAX_SEGMENT_MS = 30 * MINUTE;
export const MAX_AGE_MS = 36 * HOUR;
export const FUTURE_SLACK_MS = 2 * MINUTE;
export const SHOT_WINDOW_MS = 10 * MINUTE;
const APP_MAX = 80;

/** An app name as stored: control characters removed, spaces collapsed, at most 80 characters; null when nothing is left. */
export function sanitizeApp(input: string): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, APP_MAX).trim();
}

export type SegmentCheck = "ok" | "future" | "too_old" | "inverted" | "too_long";

/** Whether one reported segment is believable. The device's clock is not trusted. */
export function validateSegment(s: RawSegment, nowMs: number): SegmentCheck {
  if (!(s.end > s.start)) return "inverted";
  if (s.end - s.start > MAX_SEGMENT_MS) return "too_long";
  if (s.end > nowMs + FUTURE_SLACK_MS) return "future";
  if (s.start < nowMs - MAX_AGE_MS) return "too_old";
  return "ok";
}

/** The pieces of a segment that fall inside the working intervals (breaks and time off the clock are cut out). */
export function clipToIntervals(s: RawSegment, working: readonly Interval[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const w of [...working].sort((a, b) => a.start - b.start)) {
    const start = Math.max(s.start, w.start);
    const end = Math.min(s.end, w.end);
    if (end > start) out.push({ ...s, start, end });
  }
  return out;
}

/**
 * Removes the parts of the incoming segments that are already stored (a retried upload) or already covered by an earlier
 * incoming segment. `dropped` counts incoming segments that ended up with nothing left.
 */
export function dropOverlaps(incoming: readonly RawSegment[], existing: readonly Interval[]): { kept: RawSegment[]; dropped: number } {
  const covered: Interval[] = [...existing].sort((a, b) => a.start - b.start);
  const kept: RawSegment[] = [];
  let dropped = 0;
  for (const s of [...incoming].sort((a, b) => a.start - b.start)) {
    let pieces: Interval[] = [{ start: s.start, end: s.end }];
    for (const c of covered) {
      pieces = pieces.flatMap((p) => {
        if (c.end <= p.start || c.start >= p.end) return [p];
        const left = c.start > p.start ? [{ start: p.start, end: c.start }] : [];
        const right = c.end < p.end ? [{ start: c.end, end: p.end }] : [];
        return [...left, ...right];
      });
    }
    if (pieces.length === 0) {
      dropped += 1;
      continue;
    }
    for (const p of pieces) {
      kept.push({ ...s, start: p.start, end: p.end });
      covered.push(p);
    }
  }
  return { kept, dropped };
}

export function activeMinutes(segments: readonly RawSegment[]): { activeMs: number; idleMs: number } {
  let activeMs = 0;
  let idleMs = 0;
  for (const s of segments) {
    if (s.state === "active") activeMs += s.end - s.start;
    else idleMs += s.end - s.start;
  }
  return { activeMs, idleMs };
}

/** Active time as a whole percent of worked time (0 when nothing was worked, never above 100). */
export function activePercent(activeMs: number, workedMs: number): number {
  if (workedMs <= 0) return 0;
  return Math.min(100, Math.round((activeMs / workedMs) * 100));
}

export type CategoryRule = { pattern: string; category: "work" | "non_work"; rank: number };

/** The category of an app: the highest-ranked matching rule wins (case-insensitive); a rule that is not a valid pattern is ignored. */
export function categorize(app: string, rules: readonly CategoryRule[]): "work" | "non_work" | "unknown" {
  let best: CategoryRule | null = null;
  for (const r of rules) {
    let re: RegExp;
    try {
      re = new RegExp(r.pattern, "i");
    } catch {
      continue;
    }
    if (re.test(app) && (!best || r.rank > best.rank)) best = r;
  }
  return best ? best.category : "unknown";
}

export function isTrackerOffline(lastSegmentEndMs: number | null, nowMs: number, graceMs: number): boolean {
  if (lastSegmentEndMs === null) return true;
  return nowMs - lastSegmentEndMs > graceMs;
}

/** Which 10-minute window a moment falls in (one screenshot is allowed per window). */
export function shotWindow(atMs: number): number {
  return Math.floor(atMs / SHOT_WINDOW_MS);
}

type SessionLike = { startAt: number; endAt: number | null; breaks: readonly { startAt: number; endAt: number | null }[] };

/**
 * The stretches of time a person was working: each clocked-in session minus its breaks. An open session runs up to `nowMs`; a break
 * that is still open ends the working time at its start. The tracker records only inside these stretches.
 */
export function workingIntervals(sessions: readonly SessionLike[], nowMs: number): Interval[] {
  const out: Interval[] = [];
  for (const s of sessions) {
    const end = s.endAt ?? nowMs;
    let cursor = s.startAt;
    for (const b of [...s.breaks].sort((a, c) => a.startAt - c.startAt)) {
      if (b.startAt > cursor) out.push({ start: cursor, end: Math.min(b.startAt, end) });
      cursor = Math.max(cursor, b.endAt ?? end);
    }
    if (end > cursor) out.push({ start: cursor, end });
  }
  return out.filter((i) => i.end > i.start);
}
