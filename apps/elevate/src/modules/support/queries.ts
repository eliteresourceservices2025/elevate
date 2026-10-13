import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/modules/core/schema";
import { supportRequests } from "./schema";

export type SupportRow = { id: string; topic: string; subject: string; message: string; page: string | null; status: "open" | "closed"; emailed: boolean; createdAt: string; closedAt: string | null; from: string | null };

const toRow = (r: { id: string; topic: string; subject: string; message: string; page: string | null; status: string; emailed: boolean; createdAt: Date; closedAt: Date | null }, from: string | null): SupportRow => ({
  id: r.id,
  topic: r.topic,
  subject: r.subject,
  message: r.message,
  page: r.page,
  status: r.status === "closed" ? "closed" : "open",
  emailed: r.emailed,
  createdAt: r.createdAt.toISOString(),
  closedAt: r.closedAt ? r.closedAt.toISOString() : null,
  from,
});

/** The signed-in person's own requests, newest first. */
export async function listMySupportRequests(): Promise<SupportRow[]> {
  const user = await requireUser();
  await authorize(user, "support.create", { ownerUserId: user.id });
  const rows = await db.select().from(supportRequests).where(eq(supportRequests.userId, user.id)).orderBy(desc(supportRequests.createdAt)).limit(50);
  return rows.map((r) => toRow(r, null));
}

/** Everyone's requests, open first (HR and Super Admin). */
export async function listSupportInbox(): Promise<SupportRow[]> {
  const user = await requireUser();
  await authorize(user, "support.manage");
  const rows = await db
    .select({ r: supportRequests, email: supportRequests.email, name: sql<string | null>`(select trim(e.legal_first_name || ' ' || e.legal_last_name) from core.employees e where e.user_id = ${users.id} limit 1)` })
    .from(supportRequests)
    .innerJoin(users, eq(users.id, supportRequests.userId))
    .orderBy(sql`${supportRequests.status} = 'closed'`, desc(supportRequests.createdAt))
    .limit(300);
  return rows.map((x) => toRow(x.r, x.name ? `${x.name} (${x.email})` : x.email));
}
