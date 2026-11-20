// Plain words for codes shown on the pages. Shared by server and client components.

export const SHOT_REASON_LABELS: Record<string, string> = {
  quality_check: "Quality check",
  dispute: "Dispute",
  coaching: "Coaching",
  client_request: "Client request",
};

export const reasonLabel = (reason: string) => SHOT_REASON_LABELS[reason] ?? reason;

export type FloorStateKey = "active" | "idle" | "break" | "offline" | "out";

export const FLOOR_STATE_LABELS: Record<FloorStateKey, string> = {
  active: "Active",
  idle: "Idle",
  break: "On break",
  offline: "Tracker offline",
  out: "Clocked out",
};

/** Short minutes text: "45 min", "2 h 5 min". */
export function minutesText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
