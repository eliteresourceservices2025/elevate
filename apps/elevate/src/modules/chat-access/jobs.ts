import "server-only";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { conversations } from "@/modules/messages/schema";
import { postSystemLine } from "@/modules/messages/service";
import { accessRequests } from "./schema";

/**
 * Daily: when HR's access to a chat has ended AND it was actually used, the people in that chat are told with one plain line (owner
 * decision 2026-11-19): the dates, and that two administrators approved it. No name, no reason. Access that was never opened says nothing.
 * Returns how many chats were told.
 */
export async function runChatAccessNotices(): Promise<number> {
  const due = await db
    .select({ r: accessRequests, createdBy: conversations.createdBy })
    .from(accessRequests)
    .innerJoin(conversations, eq(conversations.id, accessRequests.conversationId))
    .where(and(eq(accessRequests.status, "approved"), lt(accessRequests.accessExpiresAt, sql`now()`), isNull(accessRequests.membersNotifiedAt), gt(accessRequests.readCount, 0)))
    .limit(100);
  let told = 0;
  for (const { r, createdBy } of due) {
    const day = (d: Date) => formatInZone(d, DEFAULT_TIMEZONE, "MMM d, yyyy");
    const body =
      r.kind === "chat" && r.windowFrom && r.windowTo
        ? `An administrator was given read-only access to the messages from ${day(r.windowFrom)} to ${day(new Date(r.windowTo.getTime() - 1000))}. Two administrators approved it, and it has ended.`
        : "An administrator was given read-only access to a recording of a call in this chat. Two administrators approved it, and it has ended.";
    try {
      await postSystemLine({ conversationId: r.conversationId, senderUserId: createdBy, body });
    } catch {
      continue; // try again tomorrow
    }
    await db.transaction(async (tx) => {
      await tx.update(accessRequests).set({ membersNotifiedAt: sql`now()` }).where(eq(accessRequests.id, r.id));
      await writeAudit({ actor: null, action: "chat.access.notify_members", targetType: "chat_access_request", targetId: r.id, metadata: { kind: r.kind, conversationId: r.conversationId, reads: r.readCount } }, tx);
    });
    told++;
  }
  return told;
}
