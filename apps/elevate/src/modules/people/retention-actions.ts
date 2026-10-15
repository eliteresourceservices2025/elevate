"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { employees, peopleRetentionSettings } from "./schema";
import { getPeopleRetentionSettings } from "./retention";
import { legalHoldSchema, peopleRetentionSchema } from "./validators";

export async function savePeopleRetention(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "people.manage_retention");
    const parsed = peopleRetentionSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the values.");
    const v = parsed.data;
    await db.transaction(async (tx) => {
      const before = await getPeopleRetentionSettings(tx);
      await tx
        .insert(peopleRetentionSettings)
        .values({ id: 1, enabled: v.enabled, archiveAfterMonths: v.archiveAfterMonths, anonymizeAfterMonths: v.anonymizeAfterMonths, updatedBy: actor.id })
        .onConflictDoUpdate({
          target: peopleRetentionSettings.id,
          set: { enabled: v.enabled, archiveAfterMonths: v.archiveAfterMonths, anonymizeAfterMonths: v.anonymizeAfterMonths, updatedBy: actor.id, updatedAt: new Date() },
        });
      await writeAudit(
        {
          actor,
          action: "retention.settings_change",
          targetType: "people_retention_settings",
          targetId: "1",
          before: { enabled: before.enabled, archive: before.archiveAfterMonths, anonymize: before.anonymizeAfterMonths },
          after: { enabled: v.enabled, archive: v.archiveAfterMonths, anonymize: v.anonymizeAfterMonths },
        },
        tx,
      );
    });
    revalidatePath("/settings/people-retention");
    return { ok: true, data: undefined };
  });
}

/** Puts a legal hold on a person's record (or lifts it): the retention job skips held records. A reason is required to set one. */
export async function setLegalHold(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "people.manage_retention");
    const parsed = legalHoldSchema.safeParse(input);
    if (!parsed.success) return fail("Check the values.");
    const v = parsed.data;
    if (v.hold && !v.reason) return fail("Give a reason for the hold.");
    await db.transaction(async (tx) => {
      const [row] = await tx.select({ id: employees.id, anonymizedAt: employees.anonymizedAt }).from(employees).where(eq(employees.id, v.employeeId)).limit(1);
      if (!row) throw new ActionFailure("That person was not found.");
      if (row.anonymizedAt) throw new ActionFailure("This record was already anonymized.");
      await tx
        .update(employees)
        .set({ legalHoldAt: v.hold ? new Date() : null, legalHoldReason: v.hold ? (v.reason ?? null) : null, updatedAt: new Date() })
        .where(eq(employees.id, v.employeeId));
      await writeAudit({ actor, action: v.hold ? "retention.hold_set" : "retention.hold_lifted", targetType: "employee", targetId: v.employeeId }, tx);
    });
    revalidatePath(`/people/${v.employeeId}`);
    return { ok: true, data: undefined };
  });
}
