import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { documents } from "./schema";
import type { Bucket } from "./storage";

type Executor = Pick<typeof db, "select" | "update">;

/**
 * Retention: blanks a person's document rows (title, file name, checksum) and archives them. Returns the stored files so the
 * caller can delete them from storage after its transaction commits. Called from the people retention job only.
 */
export async function blankEmployeeDocuments(executor: Executor, employeeId: string, now: Date): Promise<{ bucket: Bucket; path: string }[]> {
  const rows = await executor
    .select({ bucket: documents.storageBucket, path: documents.storagePath })
    .from(documents)
    .where(and(eq(documents.employeeId, employeeId), sql`${documents.title} <> '[removed]'`));
  if (rows.length === 0) return [];
  await executor
    .update(documents)
    .set({ title: "[removed]", originalName: "[removed]", sha256: null, mimeType: null, expiresOn: null, archivedAt: now, updatedAt: now })
    .where(and(eq(documents.employeeId, employeeId), sql`${documents.title} <> '[removed]'`));
  return rows.map((r) => ({ bucket: r.bucket as Bucket, path: r.path }));
}
