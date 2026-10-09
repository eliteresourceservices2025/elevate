"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/run-action";
import { removePhotoOf } from "./photo-service";

const removeSchema = z.object({ userId: z.string().uuid().optional() });

/** Removes a profile photo: your own (no input), or anyone's for HR. */
export async function removeProfilePhoto(input: unknown = {}): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = removeSchema.safeParse(input ?? {});
    if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };
    const result = await removePhotoOf(actor, parsed.data.userId ?? actor.id);
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  });
}
