"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { applyBatch, rebuildAfterApply, type SkippedRow } from "./apply";
import { discardBatch, removeAlias, saveAlias } from "./service";

const uuid = z.string().uuid("That import was not found.");
const discardSchema = z.object({ batchId: uuid });

/** Throws away an uploaded sheet and its encrypted rows. */
export async function discardScheduleImport(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "scheduleimport.manage");
    const parsed = discardSchema.safeParse(input);
    if (!parsed.success) return fail("That import was not found.");
    await discardBatch(actor, parsed.data.batchId);
    revalidatePath("/settings/import-schedules");
    return { ok: true, data: undefined };
  });
}

const applySchema = z.object({
  batchId: uuid,
  digest: z.string().regex(/^[a-f0-9]{64}$/, "Reload the preview and try again."),
  accepted: z
    .array(
      z.object({
        key: z.string().min(1).max(500),
        breakMinutes: z.number().int().min(0).max(240).optional(),
        hoursPerWeek: z.number().min(0.1).max(80).refine((v) => Number.isInteger(Math.round(v * 10)), "Use one decimal at most.").optional(),
      }),
    )
    .max(300),
  endAssignmentIds: z.array(uuid).max(300).default([]),
  endDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."), z.null()]).default(null),
  acknowledgeBackdated: z.boolean().default(false),
});

export type ApplyOutcome = {
  assignmentsAdded: number;
  assignmentsEnded: number;
  hoursUpdated: number;
  schedulesAdded: number;
  endedByTick: number;
  skipped: SkippedRow[];
};

/**
 * Applies the rows HR chose from a preview. Everything is re-checked under a lock; rows that no longer fit are skipped with the reason.
 * Worked hours and clock events are never touched. Attendance days for the people changed are rebuilt afterwards from clock events.
 */
export async function applyScheduleImport(input: unknown): Promise<ActionResult<ApplyOutcome>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "scheduleimport.manage");
    const parsed = applySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the request and try again.");
    if (!(await allowRequest("upload", actor.id))) return fail("Too many requests. Wait a few minutes and try again.");

    const result = await applyBatch(actor, parsed.data);
    revalidatePath("/settings/import-schedules");
    revalidatePath("/schedules");
    revalidatePath("/people");

    // The rebuild runs after the response, so the page is not held while days are recomputed (safe to repeat; the nightly job also covers the last days).
    if (result.rebuild.employeeIds.length > 0) {
      after(async () => {
        await rebuildAfterApply(result.rebuild.employeeIds, result.rebuild.from);
      });
    }
    return {
      ok: true,
      data: {
        assignmentsAdded: result.assignmentsAdded,
        assignmentsEnded: result.assignmentsEnded,
        hoursUpdated: result.hoursUpdated,
        schedulesAdded: result.schedulesAdded,
        endedByTick: result.endedByTick,
        skipped: result.rowsSkipped,
      },
    };
  });
}

const aliasSchema = z.object({
  kind: z.enum(["person", "client"]),
  sheetValue: z.string().trim().min(1).max(200),
  targetId: uuid,
});

/** Chooses the real person or client for a sheet's spelling and remembers it for later sheets. */
export async function rememberScheduleImportMatch(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "scheduleimport.manage");
    const parsed = aliasSchema.safeParse(input);
    if (!parsed.success) return fail("Choose a person or client from the list.");
    await saveAlias(actor, parsed.data);
    revalidatePath("/settings/import-schedules");
    return { ok: true, data: undefined };
  });
}

/** Forgets a remembered match; the next sheet is matched by name again. */
export async function forgetScheduleImportMatch(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "scheduleimport.manage");
    const parsed = z.object({ aliasId: uuid }).safeParse(input);
    if (!parsed.success) return fail("That remembered match was not found.");
    await removeAlias(actor, parsed.data.aliasId);
    revalidatePath("/settings/import-schedules");
    return { ok: true, data: undefined };
  });
}
