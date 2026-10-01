// Pure rules for the applicant tracking system (C1). No database, no server-only: used by the board, the actions and the tests.

export const STAGES = ["applied", "screening", "interview", "assessment", "offer", "hired", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

/** Columns on the board: rejected people are listed apart from the active pipeline. */
export const BOARD_STAGES = STAGES.filter((s) => s !== "rejected");

export const OPENING_STATUSES = ["draft", "open", "closed"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];

/** How an application ended without a hire. Retention differs: rejected 12 months, withdrawn 6 (counsel to confirm). */
export const CLOSE_KINDS = ["rejected", "withdrawn"] as const;
export type CloseKind = (typeof CLOSE_KINDS)[number];

export const RECOMMENDATIONS = ["strong_yes", "yes", "no", "strong_no"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const RECOMMENDATION_LABELS: Record<Recommendation, string> = { strong_yes: "Strong yes", yes: "Yes", no: "No", strong_no: "Strong no" };

/** What an interviewer rates, 1 (weak) to 5 (excellent). */
export const CRITERIA = [
  { key: "communication", label: "Communication" },
  { key: "skills", label: "Role skills" },
  { key: "reliability", label: "Reliability and work habits" },
  { key: "culture", label: "Team fit" },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]["key"];

export const INTERVIEW_KINDS = ["screening_call", "interview", "assessment_review", "final"] as const;
export const INTERVIEW_KIND_LABELS: Record<(typeof INTERVIEW_KINDS)[number], string> = {
  screening_call: "Screening call",
  interview: "Interview",
  assessment_review: "Assessment review",
  final: "Final interview",
};

export const RESUME_MAX_BYTES = 4 * 1024 * 1024; // Vercel functions accept about 4.5 MB of request body
export const RESUME_KINDS = ["pdf", "docx"] as const;

/** Retention defaults, in months. Nothing is purged until HR switches the job on (settings). */
export const DEFAULT_RETENTION = { rejectedMonths: 12, withdrawnMonths: 6 } as const;

/**
 * Whether an application may move from one stage to another. Any open stage can go to any other open stage (people are
 * sent back for a second look), rejection needs a reason (checked by the action), and a hire is final.
 */
export function canMove(from: Stage, to: Stage): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: "They are already in that stage." };
  if (from === "hired") return { ok: false, reason: "A hired person cannot be moved." };
  if (from === "rejected" && to === "hired") return { ok: false, reason: "Reopen the application first (move it to a stage), then hire." };
  return { ok: true };
}

/** Only an open opening can be applied to. */
export const isApplyable = (status: OpeningStatus, archived: boolean) => status === "open" && !archived;

/** The average of the ratings an interviewer gave (2 decimals), or null when none. */
export function averageRating(ratings: Partial<Record<CriterionKey, number>>): number | null {
  const values = Object.values(ratings).filter((n): n is number => typeof n === "number");
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

/** Months before a closed application's personal data is removed, or null if it is not closed that way. */
export function retentionMonths(kind: CloseKind | null, settings: { rejectedMonths: number; withdrawnMonths: number }): number | null {
  if (kind === "rejected") return settings.rejectedMonths;
  if (kind === "withdrawn") return settings.withdrawnMonths;
  return null;
}
