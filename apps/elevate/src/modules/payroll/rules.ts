import { createHash } from "node:crypto";

// Separation of duties and the approval hash. Pure: the caller loads and decrypts everything; nothing here reads a clock or a database.

/**
 * JSON with object keys sorted at every level, and a bigint written as { "$big": "123" } so it can never be confused with a number
 * or a string of the same digits.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === "bigint") return { $big: v.toString() };
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/**
 * SHA-256 (hex) over every line's decrypted payload, sorted by line id. Any change to a figure, a line or an
 * item gives a different hash, so an approval given against one hash is void once anything changes. The result is never
 * stored in the clear: a plain hash of a small amount can be guessed by anyone who can read it.
 */
export function runHash(lines: { id: string; payload: unknown }[]): string {
  const sorted = [...lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash("sha256").update(canonical({ lines: sorted })).digest("hex");
}

export type ApprovalInput = {
  approverId: string;
  /** Everyone who prepared or changed the run (creator, submitter, item enterers, line confirmers, other actors in its change log) and the authors of the pay-line versions it pays, whatever their level is now. */
  touchedBy: string[];
  /** The approver's own lines on the run. */
  ownLines: { confirmedBy: string | null }[];
  blockingChecks: number;
};

/** Why this person may not approve this run, or null when they may. There is no bypass. */
export function approvalRefusal(input: ApprovalInput): string | null {
  if (input.touchedBy.includes(input.approverId)) return "You prepared or changed this run, or wrote a rate it pays, so someone else must approve it.";
  if (input.ownLines.some((l) => l.confirmedBy === null || l.confirmedBy === input.approverId)) {
    return "Your own line on this run must be checked by a Preparer other than you before you can approve it. Send the run back to ask for that.";
  }
  if (input.blockingChecks > 0) return "This run has problems that must be fixed before it can be approved. Send it back to the Preparer.";
  return null;
}
