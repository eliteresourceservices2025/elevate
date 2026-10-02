// Lists and limits for Safe Voice. The category, status and outcome lists must equal the ones in
// apps/elevate/src/modules/safevoice/constants.ts (a test in the ELEVATE integration suite checks it; the database checks them too).

export const CATEGORIES = ["harassment", "discrimination", "retaliation", "safety", "fraud_or_ethics", "management_conduct", "client_conduct", "other"] as const;
export const STATUSES = ["new", "in_review", "awaiting_reporter", "closed"] as const;
export const OUTCOMES = ["substantiated", "partly_substantiated", "not_substantiated", "no_action", "referred", "unable_to_determine"] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  harassment: "Harassment or bullying",
  discrimination: "Discrimination",
  retaliation: "Retaliation",
  safety: "Health, safety or wellbeing",
  fraud_or_ethics: "Fraud, theft or ethics",
  management_conduct: "Manager or leadership conduct",
  client_conduct: "Client conduct toward a team member",
  other: "Something else",
};

export const STATUS_LABELS: Record<string, string> = {
  new: "Received. Not yet picked up.",
  in_review: "Being looked at by a handler.",
  awaiting_reporter: "A handler has asked you something. Please reply below.",
  closed: "Closed",
};

export const OUTCOME_LABELS: Record<string, string> = {
  substantiated: "Substantiated",
  partly_substantiated: "Partly substantiated",
  not_substantiated: "Not substantiated",
  no_action: "No action needed",
  referred: "Referred elsewhere",
  unable_to_determine: "Could not be determined",
};

export const LIMITS = {
  descriptionMin: 10,
  descriptionMax: 8000,
  messageMax: 4000,
  /** Up to this many files per report or reply. */
  maxFiles: 3,
  /** All files together in one request. Vercel's request body limit is 4.5 MB, so the whole request stays under it. */
  maxTotalBytes: 4_000_000,
  /** The multipart envelope and the text fields on top of the files. */
  maxRequestBytes: 4_300_000,
  maxPdfPages: 40,
  /** Pixels in an uploaded picture (protects against decompression bombs). */
  maxImagePixels: 40_000_000,
  /** Re-encoded pictures are at most this wide or tall. */
  maxImageEdge: 2400,
} as const;

/** One message for every failed sign-in with a case code and passphrase: a wrong code and a wrong passphrase look identical. */
export const BAD_CREDENTIALS = "We could not open a case with that code and passphrase. Check both and try again.";
export const RATE_LIMITED = "Too many tries. Please wait a while and try again.";
export const GENERIC_ERROR = "Something went wrong. Nothing was saved. Please try again.";
