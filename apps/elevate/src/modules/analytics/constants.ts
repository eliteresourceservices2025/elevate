// People analytics (Phase 4.3): shared constants. Pure, no database.

/** A group or cell built from fewer people than this is never shown with its number. */
export const MIN_GROUP = 5;

export const DIM_KINDS = ["company", "team", "client", "downline"] as const;
export type DimKind = (typeof DIM_KINDS)[number];

/** The id stored for the "company" dimension (primary keys cannot be null). */
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Date ranges the dashboards offer, in months. */
export const RANGES = [3, 6, 12] as const;
export type RangeMonths = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeMonths = 12;

/** The first run (no snapshots yet) and the self-heal window reach this far back. */
export const BACKFILL_DAYS = 366;
/** Every run rebuilds at least this many recent days, so a late edit to the source tables settles. */
export const RECENT_REBUILD_DAYS = 7;

export const FUNNEL_STAGES = ["applied", "screening", "interview", "assessment", "offer", "hired", "rejected"] as const;
export const FUNNEL_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected or withdrawn",
};

/** Attendance flags that count as "extra hours" (one per person and day, however many apply). */
export const EXTRA_FLAGS = ["extra_hours", "rest_day_work", "holiday_work"] as const;

export const FEWER_THAN = "fewer than 5";
