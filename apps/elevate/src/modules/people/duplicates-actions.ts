"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { mergeEmployees, relinkAccount } from "./duplicates-service";
import { mergeSchema, relinkSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = () => {
  for (const p of ["/people", "/people/duplicates", "/org-chart"]) revalidatePath(p);
};

/** HR: two records are the same person. The duplicate is archived; the sign-in account (and, if asked, the work email) goes to the record that stays. */
export async function mergeDuplicate(input: unknown): Promise<ActionResult<{ accountMoved: boolean; rolesCopied: number; reportsMoved: number; emailAdopted: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "people.merge");
    const parsed = mergeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const data = await db.transaction((tx) => mergeEmployees(tx, actor, parsed.data));
    refresh();
    revalidatePath(`/people/${parsed.data.keepId}`);
    return { ok: true, data };
  });
}

/** HR: a sign-in account with no people record belongs to this person's record. */
export async function relinkSignInAccount(input: unknown): Promise<ActionResult<{ replaced: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "people.merge");
    const parsed = relinkSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const data = await db.transaction((tx) => relinkAccount(tx, actor, parsed.data));
    refresh();
    revalidatePath(`/people/${parsed.data.employeeId}`);
    return { ok: true, data };
  });
}
