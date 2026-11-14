// The "paying from" and "last paid" choices on the Rates tab: pay cutoffs instead of raw dates. Pure: no database, no clock (today and the
// cutoffs that already have a real run are passed in). The value a form sends is still a plain date, so nothing downstream changes.

import { addDays, periodContaining } from "@/modules/attendance/pay-periods";
import { shortRange } from "@/lib/short-range";

export type CutoffChoice = {
  /** First day of the cutoff. */
  start: string;
  /** Last day of the cutoff. */
  end: string;
  /** "Nov 1 to 15". */
  range: string;
  /** What the person sees: "Nov 1 to 15 (being prepared)". */
  label: string;
  /** This is the cutoff the next real run is for: the default choice. */
  beingPrepared: boolean;
};

const cutoff = (date: string) => periodContaining("semi_monthly", date);

/**
 * The cutoffs worth choosing from, the default first: the one being prepared (the oldest of the last three with no real run yet; the next one
 * when all three have a run) and the cutoff after it. A cutoff before the one being prepared always has a real run, so it is never offered:
 * a rate cannot change a run that is already made. `realStarts` holds the first day of every real run that is not cancelled.
 */
export function cutoffChoices(today: string, realStarts: ReadonlySet<string>): CutoffChoice[] {
  const current = cutoff(today);
  const prev = cutoff(addDays(current.start, -1));
  const prev2 = cutoff(addDays(prev.start, -1));
  const next = cutoff(addDays(current.end, 1));
  const preparing = [prev2, prev, current].find((p) => !realStarts.has(p.start)) ?? next;
  const after = cutoff(addDays(preparing.end, 1));

  const out: CutoffChoice[] = [];
  const add = (p: { start: string; end: string }, beingPrepared: boolean) => {
    if (out.some((c) => c.start === p.start)) return;
    const range = shortRange(p.start, p.end);
    out.push({ start: p.start, end: p.end, range, label: beingPrepared ? `${range} (being prepared)` : range, beingPrepared });
  };
  add(preparing, true);
  add(after, false);
  return out;
}

/** The choices that can still apply to a line: a new version can't start before the version in force does. */
export function startChoicesFor(choices: CutoffChoice[], notBefore: string): CutoffChoice[] {
  return choices.filter((c) => c.start >= notBefore);
}

/** Quick reasons for the change history, so nobody has to type one. "Other" asks for words. */
export const UPDATE_REASONS = ["Raise", "New contract", "Correction", "Other"] as const;
export const DETAIL_REASONS = ["Correction", "Changed client", "Other"] as const;
export const STOP_REASONS = ["Left the company", "Contract ended", "Moved to another client", "Other"] as const;

/** The reason text to send: the quick pick, or what was typed under "Other". Blank when "Other" has no words yet. */
export function reasonText(pick: string, other: string): string {
  return pick === "Other" ? other.trim() : pick;
}
