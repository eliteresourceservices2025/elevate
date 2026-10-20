/** Plain words for the kinds of technical issue a person can report (shared by the form, the lists and the notices). */
export const ISSUE_KIND_LABELS = {
  clock: "The ELEVATE clock did not work",
  jibble: "Jibble did not work (screenshots, clock in or out)",
  internet_power: "Internet or power outage",
  device: "My computer or device failed",
  other: "Something else",
} as const;
