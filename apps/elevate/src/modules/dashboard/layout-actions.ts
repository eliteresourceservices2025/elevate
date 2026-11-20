"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/run-action";
import { layoutSchema, resetSchema } from "./layout-validators";
import { resetLayout, saveLayout } from "./layout-service";

/** Saves which tiles you hide and the order of the rest, for one dashboard view. Only your own layout; a preference, never a permission. */
export async function saveDashboardLayout(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = layoutSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
    await saveLayout(actor, parsed.data);
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  });
}

/** Puts one dashboard view back to its default layout. */
export async function resetDashboardLayout(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = resetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
    await resetLayout(actor, parsed.data.view);
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  });
}
