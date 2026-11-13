import type { RunStatus } from "./constants";

// The runs list: where a run is in its life, what the viewer should do next, and the summary tiles. Pure: the query passes what it read.
// Counts and dates only, never an amount.

/** The four steps shown as a progress line. Cancelled runs have none (0). */
export const RUN_STEPS = ["Prepared", "In review", "Approved", "Paid"] as const;

export function stepOf(status: RunStatus): 0 | 1 | 2 | 3 | 4 {
  return status === "draft" ? 1 : status === "in_review" ? 2 : status === "approved" ? 3 : status === "paid" ? 4 : 0;
}

export type ViewerRights = { prepare: boolean; approve: boolean; markPaid: boolean; release: boolean };

export type RunFacts = { status: RunStatus; isTest: boolean; peopleCount: number; paidCount: number; released: boolean };

/** What this viewer does next on the run, or null when nothing is theirs to do (and a note when they are waiting). */
export function nextStepOf(run: RunFacts, rights: ViewerRights): { label: string; mine: boolean } | null {
  switch (run.status) {
    case "draft":
      return rights.prepare ? { label: "Continue", mine: true } : null;
    case "in_review":
      return rights.approve ? { label: "Approve", mine: true } : { label: "Waiting for approval", mine: false };
    case "approved":
      return rights.markPaid ? { label: `Mark payments (${run.paidCount} of ${run.peopleCount})`, mine: true } : { label: `${run.paidCount} of ${run.peopleCount} paid`, mine: false };
    case "paid":
      if (run.isTest) return null;
      if (run.released) return { label: "Statements released", mine: false };
      return rights.release ? { label: "Release statements", mine: true } : { label: "Statements not released yet", mine: false };
    default:
      return null;
  }
}

const DAY_MS = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY_MS);

/** "October, second cutoff" for a 1st-15th or 16th-end period; "Custom period" for anything else (a test run may cover any dates). */
export function periodSubtitle(periodStart: string, periodEnd: string): string {
  const [y, m, d] = periodStart.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = d === 1 && periodEnd === `${periodStart.slice(0, 8)}15`;
  const second = d === 16 && periodEnd === `${periodStart.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;
  if (!first && !second) return "Custom period";
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return `${month}, ${first ? "first" : "second"} cutoff`;
}

export type CutoffPeriod = { start: string; end: string };

/**
 * The oldest of the recent cutoffs that has no real run yet, with how far it is from ending. `recent` is the current cutoff and the ones
 * before it (newest first); `realStarts` holds the first day of every real run that exists. Null when all of them have a run.
 */
export function nextCutoff(recent: CutoffPeriod[], realStarts: ReadonlySet<string>, today: string): { start: string; end: string; daysLeft: number } | null {
  const open = [...recent].reverse().find((p) => !realStarts.has(p.start));
  if (!open) return null;
  return { start: open.start, end: open.end, daysLeft: daysBetween(today, open.end) };
}

export function cutoffNote(daysLeft: number): string {
  if (daysLeft > 1) return `The cutoff ends in ${daysLeft} days`;
  if (daysLeft === 1) return "The cutoff ends tomorrow";
  if (daysLeft === 0) return "The cutoff ends today";
  return `The cutoff ended ${-daysLeft} ${daysLeft === -1 ? "day" : "days"} ago`;
}

export type RunsView = "all" | "action" | "test";

export function parseView(raw: unknown): RunsView {
  return raw === "action" || raw === "test" ? raw : "all";
}

export { shortRange } from "@/lib/short-range";
