import "server-only";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notify } from "@/modules/notifications/service";
import { notifications } from "@/modules/notifications/schema";
import { userRoles, users } from "@/modules/core/schema";
import { SafevoiceNotConfigured, svdb } from "./handler-db";
import { safevoiceMessages, safevoiceReports } from "./schema";

/**
 * Hourly: tells the designated handlers, in the app only, that Safe Voice has something new. The notification carries counts and a link,
 * never any report text, category or case. It is deliberately coarse (hourly, one message for everything new) so the time a handler is told
 * cannot be matched to the moment someone sent a report. With no handler designated, the Super Admins are told that reports are waiting.
 */
export async function runSafevoiceNotify(): Promise<{ newReports: number; newReplies: number; told: number }> {
  let reports: { id: string }[];
  try {
    reports = await svdb.select({ id: safevoiceReports.id }).from(safevoiceReports).where(eq(safevoiceReports.handlerNotified, false));
  } catch (error) {
    // A laptop or staging copy without the handler connection has nothing to do. In production a missing connection must show up as a failing job in Health.
    if (error instanceof SafevoiceNotConfigured && process.env.NODE_ENV !== "production") return { newReports: 0, newReplies: 0, told: 0 };
    throw error;
  }
  const replies = await svdb
    .select({ id: safevoiceMessages.id })
    .from(safevoiceMessages)
    .where(and(eq(safevoiceMessages.author, "reporter"), eq(safevoiceMessages.handlerNotified, false)));
  if (reports.length === 0 && replies.length === 0) return { newReports: 0, newReplies: 0, told: 0 };

  let recipients = (await db.select({ id: users.id }).from(users).where(and(eq(users.isSafevoiceHandler, true), isNull(users.archivedAt)))).map((r) => r.id);
  const noHandlers = recipients.length === 0;
  if (noHandlers) {
    recipients = (
      await db
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .where(and(eq(userRoles.roleSlug, "super_admin"), isNull(users.archivedAt)))
    ).map((r) => r.id);
  }
  if (noHandlers) {
    // Do not mark anything as told (a handler designated later will be told), but warn the Super Admins at most once a day.
    const since = new Date(Date.now() - 24 * 3_600_000);
    const recent = await db.select({ userId: notifications.userId }).from(notifications).where(and(eq(notifications.kind, "safevoice.no_handlers"), gte(notifications.createdAt, since)));
    const warned = new Set(recent.map((r) => r.userId));
    recipients = recipients.filter((id) => !warned.has(id));
  }
  if (recipients.length === 0) return { newReports: reports.length, newReplies: replies.length, told: 0 }; // nobody to tell (yet)

  const parts = [reports.length ? `${reports.length} new report${reports.length === 1 ? "" : "s"}` : null, replies.length ? `${replies.length} new repl${replies.length === 1 ? "y" : "ies"}` : null].filter(Boolean);
  await db.transaction((tx) =>
    notify(
      tx,
      recipients.map((userId) =>
        noHandlers
          ? { userId, kind: "safevoice.no_handlers", title: "Safe Voice has reports waiting and no handler", body: "Nobody is designated as a Safe Voice handler. Designate one in Settings so the reports can be read.", link: "/settings" }
          : { userId, kind: "safevoice.activity", title: "New Safe Voice activity", body: `${parts.join(" and ")}. Open Safe Voice cases to see what needs attention.`, link: "/safe-voice-cases" },
      ),
    ),
  );

  if (noHandlers) return { newReports: reports.length, newReplies: replies.length, told: recipients.length };
  if (reports.length) await svdb.update(safevoiceReports).set({ handlerNotified: true }).where(inArray(safevoiceReports.id, reports.map((r) => r.id)));
  if (replies.length) await svdb.update(safevoiceMessages).set({ handlerNotified: true }).where(inArray(safevoiceMessages.id, replies.map((r) => r.id)));
  return { newReports: reports.length, newReplies: replies.length, told: recipients.length };
}
