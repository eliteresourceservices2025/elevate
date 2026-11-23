import type { ClockStatus } from "./queries";

type Watched = Pick<ClockStatus, "state" | "sessionStartMs" | "breakStartMs" | "currentClientId" | "currentProjectId" | "needsSelfie">;

/**
 * Whether the person's clock is in a different state than the one the header shows: clocked in, on a break, clocked out, a new session or
 * another client or project. The header checks now and then so a click made in the ELEVATE Tracker App shows here without a refresh.
 */
export function clockStatusChanged(shown: Watched | null, latest: Watched | null): boolean {
  if (!shown || !latest) return Boolean(shown) !== Boolean(latest);
  return (
    shown.state !== latest.state ||
    shown.sessionStartMs !== latest.sessionStartMs ||
    shown.breakStartMs !== latest.breakStartMs ||
    shown.currentClientId !== latest.currentClientId ||
    shown.currentProjectId !== latest.currentProjectId
  );
}
