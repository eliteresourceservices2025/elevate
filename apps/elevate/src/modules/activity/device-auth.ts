import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringPolicyPublished } from "@/modules/attendance/service";
import { hashSecret, newDeviceToken, normalizeCode, parseBearer } from "./device-token";
import { trackerDevices, trackerEnrollmentCodes } from "./schema";

// Server-only helpers: they take no signed-in person, so they never live in a "use server" file.

export type RedeemInput = { code: string; name: string; os: "windows" | "macos"; appVersion: string; now?: Date };
export type RedeemResult =
  | { ok: true; token: string; deviceId: string; employeeId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "policy" };

/** Trades a one-time code for a device token. Everything happens in one transaction, so a code works once. */
export async function redeemEnrollmentCode(input: RedeemInput): Promise<RedeemResult> {
  const now = input.now ?? new Date();
  const codeHash = hashSecret(normalizeCode(input.code));
  return db.transaction(async (tx): Promise<RedeemResult> => {
    const [row] = await tx.select().from(trackerEnrollmentCodes).where(eq(trackerEnrollmentCodes.codeHash, codeHash)).for("update").limit(1);
    if (!row) return { ok: false, reason: "invalid" };
    if (row.usedAt) return { ok: false, reason: "used" };
    if (row.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };
    if (!(await monitoringPolicyPublished(tx))) return { ok: false, reason: "policy" };
    const { token, hash } = newDeviceToken();
    const [device] = await tx
      .insert(trackerDevices)
      .values({ employeeId: row.employeeId, name: input.name, os: input.os, appVersion: input.appVersion, tokenHash: hash, lastSeenAt: now })
      .returning({ id: trackerDevices.id });
    await tx.update(trackerEnrollmentCodes).set({ usedAt: now }).where(eq(trackerEnrollmentCodes.id, row.id));
    return { ok: true, token, deviceId: device.id, employeeId: row.employeeId };
  });
}

/** The device behind an `Authorization: Bearer` header, or null. Revoked devices never authenticate. */
export async function authenticateDevice(authorization: string | null): Promise<{ deviceId: string; employeeId: string } | null> {
  const token = parseBearer(authorization);
  if (!token) return null;
  const [device] = await db
    .select({ id: trackerDevices.id, employeeId: trackerDevices.employeeId })
    .from(trackerDevices)
    .where(and(eq(trackerDevices.tokenHash, hashSecret(token)), eq(trackerDevices.status, "active"), isNull(trackerDevices.revokedAt)))
    .limit(1);
  if (!device) return null;
  // Remember when it was last seen, at most once a minute.
  await db
    .update(trackerDevices)
    .set({ lastSeenAt: sql`now()` })
    .where(and(eq(trackerDevices.id, device.id), sql`(${trackerDevices.lastSeenAt} is null or ${trackerDevices.lastSeenAt} < now() - interval '1 minute')`));
  return { deviceId: device.id, employeeId: device.employeeId };
}
