// Pure rules for performance reviews. No database: used by the actions, the pages and the tests.

export const CYCLE_TYPES = ["quarterly", "annual", "early"] as const;
export type CycleType = (typeof CYCLE_TYPES)[number];
export const CYCLE_LABELS: Record<CycleType, string> = { quarterly: "Quarterly", annual: "Annual", early: "Early-engagement" };

export const RATING_LABELS: Record<number, string> = { 1: "Needs improvement", 2: "Below expectations", 3: "Meets expectations", 4: "Exceeds expectations", 5: "Outstanding" };
export const RATINGS = [1, 2, 3, 4, 5] as const;

export const QUESTION_TYPES = ["rating", "text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type Question = { id: string; section: string; prompt: string; type: QuestionType; required: boolean };

/** The built-in short template used for early-engagement reviews until HR makes their own. */
export const DEFAULT_EARLY_QUESTIONS: Omit<Question, "id">[] = [
  { section: "Work so far", prompt: "Quality of work", type: "rating", required: true },
  { section: "Work so far", prompt: "Reliability and communication", type: "rating", required: true },
  { section: "Work so far", prompt: "Fit with the client and the team", type: "rating", required: true },
  { section: "Looking ahead", prompt: "What is going well?", type: "text", required: false },
  { section: "Looking ahead", prompt: "What should improve before the next review?", type: "text", required: false },
];

export const EARLY_MILESTONES = [3, 5] as const;
export type Milestone = (typeof EARLY_MILESTONES)[number];

export const STAGES = ["awaiting_self", "awaiting_lead", "awaiting_hr", "ready_to_share", "shared", "acknowledged"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  awaiting_self: "Waiting for the self review",
  awaiting_lead: "Waiting for the lead's review",
  awaiting_hr: "Waiting for HR to calibrate",
  ready_to_share: "Ready to share",
  shared: "Shared, waiting for acknowledgment",
  acknowledged: "Acknowledged",
};

export type ReviewState = { selfSubmittedAt: Date | null; leadSubmittedAt: Date | null; calibratedAt: Date | null; sharedAt: Date | null; acknowledgedAt: Date | null };

/**
 * Where a review stands. The self review is optional: the lead's review is the next step as soon as it is written, whether or not
 * the person has written theirs (the lead only sees it after submitting their own, so waiting is never forced).
 */
export function stageOf(r: ReviewState): Stage {
  if (r.acknowledgedAt) return "acknowledged";
  if (r.sharedAt) return "shared";
  if (r.calibratedAt) return "ready_to_share";
  if (r.leadSubmittedAt) return "awaiting_hr";
  if (r.selfSubmittedAt) return "awaiting_lead";
  return "awaiting_self";
}

/** YYYY-MM-DD plus whole calendar months, clamped to the end of a shorter month (31 Aug + 6 months = 28 Feb). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The date an early-engagement review comes due: the start date plus 3 or 5 months. */
export const milestoneDate = (startDate: string, milestone: Milestone) => addMonths(startDate, milestone);

/**
 * Early reviews that should be opened today: a milestone whose date has arrived (within the last 31 days, so a job outage is made up
 * but old history is never back-filled) and that was not opened before.
 */
export function dueMilestones(startDate: string, today: string, already: readonly number[]): Milestone[] {
  return EARLY_MILESTONES.filter((m) => {
    const due = milestoneDate(startDate, m);
    return due <= today && due >= addDays(today, -31) && !already.includes(m);
  });
}

export type Viewer = "person" | "lead" | "hr";

/** What a viewer may see of one review, given where it stands. Pure, so the rules are tested on their own. */
export function visibility(viewer: Viewer, r: ReviewState) {
  const shared = Boolean(r.sharedAt);
  if (viewer === "hr") return { self: true, lead: true, calibration: true, originalLeadRating: true };
  if (viewer === "person") return { self: true, lead: shared, calibration: shared, originalLeadRating: false };
  // The lead sees the self review only once their own is in, and the calibration only once it is shared
  return { self: Boolean(r.leadSubmittedAt), lead: true, calibration: shared, originalLeadRating: shared };
}

export type Answers = Record<string, { rating?: number; text?: string }>;

/** Checks answers against the cycle's questions: every required question answered, ratings 1 to 5, no unknown questions. */
export function checkAnswers(questions: readonly Question[], answers: Answers): string | null {
  const known = new Set(questions.map((q) => q.id));
  for (const id of Object.keys(answers)) if (!known.has(id)) return "That answer does not match a question.";
  for (const q of questions) {
    const a = answers[q.id];
    if (q.type === "rating") {
      if (a?.rating === undefined) {
        if (q.required) return `Please rate: ${q.prompt}`;
      } else if (!Number.isInteger(a.rating) || a.rating < 1 || a.rating > 5) return "Ratings are 1 to 5.";
    } else if (q.required && !(a?.text ?? "").trim()) return `Please answer: ${q.prompt}`;
  }
  return null;
}

/** The average of the rating answers, rounded to the nearest whole rating (a suggested overall rating). */
export function suggestedOverall(questions: readonly Question[], answers: Answers): number | null {
  const rs = questions.filter((q) => q.type === "rating").flatMap((q) => (answers[q.id]?.rating !== undefined ? [answers[q.id].rating as number] : []));
  if (rs.length === 0) return null;
  return Math.min(5, Math.max(1, Math.round(rs.reduce((a, b) => a + b, 0) / rs.length)));
}

export const GOAL_STATUSES = ["not_started", "in_progress", "done", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_LABELS: Record<GoalStatus, string> = { not_started: "Not started", in_progress: "In progress", done: "Done", dropped: "Dropped" };
