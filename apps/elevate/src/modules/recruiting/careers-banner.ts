import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { cleanJpeg } from "@/modules/people/photo";
import { careersPage } from "./schema";

// The careers page banner: one wide picture. The browser crops it to a fixed shape and size; the server checks it again, removes every
// metadata segment and keeps only the cleaned copy. Stored privately and served by /api/careers/banner (public, cached).

export const BANNER_WIDTH = 1600;
export const BANNER_HEIGHT = 400;
export const BANNER_ASPECT = BANNER_WIDTH / BANNER_HEIGHT;
export const MAX_BANNER_BYTES = 900 * 1024;
const LIMITS = { maxBytes: MAX_BANNER_BYTES, minSide: 200, maxSide: 2400 };
const PREFIX = "careers/banner/";

export type BannerResult = { ok: true } | { ok: false; error: string };

/** Replaces the banner with a cleaned copy of what the browser sent. The caller has signed the person in. */
export async function saveBanner(actor: AuthUser, raw: Uint8Array): Promise<BannerResult> {
  await authorize(actor, "recruiting.manage_careers_page");
  const cleaned = cleanJpeg(raw, LIMITS);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };
  // A banner is wide: refuse a tall or square picture rather than showing it badly.
  if (cleaned.width / cleaned.height < 2) return { ok: false, error: "Use a wide picture (at least twice as wide as it is tall)." };

  const [current] = await db.select({ path: careersPage.bannerPath }).from(careersPage).where(eq(careersPage.id, 1)).limit(1);
  const storage = getDocumentStorage();
  const path = `${PREFIX}${randomUUID()}.jpg`;
  await storage.write(BUCKETS.company, path, cleaned.bytes, "image/jpeg");
  try {
    await db.transaction(async (tx) => {
      const values = { bannerPath: path, bannerUpdatedAt: new Date(), updatedBy: actor.id, updatedAt: new Date() };
      await tx.insert(careersPage).values({ id: 1, ...values }).onConflictDoUpdate({ target: careersPage.id, set: values });
      await writeAudit({ actor, action: "recruiting.careers_banner_set", targetType: "careers_page", targetId: undefined }, tx);
    });
  } catch (error) {
    await storage.remove(BUCKETS.company, [path]).catch(() => {});
    throw error;
  }
  if (current?.path && current.path.startsWith(PREFIX)) await storage.remove(BUCKETS.company, [current.path]).catch(() => {});
  return { ok: true };
}

export async function clearBanner(actor: AuthUser): Promise<void> {
  await authorize(actor, "recruiting.manage_careers_page");
  const [current] = await db.select({ path: careersPage.bannerPath }).from(careersPage).where(eq(careersPage.id, 1)).limit(1);
  if (!current?.path) return;
  await db.transaction(async (tx) => {
    await tx.update(careersPage).set({ bannerPath: null, bannerUpdatedAt: new Date(), updatedBy: actor.id, updatedAt: new Date() }).where(eq(careersPage.id, 1));
    await writeAudit({ actor, action: "recruiting.careers_banner_remove", targetType: "careers_page", targetId: undefined }, tx);
  });
  if (current.path.startsWith(PREFIX)) await getDocumentStorage().remove(BUCKETS.company, [current.path]).catch(() => {});
}

/** The banner picture for the public route, or null when there is none. Only paths this module wrote are read. */
export async function readBanner(): Promise<Uint8Array | null> {
  const [row] = await db.select({ path: careersPage.bannerPath }).from(careersPage).where(eq(careersPage.id, 1)).limit(1);
  if (!row?.path || !row.path.startsWith(PREFIX)) return null;
  return getDocumentStorage().read(BUCKETS.company, row.path);
}
