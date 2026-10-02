import "server-only";
import { and, asc, count, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { can, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { pageInfo } from "@/lib/pagination";
import { writeAudit } from "@/modules/audit/write";
import type { SafevoiceCategory, SafevoiceOutcome, SafevoiceStatus } from "./constants";
import { svdb } from "./handler-db";
import { safevoiceAttachments, safevoiceMessages, safevoiceReports } from "./schema";
import { publishableStats, type PublishedStats } from "./stats";
import { caseIdSchema, LIST_FILTERS } from "./validators";

// Reads for Safe Voice. Every query starts with requireUser() and authorize(). The case list and cases need the handler flag (no role
// grants it, a Super Admin included). The Executive gets counts only. Nothing here returns a code, a passphrase hash or a time of day.

export type CaseFilter = (typeof LIST_FILTERS)[number];

export type CaseRow = {
  id: string;
  category: SafevoiceCategory;
  status: SafevoiceStatus;
  outcome: SafevoiceOutcome | null;
  createdDay: string;
  lastActivityDay: string;
  messageCount: number;
  /** Waiting for a handler: not closed, and the latest message (if any) is from the reporter or there is none yet. */
  needsReply: boolean;
};

const lastAuthor = sql<string | null>`(select m.author from ops.safevoice_messages m where m.report_id = ${safevoiceReports.id} order by m.seq desc limit 1)`;
const lastDay = sql<string | null>`(select max(m.sent_day) from ops.safevoice_messages m where m.report_id = ${safevoiceReports.id})`;
const messageCount = sql<number>`(select count(*)::int from ops.safevoice_messages m where m.report_id = ${safevoiceReports.id})`;

function filterWhere(filter: CaseFilter): SQL | undefined {
  if (filter === "all") return undefined;
  if (filter === "open") return ne(safevoiceReports.status, "closed");
  return eq(safevoiceReports.status, filter);
}

export async function listCases(input: { filter: CaseFilter; page: number; pageSize: number }): Promise<{ rows: CaseRow[]; info: ReturnType<typeof pageInfo>; overview: { open: number; needsReply: number } }> {
  const user = await requireUser();
  await authorize(user, "safevoice.handle");
  const where = filterWhere(input.filter);
  const [{ n }] = await svdb.select({ n: count() }).from(safevoiceReports).where(where);
  const info = pageInfo(n, input.page, input.pageSize);
  const rows = await svdb
    .select({ id: safevoiceReports.id, category: safevoiceReports.category, status: safevoiceReports.status, outcome: safevoiceReports.outcome, createdDay: safevoiceReports.createdDay, lastDay, lastAuthor, messages: messageCount })
    .from(safevoiceReports)
    .where(where)
    // Open cases first, those waiting on a handler first, then oldest first; the id only keeps the order stable.
    .orderBy(sql`(${safevoiceReports.status} = 'closed')`, sql`(case when ${lastAuthor} = 'handler' then 1 else 0 end)`, asc(safevoiceReports.createdDay), desc(safevoiceReports.id))
    .limit(info.pageSize)
    .offset(info.offset);
  const [overview] = await svdb
    .select({
      open: sql<number>`count(*) filter (where ${safevoiceReports.status} <> 'closed')::int`,
      needsReply: sql<number>`count(*) filter (where ${safevoiceReports.status} <> 'closed' and coalesce(${lastAuthor}, 'reporter') = 'reporter')::int`,
    })
    .from(safevoiceReports);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      category: r.category as SafevoiceCategory,
      status: r.status as SafevoiceStatus,
      outcome: r.outcome as SafevoiceOutcome | null,
      createdDay: r.createdDay,
      lastActivityDay: r.lastDay ?? r.createdDay,
      messageCount: r.messages,
      needsReply: r.status !== "closed" && (r.lastAuthor ?? "reporter") === "reporter",
    })),
    info,
    overview: { open: overview?.open ?? 0, needsReply: overview?.needsReply ?? 0 },
  };
}

export type CaseDetail = {
  id: string;
  category: SafevoiceCategory;
  status: SafevoiceStatus;
  outcome: SafevoiceOutcome | null;
  createdDay: string;
  closedDay: string | null;
  description: string;
  messages: { id: string; author: "reporter" | "handler"; body: string; day: string }[];
  attachments: { id: string; messageId: string | null; position: number; contentType: string; sizeBytes: number }[];
};

/** One case with its thread. Opening a case is audited (who, which case, never what it says). Returns null when it does not exist. */
export async function getCase(input: unknown): Promise<CaseDetail | null> {
  const user = await requireUser();
  await authorize(user, "safevoice.handle");
  const parsed = caseIdSchema.safeParse({ caseId: input });
  if (!parsed.success) return null;
  const id = parsed.data.caseId;
  const [report] = await svdb
    .select({ id: safevoiceReports.id, category: safevoiceReports.category, status: safevoiceReports.status, outcome: safevoiceReports.outcome, createdDay: safevoiceReports.createdDay, closedDay: safevoiceReports.closedDay, description: safevoiceReports.description })
    .from(safevoiceReports)
    .where(eq(safevoiceReports.id, id));
  if (!report) return null;
  const messages = await svdb
    .select({ id: safevoiceMessages.id, author: safevoiceMessages.author, body: safevoiceMessages.body, day: safevoiceMessages.sentDay })
    .from(safevoiceMessages)
    .where(eq(safevoiceMessages.reportId, id))
    .orderBy(asc(safevoiceMessages.seq));
  const attachments = await svdb
    .select({ id: safevoiceAttachments.id, messageId: safevoiceAttachments.messageId, position: safevoiceAttachments.position, contentType: safevoiceAttachments.contentType, sizeBytes: safevoiceAttachments.sizeBytes })
    .from(safevoiceAttachments)
    .where(eq(safevoiceAttachments.reportId, id))
    .orderBy(asc(safevoiceAttachments.position));
  await writeAudit({ actor: user, action: "safevoice.case_view", targetType: "safevoice_case", targetId: id });
  return {
    ...report,
    category: report.category as SafevoiceCategory,
    status: report.status as SafevoiceStatus,
    outcome: report.outcome as SafevoiceOutcome | null,
    messages: messages.map((m) => ({ ...m, author: m.author as "reporter" | "handler" })),
    attachments,
  };
}

/** One attachment's bytes for a handler. Audited by the caller (the route). */
export async function getAttachment(attachmentId: string): Promise<{ id: string; reportId: string; position: number; contentType: string; data: Buffer } | null> {
  const user = await requireUser();
  await authorize(user, "safevoice.handle");
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
  const [row] = await svdb
    .select({ id: safevoiceAttachments.id, reportId: safevoiceAttachments.reportId, position: safevoiceAttachments.position, contentType: safevoiceAttachments.contentType, data: safevoiceAttachments.data })
    .from(safevoiceAttachments)
    .where(and(eq(safevoiceAttachments.id, attachmentId)));
  return row ?? null;
}

/** Counts by category with small categories held back (see stats.ts). Handlers and the Executive may see them. */
export async function getStats(): Promise<PublishedStats> {
  const user = await requireUser();
  await authorize(user, can(user, "safevoice.handle") ? "safevoice.handle" : "safevoice.view_counts");
  const rows = await svdb.select({ category: safevoiceReports.category, n: count() }).from(safevoiceReports).groupBy(safevoiceReports.category);
  return publishableStats(Object.fromEntries(rows.map((r) => [r.category, r.n])));
}
