import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { queueEmails } from "@/modules/notifications/email-queue";
import { syncChannels, type SyncResult } from "./channels";

/** Daily: keeps the team, department and company chat channels in step with the organization. A plain function so it can be tested. */
export async function runChatChannelSync(): Promise<SyncResult & { skipped?: string }> {
  return syncChannels();
}

/**
 * Daily: one email per person who has unread messages (from others, not removed, not in a muted chat, from when they joined), unless
 * they switched the digest off. A count and a link only: email is not a secure channel. Lowest priority, once per person per day.
 */
export async function runChatDigest(day: string): Promise<{ queued: number }> {
  const people = (await db.execute(sql`
    select cm.user_id, count(*)::int as n
    from chat.messages m
    join chat.conversation_members cm on cm.conversation_id = m.conversation_id and cm.left_at is null
    join chat.conversations c on c.id = m.conversation_id and c.archived_at is null
    join core.users u on u.id = cm.user_id and u.archived_at is null
    left join chat.user_settings s on s.user_id = cm.user_id
    where m.sender_user_id <> cm.user_id and m.kind <> 'system' and m.deleted_at is null
      and m.seq > cm.last_read_seq and m.created_at >= cm.joined_at
      and (cm.muted_until is null or cm.muted_until < now())
      and coalesce(s.email_digest, true)
    group by cm.user_id`)) as unknown as { user_id: string; n: number }[];
  let queued = 0;
  for (let i = 0; i < people.length; i += 200) {
    queued += await queueEmails(
      db,
      people.slice(i, i + 200).map((p) => ({
        userId: p.user_id,
        kind: "chat_unread" as const,
        subject: `You have ${p.n} unread ${p.n === 1 ? "message" : "messages"} in ELEVATE`,
        heading: "Unread messages",
        lines: [`You have ${p.n} unread ${p.n === 1 ? "message" : "messages"} in ELEVATE Messages.`, "Open ELEVATE to read them. You can mute a chat or turn this email off in Messages."],
        link: "/messages",
        dedupeKey: `chat_unread:${day}`,
      })),
    );
  }
  return { queued };
}
