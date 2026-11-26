import "server-only";
import { after } from "next/server";

/** Yesterday and today in the person's own zone, with a day of margin for a night shift or a session left open. */
const DAYS_BACK = 2;

/**
 * Rebuilds the person's recent days after a clock event, so hours review shows it at once instead of after the nightly run. It runs after the
 * response is sent (the clock never waits for it) and is awaited where there is no request. A failure is only logged: the nightly job repairs.
 */
export async function refreshAfterClock(employeeId: string): Promise<void> {
  const run = async () => {
    try {
      const { rebuildAttendanceDays } = await import("./jobs"); // jobs reads the clock service, which calls this
      await rebuildAttendanceDays(new Date(), DAYS_BACK, employeeId);
    } catch (error) {
      console.error("day refresh failed:", error instanceof Error ? error.name : "unknown error");
    }
  };
  try {
    after(run);
  } catch {
    await run(); // outside a request (a job run directly, a test)
  }
}
