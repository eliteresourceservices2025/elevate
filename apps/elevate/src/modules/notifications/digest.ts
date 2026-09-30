import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buildDigest } from "./email-content";
import { queueEmails } from "./email-queue";

/**
 * Queues one digest email for each active person who has unread notifications and has not opted out.
 * `day` (yyyy-MM-dd) keys the email, so running twice the same day queues nothing new.
 * Counts only: what the notifications say stays in the app.
 */
export async function runDailyDigest(day: string): Promise<{ queued: number }> {
  const rows = (await db.execute(sql`
    select n.user_id, n.kind, count(*)::int as n
    from ops.notifications n
    join core.users u on u.id = n.user_id
    left join ops.email_preferences p on p.user_id = n.user_id
    where n.read_at is null
      and u.archived_at is null
      and coalesce(p.digest_opt_out, false) = false
    group by n.user_id, n.kind`)) as unknown as { user_id: string; kind: string; n: number }[];

  const byUser = new Map<string, { kind: string; count: number }[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), { kind: r.kind, count: r.n }]);

  const items = [...byUser].map(([userId, counts]) => {
    const d = buildDigest(counts);
    return { userId, kind: "digest" as const, subject: d.subject, heading: d.heading, lines: d.lines, link: "/dashboard", dedupeKey: `digest:${day}` };
  });
  return { queued: await queueEmails(db, items) };
}
