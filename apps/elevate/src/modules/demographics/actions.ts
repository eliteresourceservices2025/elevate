"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import { clearEmployeeSelfId, saveEmployeeSelfId } from "./service";
import { selfIdentificationSchema } from "./validators";

// Only the person themself writes their own answers. Audit rows carry the NAMES of the fields answered, never a value.

async function myEmployee(userId: string) {
  const [me] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.userId, userId), isNull(employees.archivedAt))).limit(1);
  return me ?? null;
}

function refresh(employeeId: string) {
  revalidatePath("/people/me");
  revalidatePath(`/people/${employeeId}`);
}

export async function saveMySelfIdentification(input: unknown): Promise<ActionResult<{ answered: number }>> {
  const user = await requireUser();

  return runAction(async () => {
    await authorize(user, "demographics.edit_own", { ownerUserId: user.id });
    const parsed = selfIdentificationSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your answers and try again.");
    const me = await myEmployee(user.id);
    if (!me) return fail("Your people record was not found.");
    const fields = await db.transaction(async (tx) => {
      const answered = await saveEmployeeSelfId(tx, me.id, parsed.data);
      await writeAudit({ actor: user, action: "demographics.update", targetType: "employee", targetId: me.id, metadata: { fields: answered } }, tx);
      return answered;
    });
    refresh(me.id);
    return { ok: true, data: { answered: fields.length } };
  });
}

export async function clearMySelfIdentification(): Promise<ActionResult> {
  const user = await requireUser();

  return runAction(async () => {
    await authorize(user, "demographics.edit_own", { ownerUserId: user.id });
    const me = await myEmployee(user.id);
    if (!me) return fail("Your people record was not found.");
    await db.transaction(async (tx) => {
      await clearEmployeeSelfId(tx, me.id);
      await writeAudit({ actor: user, action: "demographics.clear", targetType: "employee", targetId: me.id }, tx);
    });
    refresh(me.id);
    return { ok: true, data: undefined };
  });
}
