import "server-only";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/modules/core/schema";

/** When the signed-in person's photo last changed (milliseconds), or null when they have none. It is part of the picture's address, so a new one shows at once. */
export async function getMyPhotoVersion(): Promise<number | null> {
  const user = await requireUser();
  const [row] = await db.select({ path: users.photoPath, at: users.photoUpdatedAt }).from(users).where(eq(users.id, user.id)).limit(1);
  return row?.path && row.at ? row.at.getTime() : null;
}

/** The same for another person's account (for a profile page the viewer may already open). */
export async function getPhotoVersionOf(userId: string | null): Promise<number | null> {
  await requireUser();
  if (!userId) return null;
  const [row] = await db.select({ path: users.photoPath, at: users.photoUpdatedAt }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.path && row.at ? row.at.getTime() : null;
}
