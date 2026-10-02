import "server-only";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { clockEvents, extraHoursRequests, schedules } from "./schema";

type Tx = Pick<typeof db, "update" | "delete" | "select">;

/**
 * Wrapping up attendance for someone who is leaving: their schedule ends on their last working day (a schedule that would only start
 * after it is removed), and extra-hours requests still waiting for an answer are cancelled. Clock events and approved hours are never
 * touched: they are the record of the work.
 */
export async function wrapUpAttendance(tx: Tx, employeeId: string, lastWorkingDay: string): Promise<{ schedulesEnded: number; requestsCancelled: number }> {
  const ended = await tx
    .update(schedules)
    .set({ effectiveTo: lastWorkingDay })
    .where(and(eq(schedules.employeeId, employeeId), sql`${schedules.effectiveFrom} <= ${lastWorkingDay}::date`, or(isNull(schedules.effectiveTo), gt(schedules.effectiveTo, sql`${lastWorkingDay}::date`))))
    .returning({ id: schedules.id });
  await tx.delete(schedules).where(and(eq(schedules.employeeId, employeeId), sql`${schedules.effectiveFrom} > ${lastWorkingDay}::date`));
  const cancelled = await tx
    .update(extraHoursRequests)
    .set({ status: "cancelled" })
    .where(and(eq(extraHoursRequests.employeeId, employeeId), inArray(extraHoursRequests.status, ["pending_lead", "pending_confirm"])))
    .returning({ id: extraHoursRequests.id });
  return { schedulesEnded: ended.length, requestsCancelled: cancelled.length };
}

/** True when the person's latest clock event is not a clock-out (a session is open). */
export async function openSession(tx: Pick<typeof db, "select">, employeeId: string): Promise<boolean> {
  const [last] = await tx.select({ type: clockEvents.type }).from(clockEvents).where(eq(clockEvents.employeeId, employeeId)).orderBy(desc(clockEvents.occurredAt)).limit(1);
  return Boolean(last && last.type !== "clock_out");
}
