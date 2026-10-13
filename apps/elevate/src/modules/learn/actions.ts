"use server";

import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { currentSignInMethods } from "@/modules/signing/session";
import { createLaunchToken } from "./service";
import { handoffUrl, learnBaseUrl } from "./token";

/**
 * Starts the sign-in handoff to ELEVATE Learn: makes a one-time token (60 seconds, stored only as a hash) and returns it with the
 * address to post it to. The browser posts it straight to Learn, so it never appears in a link, history or referrer. Learn then
 * starts its own session; it never sees a password or an ELEVATE cookie.
 */
export async function startLearnLaunch(): Promise<ActionResult<{ token: string; action: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.launch", { ownerUserId: actor.id });
    const base = learnBaseUrl();
    if (!base) return fail("Training is not set up yet. Please ask HR.");
    if (!(await allowRequest("learnLaunch", actor.id))) return fail("You opened training several times in a row. Please wait a few minutes and try again.");

    // How the person signed in (for example password and totp): kept on the Learn session and written on the attestation.
    const methods = ((await currentSignInMethods()) ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    const token = await db.transaction(async (tx) => {
      const issued = await createLaunchToken(tx, actor.id, methods);
      // No token, hash or address is written to the audit log: only that a launch happened.
      await writeAudit({ actor, action: "learn.launch", targetType: "user", targetId: actor.id }, tx);
      return issued;
    });
    return { ok: true, data: { token, action: handoffUrl(base) } };
  });
}
