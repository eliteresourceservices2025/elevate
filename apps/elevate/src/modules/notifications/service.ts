import "server-only";
import type { db } from "@/lib/db";
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
