import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { ReportType } from "./constants";
import { reportMessages } from "./schema";
import { resolveReport } from "./service";
import { reportRefSchema } from "./validators";

export const messageContext = (reportId: string, messageId: string) => `report_message:${reportId}:${messageId}`;

export type ReportThread = {
  messages: { id: string; authorKind: "reporter" | "handler"; mine: boolean; body: string; createdAt: string }[];
  /** Whether the signed-in person may write (always, once they may read). */
  canPost: boolean;
  /** Who the report is about, for the heading. */
  reporterName: string;
  standing: "reporter" | "handler";
};

/** The messages on one report, oldest first. Only the person it is about and whoever may handle that kind of report can read them. */
export async function getReportThread(input: unknown): Promise<ReportThread> {
  const user = await requireUser();
  const { type, id } = reportRefSchema.parse(input);
  const standing = await resolveReport(db, user, type, id);
  const rows = await db
    .select()
    .from(reportMessages)
    .where(and(eq(reportMessages.reportType, type), eq(reportMessages.reportId, id)))
    .orderBy(asc(reportMessages.createdAt), asc(reportMessages.id));
  return {
    messages: rows.map((r) => ({
      id: r.id,
      authorKind: r.authorKind as "reporter" | "handler",
      mine: r.authorUserId === user.id,
      body: fieldCrypto().decrypt(r.bodyEnc, messageContext(id, r.id)),
      createdAt: r.createdAt.toISOString(),
    })),
    canPost: true,
    reporterName: standing.reporterName,
    standing: standing.standing,
  };
}

/** How many messages each report has, for a list. Only call it for reports the viewer can already see. */
export async function reportThreadCounts(type: ReportType, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const found = await db
    .select({ id: reportMessages.reportId, n: sql<number>`count(*)::int` })
    .from(reportMessages)
    .where(and(eq(reportMessages.reportType, type), inArray(reportMessages.reportId, ids)))
    .groupBy(reportMessages.reportId);
  for (const r of found) out.set(r.id, r.n);
  return out;
}
