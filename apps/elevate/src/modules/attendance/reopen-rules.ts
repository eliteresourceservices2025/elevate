// Pure rules for taking an approval back ("reopening" a day). Shared by hours review (to show the button) and the server (to enforce).
// Keep this file free of server-only imports.

/** A lead can take back only an approval they gave themselves, and only within this long after giving it. */
export const LEAD_REOPEN_WINDOW_MS = 7 * 86_400_000;

/**
 * Whether the person may reopen one approved day. `scope` is their reach for hours.reopen: HR and Super Admin ("all") can reopen any
 * approval; a Team Lead ("team") only their own, within a week. Whether the day is in a payroll run is checked separately (server).
 */
export function mayReopenDay(scope: "all" | "team", actorUserId: string, approval: { approvedBy: string; approvedAt: Date }, nowMs: number): boolean {
  if (scope === "all") return true;
  return approval.approvedBy === actorUserId && nowMs - approval.approvedAt.getTime() <= LEAD_REOPEN_WINDOW_MS;
}
