import "server-only";
import { eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import type { ClockType } from "@/modules/attendance/clock";
import { breakMode, getJibbleClient, mirrorSendsEnabled, sendsAllowed } from "./client";
import { mirrorSteps } from "./mirror-rules";
import { jibbleLinkLog, jibblePeople } from "./schema";

type Executor = Pick<typeof db, "insert" | "select">;

/**
 * Called inside the clock transaction (so a call to Jibble can never be lost or sent for a click that rolled back).
 * Queues one row per Jibble call. Does nothing unless the link is configured, ELEVATE is sending (not fallback mode) and
 * the caller says it is allowed: monitoring policy published AND the person's team has Jibble turned on.
 * Returns how many calls are waiting to be sent.
 */
export async function enqueueMirror(tx: Executor, input: { employeeId: string; events: { id: string; type: ClockType }[]; allowed: boolean }): Promise<number> {
  if (!input.allowed || !mirrorSendsEnabled() || !getJibbleClient()) return 0;
  const steps = mirrorSteps(input.events, breakMode());
  if (steps.length === 0) return 0;
  const [match] = await tx.select({ id: jibblePeople.jibblePersonId }).from(jibblePeople).where(eq(jibblePeople.employeeId, input.employeeId)).limit(1);
  const allowed = Boolean(match) && sendsAllowed(match?.id ?? null);
  const reason = !match ? "no Jibble person matched" : allowed ? null : "not sent: not the production environment";
  await tx
    .insert(jibbleLinkLog)
    .values(steps.map((s) => ({ employeeId: input.employeeId, eventId: s.eventId, action: s.action, status: allowed ? "queued" : "skipped", lastError: reason })))
    .onConflictDoNothing();
  return allowed ? steps.length : 0;
}

/**
 * After the transaction commits: send the queued Jibble calls now, so screenshots stop the moment someone clocks out (they kept running
 * for minutes when this waited for a job). The send runs after the response (Next's `after`), so a slow or failing Jibble never slows
 * the ELEVATE clock; anything that fails stays queued and is retried by the sweep. Where there is no request to run after (a script, a
 * test) it asks the job runner instead, and without that the 15-minute sweep sends it. Best effort.
 */
export async function kickMirror(employeeId?: string): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        const { processMirrorQueue } = await import("./jobs");
        // Only this person's calls: another click at the same moment sends its own, so two runs never pick up the same rows.
        await processMirrorQueue(new Date(), undefined, employeeId ? { employeeId } : undefined);
      } catch (error) {
        console.error("jibble immediate send failed:", error instanceof Error ? error.name : "unknown error");
      }
    });
    return;
  } catch {
    // No request scope: fall through to the job runner.
  }
  if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) {
    // Without the event key the call waits for the 15-minute sweep. Say so in the log (once per click), never anything about the person.
    console.error("jibble mirror kick skipped: INNGEST_EVENT_KEY is not set");
    return;
  }
  try {
    const { inngest } = await import("@/inngest/client");
    await Promise.race([inngest.send({ name: "jibble/mirror.requested", data: {} }), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch (error) {
    // The 15-minute sweep picks it up.
    console.error("jibble mirror kick failed:", error instanceof Error ? error.name : "unknown error");
  }
}
