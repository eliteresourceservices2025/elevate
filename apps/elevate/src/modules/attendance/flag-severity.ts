// Pure rules shared by the hours review screen (browser) and the approval actions (server): which flags are harmless,
// which block a day, and which the server refuses to approve at all. Keep this file free of server-only imports.

/** Flags that do not stop "approve everything that looks fine": informational, or already explained. */
export const CLEAN_FLAGS: ReadonlySet<string> = new Set(["on_leave", "corrected", "extra_hours"]);

/** Flags that mark a day as "Blocked" in hours review: it needs a decision or a fix before it is approved. */
export const BLOCKING_FLAGS: ReadonlySet<string> = new Set(["open_session", "long_session", "absent", "unapproved_extra"]);

/** Flags whose hours are probably wrong: the server refuses to approve the day until the cause is fixed (no "approve with a note"). */
export const HARD_STOP_FLAGS: ReadonlySet<string> = new Set(["open_session", "long_session"]);

export type FlagSeverity = "clean" | "review" | "blocked";

export function flagSeverity(flag: string): FlagSeverity {
  if (BLOCKING_FLAGS.has(flag)) return "blocked";
  return CLEAN_FLAGS.has(flag) ? "clean" : "review";
}

/** The worst severity among some flags ("clean" when there are none). */
export function worstSeverity(flags: readonly string[]): FlagSeverity {
  let worst: FlagSeverity = "clean";
  for (const flag of flags) {
    const s = flagSeverity(flag);
    if (s === "blocked") return "blocked";
    if (s === "review") worst = "review";
  }
  return worst;
}
