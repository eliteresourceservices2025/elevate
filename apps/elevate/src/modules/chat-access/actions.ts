"use server";

import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { todayInZone } from "@/modules/org/service";
import { decideAccessSchema, requestAccessSchema, requestIdSchema } from "./validators";
import * as service from "./service";

// The three things people do with an access request: ask (HR Admin), decide (a DIFFERENT Super Admin), withdraw (whoever asked).
// The service checks the two-person rule again, and so does the database. Nothing here returns message text.

const BAD = "Check the request and try again.";

export async function requestChatAccess(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "chataccess.request");
    const parsed = requestAccessSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? BAD);
    return { ok: true, data: await service.requestAccess(actor, parsed.data, todayInZone()) };
  });
}

export async function decideChatAccess(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "chataccess.decide");
    const parsed = decideAccessSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await service.decideAccess(actor, parsed.data);
    return { ok: true, data: undefined };
  });
}

export async function cancelChatAccess(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "chataccess.request");
    const parsed = requestIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await service.cancelAccess(actor, parsed.data);
    return { ok: true, data: undefined };
  });
}
