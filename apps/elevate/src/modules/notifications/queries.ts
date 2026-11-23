import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { authorize, type AuthzUser } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hiddenKindRules } from "./kind-access";
import { emailPreferences, notifications } from "./schema";

export type NotificationItem = { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: Date; read: boolean };

function visibleToMe(user: AuthzUser) {
  // An exact kind is compared with <>, a family with a LIKE on its prefix (the "." and letters carry no wildcard; "_" does not occur in the prefixes).
  const hidden = hiddenKindRules(user).map((r) => (r.kind !== undefined ? sql`${notifications.kind} <> ${r.kind}` : sql`${notifications.kind} not like ${`${r.prefix}%`}`));
  return and(eq(notifications.userId, user.id), ...hidden);
}

/** The signed-in person's own unread count, for the bell. */
export async function countMyUnread(): Promise<number> {
  const user = await requireUser();
  await authorize(user, "notifications.read", { ownerUserId: user.id });
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(visibleToMe(user), isNull(notifications.readAt)));
  return n;
}

export async function listMyNotifications(limit = 20): Promise<NotificationItem[]> {
  const user = await requireUser();
  await authorize(user, "notifications.read", { ownerUserId: user.id });
  const rows = await db.select().from(notifications).where(visibleToMe(user)).orderBy(desc(notifications.createdAt)).limit(Math.min(limit, 50));
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt, read: r.readAt !== null }));
}

/** Whether the signed-in person has opted out of the daily digest email. */
export async function getMyDigestOptOut(): Promise<boolean> {
  const user = await requireUser();
  await authorize(user, "notifications.read", { ownerUserId: user.id });
  const [p] = await db.select({ o: emailPreferences.digestOptOut }).from(emailPreferences).where(eq(emailPreferences.userId, user.id)).limit(1);
  return p?.o ?? true;
}

/** Whether the signed-in person has opted out of training reminder emails. */
export async function getMyTrainingReminderOptOut(): Promise<boolean> {
  const user = await requireUser();
  await authorize(user, "notifications.read", { ownerUserId: user.id });
  const [p] = await db.select({ o: emailPreferences.trainingReminderOptOut }).from(emailPreferences).where(eq(emailPreferences.userId, user.id)).limit(1);
  return p?.o ?? true;
}
