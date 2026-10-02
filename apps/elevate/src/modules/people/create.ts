import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { positions } from "@/modules/org/schema";
import { applyReporting, todayInZone } from "@/modules/org/service";
import { employees } from "./schema";
import { findLinkableUser, recordHistory, type Tx } from "./service";
import type { CreateEmployeeInput } from "./validators";

/**
 * Creates one person record inside the caller's transaction: looks up the position, links an existing sign-in account with the same
 * email (never guesses), applies team and manager through the dated reporting rules, writes the history entry and the audit row.
 * Callers have already authorized and validated. Used by "Add person" and by hiring (offers).
 */
export async function createEmployeeRecord(
  tx: Tx,
  actor: { id: string; email: string },
  input: CreateEmployeeInput,
  historySummary?: string,
): Promise<{ id: string; employeeNumber: string; linkedAccount: boolean }> {
  const { teamId, managerId, positionId, ...v } = input;
  let positionTitle: string | null = null;
  if (positionId) {
    const [pos] = await tx.select({ title: positions.title }).from(positions).where(and(eq(positions.id, positionId), isNull(positions.archivedAt))).limit(1);
    if (!pos) throw new ActionFailure("That position was not found.");
    positionTitle = pos.title;
  }

  const userId = await findLinkableUser(tx, [v.workEmail, v.personalEmail]);
  const [created] = await tx
    .insert(employees)
    .values({ ...v, positionId: positionId ?? null, position: positionTitle, userId, createdBy: actor.id })
    .returning({ id: employees.id, employeeNumber: employees.employeeNumber });

  // Team and manager go through the dated rules. A start date in the future counts from today.
  if (teamId || managerId) {
    const today = todayInZone();
    const effectiveDate = v.startDate && v.startDate < today ? v.startDate : today;
    const result = await applyReporting(tx, { employeeId: created.id, teamId, managerId, effectiveDate }, actor.id);
    if (!result.ok) throw new ActionFailure(result.error);
  }

  await recordHistory(tx, {
    employeeId: created.id,
    eventType: "hired",
    summary: historySummary ?? (positionTitle ? `Added to ELEVATE as ${positionTitle}` : "Added to ELEVATE"),
    changedBy: actor.id,
    ...(v.startDate ? { effectiveDate: v.startDate } : {}),
  });
  await writeAudit({ actor, action: "people.create", targetType: "employee", targetId: created.id, after: { employeeNumber: created.employeeNumber, status: v.status, workerType: v.workerType, linkedAccount: userId !== null } }, tx);
  return { id: created.id, employeeNumber: created.employeeNumber, linkedAccount: userId !== null };
}
