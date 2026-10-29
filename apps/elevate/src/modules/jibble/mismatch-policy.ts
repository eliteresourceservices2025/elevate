import type { BreakMode, JibbleState } from "./mirror-rules";

/** Classification requires reliable event evidence; a state snapshot alone cannot establish which action happened last. */
export type OutMismatchCause = "confirmed_elevate_clock_out" | "confirmed_jibble_clock_in" | "unknown";
export type MismatchDecision = "aligned" | "unknown" | "notify_person_and_lead" | "draft_correction" | "stop_jibble" | "review";

/** Policy only: callers must enforce authorization, monitoring rules, coordination and fresh state before acting. */
export function decideMismatch(input: {
  elevate: "working" | "break" | "out";
  jibble: JibbleState | null;
  breakMode: BreakMode;
  outCause: OutMismatchCause;
}): MismatchDecision {
  const { elevate, jibble, breakMode, outCause } = input;
  if (jibble === null) return "unknown";
  if (elevate === "working") return jibble === "in" ? "aligned" : "notify_person_and_lead";
  if (elevate === "out") {
    if (jibble === "out") return "aligned";
    if (outCause === "confirmed_elevate_clock_out") return "stop_jibble";
    if (outCause === "confirmed_jibble_clock_in" && jibble === "in") return "draft_correction";
    return "review";
  }
  if ((breakMode === "off" && jibble === "in") || (breakMode === "clock" && jibble === "out") || (breakMode === "native" && jibble === "break")) return "aligned";
  return "review";
}
