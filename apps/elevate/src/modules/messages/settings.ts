import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { requireMember, type Actor } from "./service";
import { conversationMembers, userSettings } from "./schema";

// A person's own chat settings (online dot, the daily email) and muting a chat. Everything here is about the person themself.

export type ChatSettings = { appearOffline: boolean; emailDigest: boolean };

const DEFAULTS: ChatSettings = { appearOffline: false, emailDigest: true };

export async function getChatSettings(): Promise<ChatSettings> {
  const actor = await requireUser();
  await authorize(actor, "messages.use", { ownerUserId: actor.id });
  const [row] = await db.select({ appearOffline: userSettings.appearOffline, emailDigest: userSettings.emailDigest }).from(userSettings).where(eq(userSettings.userId, actor.id)).limit(1);
  return row ?? DEFAULTS;
}

export async function saveChatSettings(actor: Actor, input: ChatSettings): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId: actor.id, appearOffline: input.appearOffline, emailDigest: input.emailDigest })
    .onConflictDoUpdate({ target: userSettings.userId, set: { appearOffline: input.appearOffline, emailDigest: input.emailDigest, updatedAt: new Date() } });
}

/** Mutes a chat for an hour, eight hours or until the person turns it back on ("off" unmutes). A muted chat stops adding to their unread total and email. */
export async function muteConversation(actor: Actor, input: { conversationId: string; until: "1h" | "8h" | "forever" | "off" }): Promise<void> {
  await requireMember(db, actor.id, input.conversationId);
  const until =
    input.until === "off" ? null : input.until === "forever" ? sql`'9999-12-31T00:00:00Z'::timestamptz` : input.until === "1h" ? sql`now() + interval '1 hour'` : sql`now() + interval '8 hours'`;
  const updated = await db
    .update(conversationMembers)
    .set({ mutedUntil: until })
    .where(and(eq(conversationMembers.conversationId, input.conversationId), eq(conversationMembers.userId, actor.id), isNull(conversationMembers.leftAt)))
    .returning({ userId: conversationMembers.userId });
  if (updated.length === 0) throw new ActionFailure("Conversation not found.");
}
