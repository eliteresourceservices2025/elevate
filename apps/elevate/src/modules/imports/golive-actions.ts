"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { MANUAL_KEYS } from "./golive";
import { goLiveItems } from "./schema";

const schema = z.object({ key: z.string().refine((k) => MANUAL_KEYS.includes(k), "Unknown step"), done: z.boolean(), note: z.string().trim().max(300).optional() });

/** Ticks or unticks a manual go-live step. */
export async function setGoLiveStep(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "imports.manage");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    await db.transaction(async (tx) => {
      if (parsed.data.done) await tx.insert(goLiveItems).values({ key: parsed.data.key, doneBy: actor.id, note: parsed.data.note || null }).onConflictDoUpdate({ target: goLiveItems.key, set: { doneBy: actor.id, doneAt: new Date(), note: parsed.data.note || null } });
      else await tx.delete(goLiveItems).where(eq(goLiveItems.key, parsed.data.key));
      await writeAudit({ actor, action: parsed.data.done ? "golive.done" : "golive.undone", targetType: "golive_step", targetId: parsed.data.key }, tx);
    });
    revalidatePath("/settings/go-live");
    return { ok: true, data: undefined };
  });
}
