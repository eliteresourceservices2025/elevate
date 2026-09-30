import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailPreferences, notifications } from "./schema";

export type NotificationItem = { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: Date; read: boolean };

/** The signed-in person's own unread count, for the bell. */
export async function countMyUnread(): Promise<number> {
  const user = await requireUser();
  await authorize(user, "notifications.read", { ownerUserId: user.id });
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return n;
}

export async function listMyNotifications(limit = 20): Promise<NotificationItem[]> {
  const user = await requireUser();
  await authorize(user, "notifications.read", { ownerUserId: user.id });
  const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(Math.min(limit, 50));
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt, read: r.readAt !== null }));
}

/** Whether the signed-in person has opted out of the daily digest email. */
export async function getMyDigestOptOut(): Promise<boolean> {
  const user = await requireUser();
  await authorize(user, "notifications.read", { ownerUserId: user.id });
  const [p] = await db.select({ o: emailPreferences.digestOptOut }).from(emailPreferences).where(eq(emailPreferences.userId, user.id)).limit(1);
  return p?.o ?? false;
}
