// Which version of a pay line applies to a pay period. Pure: no database, no time zone (dates are plain YYYY-MM-DD strings).

export type LineFlag = "rate_change_mid_period" | "starts_mid_period" | "ends_mid_period";

export type LineVersion = {
  lineKey: string;
  effectiveFrom: string;
  endsOn: string | null;
  createdAt: Date | string | number;
};

export type ResolvedLine<V extends LineVersion = LineVersion> = { version: V; flags: LineFlag[] };

/** The dates behind a line's part-period flags, for wording like "Starts 6 Nov". Each is null when that flag does not apply. */
export type FlagDates = { startsOn: string | null; endsOn: string | null; rateChangeOn: string | null };

/**
 * The dates the flags of `resolveLines` are about, for one line: when it starts (when its paid version begins after the period began), the
 * first new rate dated inside the period (after the paid version), and when it ends (when its last day falls before the period's last day).
 * `paidFrom` is the effective date of the version the run pays.
 */
export function flagDatesOf(versions: LineVersion[], paidFrom: string, period: { start: string; end: string }): FlagDates {
  const lastDay = lineLastDay(versions);
  const live = lastDay === null ? versions : versions.filter((v) => v.effectiveFrom <= lastDay);
  const later = live
    .map((v) => v.effectiveFrom)
    .filter((d) => d > paidFrom && d > period.start && d <= period.end)
    .sort();
  return {
    startsOn: paidFrom > period.start ? paidFrom : null,
    rateChangeOn: later[0] ?? null,
    endsOn: lastDay !== null && lastDay >= period.start && lastDay < period.end ? lastDay : null,
  };
}

/** What identifies a job: who, for which client (or none), under which alias. */
export type JobKey = { employeeId: string; clientId: string | null; alias: string | null };

/**
 * True when two lines are the same job of the same person: the same alias (ignoring case and spaces) and the same client, or one of them has
 * no client (a leftover line without its client is the same job). Two such lines each pay a full cutoff, so the person is paid twice.
 */
export function sameJob(a: JobKey, b: JobKey): boolean {
  if (a.employeeId !== b.employeeId) return false;
  if ((a.alias ?? "").trim().toLowerCase() !== (b.alias ?? "").trim().toLowerCase()) return false;
  return a.clientId === b.clientId || a.clientId === null || b.clientId === null;
}

/** A date one day earlier (plain YYYY-MM-DD strings, no time zone). */
function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * A newer line for the same job takes over from its first day: the older line (same person, same alias, same client or one with none) is
 * cut off the day before, so it can never pay on top of the newer one. Without this, an old line that was only ended later (or never) and a
 * new line added for the same job both resolve and the person is paid twice for the overlap. Returns the versions with the older line's end
 * dates lowered to that day (copies; the stored rows are not touched). A line's own earlier end date is kept. Two lines that start on the
 * same day are left alone (nothing says which one is right: the "paid twice" note covers that). Versions that carry no person are ignored.
 */
export function applySupersede<V extends LineVersion & Partial<JobKey>>(versions: V[]): V[] {
  type Line = { key: string; job: JobKey; first: string; last: string | null };
  const byKey = new Map<string, V[]>();
  for (const v of versions) byKey.set(v.lineKey, [...(byKey.get(v.lineKey) ?? []), v]);
  const lines: Line[] = [];
  for (const [key, group] of byKey) {
    const head = group[0];
    if (head.employeeId === undefined) continue;
    const last = lineLastDay(group);
    const live = last === null ? group : group.filter((v) => v.effectiveFrom <= last);
    if (live.length === 0) continue;
    const first = live.reduce((min, v) => (v.effectiveFrom < min ? v.effectiveFrom : min), live[0].effectiveFrom);
    // The newest version names the job (a Change may have moved it to another client or alias).
    const named = [...live].sort(newestFirst)[0];
    lines.push({ key, job: { employeeId: named.employeeId!, clientId: named.clientId ?? null, alias: named.alias ?? null }, first, last });
  }
  const cap = new Map<string, string>();
  for (const older of lines) {
    for (const newer of lines) {
      if (older === newer || !sameJob(older.job, newer.job)) continue;
      if (!(older.first < newer.first)) continue;
      if (older.last !== null && older.last < newer.first) continue; // already ended before the newer one began
      const to = dayBefore(newer.first);
      const had = cap.get(older.key);
      if (had === undefined || to < had) cap.set(older.key, to);
    }
  }
  if (cap.size === 0) return versions;
  return versions.map((v) => {
    const to = cap.get(v.lineKey);
    return to === undefined ? v : { ...v, endsOn: v.endsOn !== null && v.endsOn < to ? v.endsOn : to };
  });
}

/** The line's last day: the earliest end date on any of its versions, or null while it has not ended. */
export function lineLastDay(versions: LineVersion[]): string | null {
  let last: string | null = null;
  for (const v of versions) if (v.endsOn !== null && (last === null || v.endsOn < last)) last = v.endsOn;
  return last;
}

const stamp = (v: LineVersion) => new Date(v.createdAt).getTime();

/** Newest first: later effective date, then later created_at. */
const newestFirst = (a: LineVersion, b: LineVersion) =>
  a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : stamp(b) - stamp(a);

/**
 * One result per line key, never two. The version in force on the first day of the period is paid; a raise dated inside the period
 * does not change the pay for this period, it only raises `rate_change_mid_period` so a person looks at it. A line whose first version
 * starts inside the period is included with `starts_mid_period`; one that starts later is left out. A line that ended before the
 * period is left out; one that ends inside it carries `ends_mid_period`. A line the same job's newer line replaced (`applySupersede`) counts as
 * ended the day before the newer one starts.
 */
export function resolveLines<V extends LineVersion & Partial<JobKey>>(input: V[], period: { start: string; end: string }): ResolvedLine<V>[] {
  const versions = applySupersede(input);
  const byKey = new Map<string, V[]>();
  for (const v of versions) byKey.set(v.lineKey, [...(byKey.get(v.lineKey) ?? []), v]);

  const out: ResolvedLine<V>[] = [];
  for (const group of byKey.values()) {
    const lastDay = lineLastDay(group);
    // A version dated after the line's last day never applies (a raise saved for later, then the person left).
    const live = lastDay === null ? group : group.filter((v) => v.effectiveFrom <= lastDay);
    const sorted = [...live].sort(newestFirst);
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

    if (lastDay !== null) {
      if (lastDay < period.start) continue;
      if (lastDay < period.end) flags.push("ends_mid_period");
    }
    out.push({ version: chosen, flags });
  }
  return out;
}
