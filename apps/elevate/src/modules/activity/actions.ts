"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { monitoringPolicyPublished, personForUser } from "@/modules/attendance/service";
import { employees } from "@/modules/people/schema";
import { ENROLLMENT_TTL_MS, hashSecret, newEnrollmentCode } from "./device-token";
import { trackerDevices, trackerEnrollmentCodes } from "./schema";
import { revokeDeviceSchema } from "./validators";

// Person-facing actions of the ELEVATE Tracker. The app itself talks to /api/tracker/* with a device token instead.

const refresh = () => revalidatePath("/tracker/download");

/** A one-time code (valid 15 minutes) to type into the ELEVATE Tracker App on one's own computer. */
export async function createEnrollmentCode(): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "tracker.enroll", { ownerUserId: actor.id });
    if (!(await allowRequest("trackerEnroll", actor.id))) return fail("Too many codes. Wait a few minutes and try again.");
    const person = await personForUser(db, actor.id);
    if (!(await monitoringPolicyPublished(db))) return fail("The tracker is not available yet. It turns on once the monitoring policy is published.");
    const code = newEnrollmentCode();
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
    await db.transaction(async (tx) => {
      // A newer code replaces the earlier unused ones.
      await tx.delete(trackerEnrollmentCodes).where(and(eq(trackerEnrollmentCodes.employeeId, person.id), isNull(trackerEnrollmentCodes.usedAt)));
      await tx.insert(trackerEnrollmentCodes).values({ employeeId: person.id, codeHash: hashSecret(code), expiresAt });
      await writeAudit({ actor, action: "tracker.code_created", targetType: "employee", targetId: person.id }, tx);
    });
    return { ok: true, data: { code, expiresAt: expiresAt.toISOString() } };
  });
}

/** Signs a computer out of the tracker. The person for their own device; HR and Super Admin for anyone's. */
export async function revokeDevice(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = revokeDeviceSchema.safeParse(input);
    if (!parsed.success) return fail("Choose a computer.");
    const [device] = await db
      .select({ id: trackerDevices.id, status: trackerDevices.status, employeeId: trackerDevices.employeeId, ownerUserId: employees.userId })
      .from(trackerDevices)
      .innerJoin(employees, eq(employees.id, trackerDevices.employeeId))
      .where(eq(trackerDevices.id, parsed.data.deviceId))
      .limit(1);
    if (!device) return fail("That computer was not found.");
    await authorize(actor, "tracker.revoke_device", { ownerUserId: device.ownerUserId ?? undefined });
    if (device.status === "revoked") return fail("That computer is already signed out.");
    await db.transaction(async (tx) => {
      await tx.update(trackerDevices).set({ status: "revoked", revokedAt: new Date(), revokedBy: actor.id }).where(eq(trackerDevices.id, device.id));
      await writeAudit({ actor, action: "tracker.device_revoked", targetType: "tracker_device", targetId: device.id, metadata: { employeeId: device.employeeId } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
