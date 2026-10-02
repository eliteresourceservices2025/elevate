// Pure lists and rules for the ELEVATE side of Safe Voice. The category, status and outcome lists must equal the ones in
// apps/safe-voice/src/lib/constants.ts (tests/integration/safevoice.test.ts checks it); the database checks them too.

export const SAFEVOICE_CATEGORIES = ["harassment", "discrimination", "retaliation", "safety", "fraud_or_ethics", "management_conduct", "client_conduct", "other"] as const;
export const SAFEVOICE_STATUSES = ["new", "in_review", "awaiting_reporter", "closed"] as const;
export const SAFEVOICE_OUTCOMES = ["substantiated", "partly_substantiated", "not_substantiated", "no_action", "referred", "unable_to_determine"] as const;

export type SafevoiceCategory = (typeof SAFEVOICE_CATEGORIES)[number];
export type SafevoiceStatus = (typeof SAFEVOICE_STATUSES)[number];
export type SafevoiceOutcome = (typeof SAFEVOICE_OUTCOMES)[number];

export const CATEGORY_LABELS: Record<SafevoiceCategory, string> = {
  harassment: "Harassment or bullying",
  discrimination: "Discrimination",
  retaliation: "Retaliation",
  safety: "Health, safety or wellbeing",
  fraud_or_ethics: "Fraud, theft or ethics",
  management_conduct: "Manager or leadership conduct",
  client_conduct: "Client conduct toward a team member",
  other: "Something else",
};

export const STATUS_LABELS: Record<SafevoiceStatus, string> = { new: "New", in_review: "In review", awaiting_reporter: "Waiting for the reporter", closed: "Closed" };

export const OUTCOME_LABELS: Record<SafevoiceOutcome, string> = {
  substantiated: "Substantiated",
  partly_substantiated: "Partly substantiated",
  not_substantiated: "Not substantiated",
  no_action: "No action needed",
  referred: "Referred elsewhere",
  unable_to_determine: "Could not be determined",
};

/** A category with fewer reports than this is never shown in counts (a small group could point at one person). */
export const MIN_CATEGORY_COUNT = 5;

/** The short reference handlers use for a case (the first part of its internal id). It is not the reporter's case code. */
export const caseReference = (id: string) => `SV-${id.slice(0, 8).toUpperCase()}`;
