"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { SafevoiceNotConfigured } from "./handler-db";
import { changeCaseStatus, closeAsHandler, replyAsHandler } from "./service";
import { closeSchema, replySchema, statusSchema } from "./validators";

// Handler actions. Only a person individually designated as a Safe Voice handler passes authorize("safevoice.handle"); no role does.
// Audit entries (written in service.ts) never contain report or message text.

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = (caseId: string) => {
  revalidatePath("/safe-voice-cases");
  revalidatePath(`/safe-voice-cases/${caseId}`);
};
const notConfigured = () => fail("Safe Voice is not connected yet. Ask the system administrator to set it up.");

export async function replyToSafevoiceCase(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "safevoice.handle");
    const parsed = replySchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    try {
      await replyAsHandler(actor, parsed.data);
    } catch (error) {
      if (error instanceof SafevoiceNotConfigured) return notConfigured();
      throw error;
    }
    refresh(parsed.data.caseId);
    return { ok: true, data: undefined };
  });
}

export async function setSafevoiceCaseStatus(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "safevoice.handle");
    const parsed = statusSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    try {
      await changeCaseStatus(actor, parsed.data);
    } catch (error) {
      if (error instanceof SafevoiceNotConfigured) return notConfigured();
      throw error;
    }
    refresh(parsed.data.caseId);
    return { ok: true, data: undefined };
  });
}

export async function closeSafevoiceCase(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "safevoice.handle");
    const parsed = closeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    try {
      await closeAsHandler(actor, { ...parsed.data, message: parsed.data.message || undefined });
    } catch (error) {
      if (error instanceof SafevoiceNotConfigured) return notConfigured();
      throw error;
    }
    refresh(parsed.data.caseId);
    return { ok: true, data: undefined };
  });
}
