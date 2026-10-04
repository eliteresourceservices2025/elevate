"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { db } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { writeAudit } from "@/modules/audit/write";
import { importBatches } from "./schema";
import { commitBatch, discardBatch, rollbackBatch, type CommitResult, type RollbackResult } from "./service";
import { batchIdSchema, commitSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = (id?: string) => {
  revalidatePath("/settings/import");
  if (id) revalidatePath(`/settings/import/${id}`);
};

/** Creates the people from a checked preview. Rows with errors are skipped only if HR chose that. */
export async function commitImport(input: unknown): Promise<ActionResult<CommitResult>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "imports.manage");
    const parsed = commitSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const result = await commitBatch(actor, parsed.data.batchId, { skipErrors: parsed.data.skipErrors });
    refresh(parsed.data.batchId);
    revalidatePath("/people");
    return { ok: true, data: result };
  });
}

export async function rollbackImport(input: unknown): Promise<ActionResult<RollbackResult>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "imports.manage");
    const parsed = batchIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const result = await rollbackBatch(actor, parsed.data.batchId);
    refresh(parsed.data.batchId);
    revalidatePath("/people");
    return { ok: true, data: result };
  });
}

export async function discardImport(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "imports.manage");
    const parsed = batchIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    if (!(await discardBatch(actor, parsed.data.batchId))) return fail("Only an import that is still a preview can be discarded.");
    refresh(parsed.data.batchId);
    return { ok: true, data: undefined };
  });
}

/** HR records that the reconciliation was checked. Another HR admin may sign off a batch someone else committed, or the same person may. */
export async function signOffImport(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "imports.manage");
    const parsed = batchIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const ok = await db.transaction(async (tx) => {
      const [b] = await tx.update(importBatches).set({ signedOffBy: actor.id, signedOffAt: new Date() }).where(and(eq(importBatches.id, parsed.data.batchId), eq(importBatches.status, "committed"))).returning({ id: importBatches.id });
      if (!b) return false;
      await writeAudit({ actor, action: "import.signoff", targetType: "import_batch", targetId: b.id }, tx);
      return true;
    });
    if (!ok) return fail("Only a committed import can be signed off.");
    refresh(parsed.data.batchId);
    return { ok: true, data: undefined };
  });
}
