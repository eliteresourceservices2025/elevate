import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { activeDirectReports } from "@/modules/org/service";
import { clientAssignments, employees } from "./schema";
import { recordHistory, type Tx } from "./service";

/**
 * Moves a person to another status inside the caller's transaction (history and audit included). Becoming "separated" needs the last
 * working day and is refused while the person still has active reports (HR reassigns them first). Callers have authorized.
 */
export async function changeEmployeeStatus(
  tx: Tx,
  actor: { id: string; email: string } | null,
  employeeId: string,
  to: "onboarding" | "active" | "on_leave" | "separated",
  opts: { endDate?: string; summary?: string } = {},
): Promise<{ changed: boolean }> {
  const [row] = await tx.select({ status: employees.status }).from(employees).where(eq(employees.id, employeeId)).for("update");
  if (!row) throw new ActionFailure("That person was not found.");
  if (row.status === to) return { changed: false };
  if (to === "separated") {
    if (!opts.endDate) throw new ActionFailure("A separated person needs a last working day.");
    const reports = await activeDirectReports(tx, employeeId);
    if (reports.length > 0) throw new ActionFailure("This person still has active reports. Reassign them first.");
  }
  await tx.update(employees).set({ status: to, ...(to === "separated" ? { endDate: opts.endDate } : {}), updatedAt: new Date() }).where(eq(employees.id, employeeId));
  await recordHistory(tx, { employeeId, eventType: "status_changed", summary: opts.summary ?? `Status changed from ${row.status} to ${to}`, before: { status: row.status }, after: { status: to, ...(opts.endDate ? { endDate: opts.endDate } : {}) }, changedBy: actor?.id ?? null, ...(opts.endDate ? { effectiveDate: opts.endDate } : {}) });
  await writeAudit({ actor, action: "people.status", targetType: "employee", targetId: employeeId, before: { status: row.status }, after: { status: to } }, tx);
  return { changed: true };
}

/** Ends every open client assignment on a date (never before it started). */
export async function endClientAssignments(tx: Tx, employeeId: string, endDate: string): Promise<number> {
  const ended = await tx
    .update(clientAssignments)
    .set({ endDate: sql`greatest(${clientAssignments.startDate}, ${endDate}::date)` })
    .where(and(eq(clientAssignments.employeeId, employeeId), isNull(clientAssignments.endDate)))
    .returning({ id: clientAssignments.id });
  return ended.length;
}
