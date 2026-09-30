"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { listMyNotifications, type NotificationItem } from "./queries";
import { notifications } from "./schema";

/** Loads the bell's list when it opens. */
export async function loadNotifications(): Promise<ActionResult<{ items: NotificationItem[] }>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: { items: await listMyNotifications() } }));
}

export async function markNotificationRead(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "notifications.read", { ownerUserId: actor.id });
    const parsed = z.object({ id: z.uuid() }).safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    // The user id is part of the condition, so nobody can mark someone else's notification.
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, parsed.data.id), eq(notifications.userId, actor.id), isNull(notifications.readAt)));
    return { ok: true, data: undefined };
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "notifications.read", { ownerUserId: actor.id });
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
    return { ok: true, data: undefined };
  });
}
