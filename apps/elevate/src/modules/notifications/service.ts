import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db as database, type db } from "@/lib/db";
import { userRoles, users } from "@/modules/core/schema";
import { notifications } from "./schema";

type Executor = Pick<typeof db, "insert">;

export type NewNotification = {
  userId: string;
  /** Machine-readable kind, e.g. "document.expiring". */
  kind: string;
  title: string;
  body?: string;
  /** Relative in-app path. Anything else is dropped so a notification can never point off-site. */
  link?: string;
};

const safeLink = (link: string | undefined) => (link && link.startsWith("/") && !link.startsWith("//") ? link : null);

/** Adds in-app notifications. Pass a transaction to commit them together with the change that caused them. */
export async function notify(executor: Executor, items: NewNotification | NewNotification[]) {
  const list = Array.isArray(items) ? items : [items];
  if (list.length === 0) return;
  await executor.insert(notifications).values(
    list.map((n) => ({ userId: n.userId, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, link: safeLink(n.link) })),
  );
}

/** Sign-in accounts of HR Admins and Super Admins, for summaries that go to "HR". */
export async function hrUserIds(): Promise<string[]> {
  const rows = await database
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(inArray(userRoles.roleSlug, ["hr_admin", "super_admin"]), isNull(users.archivedAt)));
  return rows.map((r) => r.id);
}
