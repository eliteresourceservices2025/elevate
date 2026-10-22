// The arithmetic behind the recruiting reports. Pure, so the funnel and the percentages are unit tested.

/** Funnel steps in order. An application "reaches" a step when it got to that stage or any later one (people are sometimes moved past a stage). */
export const FUNNEL_STAGES = ["applied", "screening", "interview", "assessment", "offer", "hired"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** How many applications reached each funnel step, from "how many applications got furthest to step i" (index 0 = applied only). */
export function reachedCounts(furthest: Record<number, number>): number[] {
  const out = FUNNEL_STAGES.map(() => 0);
  for (const [idx, n] of Object.entries(furthest)) {
    const furthestStep = Math.min(Math.max(Number(idx), 0), FUNNEL_STAGES.length - 1);
    for (let i = 0; i <= furthestStep; i++) out[i] += n;
  }
  return out;
}

/** n as a whole-number percentage of total, or null when there is nothing to divide by. */
export const percent = (n: number, total: number): number | null => (total > 0 ? Math.round((n / total) * 100) : null);

/** Days as a short phrase ("under a day", "3 days", "1.5 days"), or a dash when there is no data. */
export function formatDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "-";
  if (days < 1) return "under a day";
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}
