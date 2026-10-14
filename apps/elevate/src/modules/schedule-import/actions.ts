"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { discardBatch } from "./service";

const discardSchema = z.object({ batchId: z.string().uuid() });

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
