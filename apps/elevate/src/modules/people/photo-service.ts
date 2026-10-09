import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { cleanProfilePhoto, isPhotoPathOf, photoPathFor } from "./photo";

// Profile photos. Not a "use server" file: the functions take the acting user, so the callers (a route and an action) sign them in first.

export type PhotoResult = { ok: true } | { ok: false; error: string };

/** Stores the signed-in person's own photo (cleaned, replacing any earlier one). */
export async function saveOwnPhoto(actor: AuthUser, raw: Uint8Array): Promise<PhotoResult> {
  await authorize(actor, "people.manage_photo", { ownerUserId: actor.id });
  const cleaned = cleanProfilePhoto(raw);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };

  const [current] = await db.select({ photoPath: users.photoPath }).from(users).where(eq(users.id, actor.id)).limit(1);
  if (!current) return { ok: false, error: "Your account was not found." };

  const path = photoPathFor(actor.id, randomUUID());
  const storage = getDocumentStorage();
  await storage.write(BUCKETS.employee, path, cleaned.bytes, "image/jpeg");

  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ photoPath: path, photoUpdatedAt: new Date() }).where(eq(users.id, actor.id));
      await writeAudit({ actor, action: "profile.photo_set", targetType: "user", targetId: actor.id }, tx);
    });
  } catch (error) {
    await storage.remove(BUCKETS.employee, [path]).catch(() => {});
    throw error;
  }
  if (current.photoPath && isPhotoPathOf(actor.id, current.photoPath)) await storage.remove(BUCKETS.employee, [current.photoPath]).catch(() => {});
  return { ok: true };
}

/** Removes a photo: the person's own, or anyone's for HR (a picture that should not be there). */
export async function removePhotoOf(actor: AuthUser, targetUserId: string): Promise<PhotoResult> {
  await authorize(actor, "people.manage_photo", { ownerUserId: targetUserId });
  const [row] = await db.select({ photoPath: users.photoPath }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!row) return { ok: false, error: "That person was not found." };
  if (!row.photoPath) return { ok: true };

  await db.transaction(async (tx) => {
    await tx.update(users).set({ photoPath: null, photoUpdatedAt: new Date() }).where(eq(users.id, targetUserId));
    await writeAudit({ actor, action: "profile.photo_remove", targetType: "user", targetId: targetUserId }, tx);
  });
  if (isPhotoPathOf(targetUserId, row.photoPath)) await getDocumentStorage().remove(BUCKETS.employee, [row.photoPath]).catch(() => {});
  return { ok: true };
}

/** The picture itself, for the route that serves it. Anyone signed in can see a colleague's photo (the same people the directory shows). */
export async function readPhotoOf(viewer: AuthUser, userId: string): Promise<Uint8Array | null> {
  await authorize(viewer, "people.view_directory");
  const [row] = await db.select({ photoPath: users.photoPath, archivedAt: users.archivedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row?.photoPath || row.archivedAt || !isPhotoPathOf(userId, row.photoPath)) return null;
  return getDocumentStorage().read(BUCKETS.employee, row.photoPath);
}
