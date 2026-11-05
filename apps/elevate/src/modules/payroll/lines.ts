// Which version of a pay line applies to a pay period. Pure: no database, no time zone (dates are plain YYYY-MM-DD strings).

export type LineFlag = "rate_change_mid_period" | "starts_mid_period" | "ends_mid_period";

export type LineVersion = {
  lineKey: string;
  effectiveFrom: string;
  endsOn: string | null;
  createdAt: Date | string | number;
};

export type ResolvedLine<V extends LineVersion = LineVersion> = { version: V; flags: LineFlag[] };

const stamp = (v: LineVersion) => new Date(v.createdAt).getTime();

/** Newest first: later effective date, then later created_at. */
const newestFirst = (a: LineVersion, b: LineVersion) =>
  a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : stamp(b) - stamp(a);

/**
 * One result per line key, never two. The version in force on the first day of the period is paid; a raise dated inside the period
 * does not change the pay for this period, it only raises `rate_change_mid_period` so a person looks at it. A line whose first version
 * starts inside the period is included with `starts_mid_period`; one that starts later is left out. A line that ended before the
 * period is left out; one that ends inside it carries `ends_mid_period`.
 */
export function resolveLines<V extends LineVersion>(versions: V[], period: { start: string; end: string }): ResolvedLine<V>[] {
  const byKey = new Map<string, V[]>();
  for (const v of versions) byKey.set(v.lineKey, [...(byKey.get(v.lineKey) ?? []), v]);

  const out: ResolvedLine<V>[] = [];
  for (const group of byKey.values()) {
    const sorted = [...group].sort(newestFirst);
    const atStart = sorted.find((v) => v.effectiveFrom <= period.start);
    const inside = sorted.filter((v) => v.effectiveFrom > period.start && v.effectiveFrom <= period.end);
    const flags: LineFlag[] = [];

    let chosen: V | undefined;
    if (atStart) {
      chosen = atStart;
      if (inside.length > 0) flags.push("rate_change_mid_period");
    } else if (inside.length > 0) {
      const firstDate = inside.reduce((min, v) => (v.effectiveFrom < min ? v.effectiveFrom : min), inside[0].effectiveFrom);
      chosen = inside.find((v) => v.effectiveFrom === firstDate); // newest created_at on that date (sorted newest first)
      flags.push("starts_mid_period");
      if (inside.some((v) => v.effectiveFrom > firstDate)) flags.push("rate_change_mid_period");
    }
    if (!chosen) continue;

    if (chosen.endsOn !== null) {
      if (chosen.endsOn < period.start) continue;
      if (chosen.endsOn < period.end) flags.push("ends_mid_period");
    }
    out.push({ version: chosen, flags });
  }
  return out;
}
