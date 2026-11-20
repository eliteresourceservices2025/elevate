import type { FlagDates } from "./lines";

// The part-period flags of a pay run line, in plain words. Pure: dates are plain YYYY-MM-DD strings. The raw flag names come from
// resolveLines (lines.ts); this turns them into short pills with the real date ("Starts 6 Nov") and the suggested days for a person who
// started or left part-way through the cutoff.

export type FlagKind = "starts" | "ends" | "left" | "rate";

export type FlagPill = { kind: FlagKind; text: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** 2031-01-06 -> "6 Jan". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month}` : iso;
}

/** One pill per flag, with the date when there is one. Order: start, new rate, end, left. */
export function flagPills(flags: readonly string[], dates: FlagDates): FlagPill[] {
  const out: FlagPill[] = [];
  if (flags.includes("starts_mid_period")) out.push({ kind: "starts", text: dates.startsOn ? `Starts ${shortDate(dates.startsOn)}` : "Starts part-way" });
  if (flags.includes("rate_change_mid_period")) out.push({ kind: "rate", text: dates.rateChangeOn ? `New rate ${shortDate(dates.rateChangeOn)}` : "New rate part-way" });
  if (flags.includes("ends_mid_period")) out.push({ kind: "ends", text: dates.endsOn ? `Ends ${shortDate(dates.endsOn)}` : "Ends part-way" });
  if (flags.includes("person_left")) out.push({ kind: "left", text: "Has left" });
  return out;
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * The days to suggest for a person who started or left part-way: the weekdays (Monday to Friday) from the later of their first day and the
 * cutoff's first day to the earlier of their last day and the cutoff's last day, at most the cutoff divisor (a full cutoff). Holidays and
 * the person's own schedule are not applied, so this is only a starting point the Preparer checks. 0 when the dates don't overlap.
 */
export function suggestedDays(dates: Pick<FlagDates, "startsOn" | "endsOn">, period: { start: string; end: string }, divisor: number): number {
  const from = dates.startsOn && dates.startsOn > period.start ? dates.startsOn : period.start;
  const to = dates.endsOn && dates.endsOn < period.end ? dates.endsOn : period.end;
  if (from > to) return 0;
  let days = 0;
  for (let d = dayNumber(from); d <= dayNumber(to); d++) {
    const weekday = new Date(d * 86_400_000).getUTCDay(); // 0 is Sunday
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return Math.min(days, Math.max(1, Math.floor(divisor)));
}
