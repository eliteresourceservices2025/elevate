import "server-only";
import { rebuildAttendanceDays } from "./jobs";

const DAY_MS = 86_400_000;

/**
 * Rebuilds the person's days from their events after a change, from the day of the earliest event the change touched (a few days of
 * margin for a night shift) up to today. Hours are rebuilt from the events that remain; nothing is edited by hand.
 */
export async function rebuildAfterChange(employeeId: string, earliestMs: number, now = new Date()): Promise<void> {
  const daysBack = Math.max(3, Math.ceil((now.getTime() - earliestMs) / DAY_MS) + 2);
  await rebuildAttendanceDays(now, daysBack, employeeId);
}
