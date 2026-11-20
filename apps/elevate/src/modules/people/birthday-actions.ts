"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/run-action";
import { setOwnBirthdayHidden } from "./birthday-service";

const schema = z.object({ hidden: z.boolean() });

/** Shows or hides your own birthday (month and day, never the year) on colleagues' dashboards. */
export async function setMyBirthdayHidden(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
    const result = await setOwnBirthdayHidden(actor, parsed.data.hidden);
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  });
}
