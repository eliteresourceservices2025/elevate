// Pure layout of a day's recording into blocks for the timeline strip. No React and no database: segments in, percentages out.

export type TimelineKind = "active" | "idle" | "working";
export type TimelineBlock = { leftPct: number; widthPct: number; kind: TimelineKind; label: string };

type Seg = { start: string; end: string; app: string; state: "active" | "idle" };
type Span = { start: string; end: string };

const HOUR = 3_600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function layoutTimeline(input: { segments: readonly Seg[]; working: readonly Span[]; dayStart: number; dayEnd: number; formatTime: (ms: number) => string }): TimelineBlock[] {
  const { dayStart, dayEnd, formatTime } = input;
  const length = dayEnd - dayStart;
  if (length <= 0) return [];
  const pct = (ms: number) => ((ms - dayStart) / length) * 100;

  const clamp = (s: number, e: number) => {
    const start = Math.max(s, dayStart);
    const end = Math.min(e, dayEnd);
    return end > start ? { start, end } : null;
  };

  const blocks: TimelineBlock[] = [];
  for (const w of input.working) {
    const c = clamp(Date.parse(w.start), Date.parse(w.end));
    if (c) blocks.push({ leftPct: round2(pct(c.start)), widthPct: round2(pct(c.end) - pct(c.start)), kind: "working", label: `Clocked in, ${formatTime(c.start)} to ${formatTime(c.end)}` });
  }

  // Merge touching stretches of the same app and state, so a long spell in one app is one block.
  const merged: { start: number; end: number; app: string; state: "active" | "idle" }[] = [];
  for (const s of [...input.segments].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const c = clamp(Date.parse(s.start), Date.parse(s.end));
    if (!c) continue;
    const last = merged.at(-1);
    if (last && last.app === s.app && last.state === s.state && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c, app: s.app, state: s.state });
  }
  for (const m of merged) {
    blocks.push({ leftPct: round2(pct(m.start)), widthPct: round2(pct(m.end) - pct(m.start)), kind: m.state, label: `${m.app}, ${formatTime(m.start)} to ${formatTime(m.end)}, ${m.state}` });
  }
  return blocks;
}

/** A label every 2 hours from the start of the day (at most 12). */
export function hourTicks(dayStart: number, dayEnd: number, formatHour: (ms: number) => string): { leftPct: number; label: string }[] {
  const length = dayEnd - dayStart;
  if (length <= 0) return [];
  const ticks: { leftPct: number; label: string }[] = [];
  for (let t = dayStart; t < dayEnd && ticks.length < 12; t += 2 * HOUR) ticks.push({ leftPct: round2(((t - dayStart) / length) * 100), label: formatHour(t) });
  return ticks;
}
