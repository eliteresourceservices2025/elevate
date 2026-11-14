import { EXTRA_KEYS, type ExtraKey } from "./calculate";
import { BLOCKING_CHECKS, EXTRA_KEY_ITEM, PAY_ITEM_LABELS, type CheckCode } from "./constants";

// Pre-review checks. Pure: the caller loads everything. A check names a person and a code, never an amount.

export type RunCheck = { code: CheckCode; employeeId: string | null; runLineId: string | null; name: string; detail?: string };

export type CheckLine = {
  runLineId: string;
  employeeId: string;
  name: string;
  /** The stored figures could not be decrypted. */
  unreadable: boolean;
  /** From the calculator: missing_multiplier:<key>, negative_net, partial_exceeds_cutoff. */
  issues: string[];
  flags: string[];
  net: bigint | null;
  /** The same line's net in the most recent earlier run; null when there is none. */
  previousNet: bigint | null;
  unapprovedDays: number;
  payoutReady: boolean;
  pendingSuggestions: number;
  /** The line has a client but no client payroll hours (confirmed or suggested): an invoice would have nothing to bill. */
  clientHoursMissing: boolean;
  /** Another live line of the same person on this run has the same client and alias: each pays a full cutoff, so the person is paid twice. */
  duplicateLine: boolean;
  confirmedBy: string | null;
};

export type ChecksInput = {
  lines: CheckLine[];
  /** Suggestions that no pay line has been chosen for. */
  unassigned: { employeeId: string; name: string; count: number }[];
  submitter: { userId: string; employeeId: string | null };
  changeWarnBp: number;
  /** The pay lines now in force for the period differ from the lines this run was built with. */
  linesOutOfDate: boolean;
};

const BLOCKING: ReadonlySet<string> = new Set(BLOCKING_CHECKS);

/** True when net moved from `previous` by more than `bp` basis points (never at exactly the threshold). */
function movedMoreThan(previous: bigint, net: bigint, bp: number): boolean {
  const diff = net > previous ? net - previous : previous - net;
  const base = previous < 0n ? -previous : previous;
  if (base === 0n) return diff > 0n;
  return diff * 10_000n > BigInt(bp) * base;
}

export function runChecks(input: ChecksInput): { blocking: RunCheck[]; warnings: RunCheck[] } {
  const found: RunCheck[] = [];
  const add = (l: CheckLine, code: CheckCode, detail?: string) =>
    found.push({ code, employeeId: l.employeeId, runLineId: l.runLineId, name: l.name, ...(detail ? { detail } : {}) });

  for (const l of input.lines) {
    if (l.unreadable) add(l, "unreadable_line");
    else {
      for (const issue of l.issues) {
        if (issue === "negative_net") add(l, "negative_net");
        else if (issue === "partial_exceeds_cutoff") add(l, "partial_exceeds_cutoff");
        else if (issue.startsWith("missing_multiplier:")) {
          const key = issue.slice("missing_multiplier:".length);
          const known = (EXTRA_KEYS as readonly string[]).includes(key);
          add(l, "missing_multiplier", known ? PAY_ITEM_LABELS[EXTRA_KEY_ITEM[key as ExtraKey]] : undefined);
        }
      }
      if (l.net !== null && l.previousNet !== null && movedMoreThan(l.previousNet, l.net, input.changeWarnBp)) add(l, "large_change");
    }

    if (input.submitter.employeeId !== null && l.employeeId === input.submitter.employeeId && (l.confirmedBy === null || l.confirmedBy === input.submitter.userId)) {
      add(l, "own_line_unconfirmed");
    }
    if (l.unapprovedDays > 0) add(l, "unapproved_days", String(l.unapprovedDays));
    if (!l.payoutReady) add(l, "no_payout_details");
    if (l.flags.includes("starts_mid_period") || l.flags.includes("ends_mid_period") || l.flags.includes("person_left")) add(l, "new_or_leaving");
    if (l.flags.includes("rate_change_mid_period")) add(l, "rate_change_mid_period");
    if (l.pendingSuggestions > 0) add(l, "pending_suggestions", String(l.pendingSuggestions));
    if (l.clientHoursMissing) add(l, "no_client_hours");
    if (l.duplicateLine) add(l, "duplicate_pay_line");
  }
  if (input.linesOutOfDate) found.push({ code: "lines_out_of_date", employeeId: null, runLineId: null, name: "This run" });
  for (const u of input.unassigned) {
    found.push({ code: "unassigned_suggestion", employeeId: u.employeeId, runLineId: null, name: u.name, detail: String(u.count) });
  }

  return { blocking: found.filter((c) => BLOCKING.has(c.code)), warnings: found.filter((c) => !BLOCKING.has(c.code)) };
}
