"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { clockSourceOf } from "@/modules/attendance/clock-source";
import { monitoringPolicyPublished, personForUser } from "@/modules/attendance/service";
import { employees } from "@/modules/people/schema";
import { ENROLLMENT_TTL_MS, hashSecret, newEnrollmentCode } from "./device-token";
import { activityCategories, activitySettings, trackerDevices, trackerEnrollmentCodes } from "./schema";
import { activitySettingsSchema, archiveCategorySchema, categorySchema, revokeDeviceSchema } from "./validators";

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
    if ((await clockSourceOf(db, person.id)) === "jibble") return fail("Your hours come from Jibble for now, so the tracker is not available to you yet. Ask HR.");
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

/** Adds an app -> work / non-work rule. The highest rank wins when several match; totals pick it up the next time they are rebuilt. */
export async function saveCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "activity.manage");
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return fail("Enter a valid app pattern, a category and a rank from 1 to 100.");
    const id = await db.transaction(async (tx) => {
      const [row] = await tx.insert(activityCategories).values({ pattern: parsed.data.pattern, category: parsed.data.category, rank: parsed.data.rank, createdBy: actor.id }).returning({ id: activityCategories.id });
      await writeAudit({ actor, action: "activity.category_saved", targetType: "activity_category", targetId: row.id, metadata: { category: parsed.data.category, rank: parsed.data.rank } }, tx);
      return row.id;
    });
    return { ok: true, data: { id } };
  });
}

/** Changes the company-wide thresholds the app and the nightly flags use. Past days are not rewritten; the numbers apply from now on. */
export async function saveActivitySettings(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "activity.manage");
    const parsed = activitySettingsSchema.safeParse(input);
    if (!parsed.success) return fail("Idle time must be 60 to 900 seconds, the offline wait 2 to 60 minutes and low activity 5 to 90 percent.");
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(activitySettings).where(eq(activitySettings.scope, "default")).limit(1);
      const values = { ...parsed.data, updatedAt: new Date() };
      await tx.insert(activitySettings).values({ scope: "default", ...values }).onConflictDoUpdate({ target: activitySettings.scope, set: values });
      await writeAudit(
        {
          actor,
          action: "activity.settings_saved",
          targetType: "activity_settings",
          targetId: "default",
          before: before ? { idleTimeoutSeconds: before.idleTimeoutSeconds, offlineGraceMinutes: before.offlineGraceMinutes, lowActivityPercent: before.lowActivityPercent } : null,
          after: parsed.data,
        },
        tx,
      );
    });
    revalidatePath("/settings/tracker");
    return { ok: true, data: undefined };
  });
}

/** Retires a work/non-work rule. It stops counting the next time totals are rebuilt. */
export async function archiveCategory(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "activity.manage");
    const parsed = archiveCategorySchema.safeParse(input);
    if (!parsed.success) return fail("Choose a rule.");
    const done = await db.transaction(async (tx) => {
      const rows = await tx.update(activityCategories).set({ archivedAt: new Date() }).where(and(eq(activityCategories.id, parsed.data.id), isNull(activityCategories.archivedAt))).returning({ id: activityCategories.id });
      if (rows.length === 0) return false;
      await writeAudit({ actor, action: "activity.category_archived", targetType: "activity_category", targetId: parsed.data.id }, tx);
      return true;
    });
    if (!done) return fail("That rule was not found.");
    revalidatePath("/settings/tracker");
    return { ok: true, data: undefined };
  });
}
