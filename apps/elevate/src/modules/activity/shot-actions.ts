"use server";

import { and, eq, isNull } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { employees } from "@/modules/people/schema";
import { authorizeForEmployee } from "./access";
import { activityShots } from "./schema";
import { viewShotSchema } from "./validators";

/**
 * A 60-second link to one blurred screenshot. The person sees their own freely; a lead (their team), HR and Super Admin must give a
 * reason, and every view is written to the audit log (ids and the reason code only) in the same transaction as the link is made.
 */
export async function viewShot(input: unknown): Promise<ActionResult<{ url: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = viewShotSchema.safeParse(input);
    if (!parsed.success) return fail("Choose a screenshot and a reason.");
    const [shot] = await db
      .select({ id: activityShots.id, employeeId: activityShots.employeeId, path: activityShots.storagePath })
      .from(activityShots)
      .where(and(eq(activityShots.id, parsed.data.shotId), isNull(activityShots.purgedAt)))
      .limit(1);
    if (!shot) return fail("That screenshot is no longer available.");
    // One's own screenshots are always open (anyone enrolled can see what is recorded about them); others' follow the role.
    const [owner] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, shot.employeeId)).limit(1);
    const own = owner?.userId === actor.id;
    if (own) await authorize(actor, "activity.view_own", { ownerUserId: actor.id });
    else await authorizeForEmployee(actor, "activity.view_shots", shot.employeeId);
    const url = await db.transaction(async (tx) => {
      await writeAudit(
        { actor, action: "activity.shot_view", targetType: "activity_shot", targetId: shot.id, metadata: { employeeId: shot.employeeId, reason: own ? "own" : parsed.data.reason } },
        tx,
      );
      return getDocumentStorage().createSignedDownload(BUCKETS.tracker, shot.path, 60, "screenshot.jpg");
    });
    return { ok: true, data: { url } };
  });
}
