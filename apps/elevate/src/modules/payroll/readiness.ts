import type { RunCheck } from "./checks";
import type { CheckCode } from "./constants";

// The readiness screen groups a run's checks by person and splits them into "must fix" (they stop the run) and "review" (they don't, but a
// person should look). Pure: the page passes the checks it already has. A check names a person and what to look at, never an amount.

/**
 * Checks that are easy to overlook and cost the most when they are: waiting suggestions, no client hours, no payout details and pay for
 * part of a period. They come first inside a person's list and carry a stronger mark.
 */
export const PRIORITY_CHECKS: readonly CheckCode[] = ["pending_suggestions", "no_client_hours", "no_payout_details", "partial_exceeds_cutoff", "new_or_leaving", "rate_change_mid_period"];

export type ReadinessItem = RunCheck & { priority: boolean };

export type ReadinessPerson = {
  key: string;
  name: string;
  runLineId: string | null;
  /** Checks that stop the run (or its approval). */
  must: ReadinessItem[];
  /** Checks that do not stop it but should be looked at. */
  review: ReadinessItem[];
};

export type Readiness = {
  /** Checks about the whole run (lines out of date), not one person. */
  runLevel: { must: ReadinessItem[]; review: ReadinessItem[] };
  people: ReadinessPerson[];
  mustCount: number;
  reviewCount: number;
  /** People with at least one check. */
  peopleCount: number;
};

const item = (c: RunCheck): ReadinessItem => ({ ...c, priority: PRIORITY_CHECKS.includes(c.code) });
const byPriority = (a: ReadinessItem, b: ReadinessItem) => Number(b.priority) - Number(a.priority);

export function groupReadiness(blocking: readonly RunCheck[], warnings: readonly RunCheck[]): Readiness {
  const runLevel: Readiness["runLevel"] = { must: [], review: [] };
  const people = new Map<string, ReadinessPerson>();
  const personFor = (c: RunCheck): ReadinessPerson => {
    // One person with two lines (two clients) shows once per line, so a link goes to the right row.
    const key = c.runLineId ?? c.employeeId ?? c.name;
    let p = people.get(key);
    if (!p) {
      p = { key, name: c.name, runLineId: c.runLineId, must: [], review: [] };
      people.set(key, p);
    }
    return p;
  };
  for (const c of blocking) (c.employeeId === null && c.runLineId === null ? runLevel.must : personFor(c).must).push(item(c));
  for (const c of warnings) (c.employeeId === null && c.runLineId === null ? runLevel.review : personFor(c).review).push(item(c));

  const list = [...people.values()];
  for (const p of list) {
    p.must.sort(byPriority);
    p.review.sort(byPriority);
  }
  // Someone with a must-fix first, then the most to review, then by name.
  list.sort((a, b) => Number(b.must.length > 0) - Number(a.must.length > 0) || b.review.length - a.review.length || a.name.localeCompare(b.name));
  runLevel.must.sort(byPriority);
  runLevel.review.sort(byPriority);

  return {
    runLevel,
    people: list,
    mustCount: blocking.length,
    reviewCount: warnings.length,
    peopleCount: list.length,
  };
}
