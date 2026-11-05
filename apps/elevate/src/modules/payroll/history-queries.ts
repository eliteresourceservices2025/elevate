import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { pageInfo, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { writeAudit } from "@/modules/audit/write";
import { employees, clients } from "@/modules/people/schema";
import { isoDate } from "@/modules/people/validators";
import { readChangeDetail } from "./changes";
import { CHANGE_ACTION_LABELS, HISTORY_LABELS as H, type ChangeAction } from "./constants";
import { describeChange, type HistoryChange, type HistoryFact } from "./history-format";
import { personName } from "./remitly";
import { payChangeLog, payRuns } from "./schema";

// The change history: who changed what, in which run, for whom. The detail of every row (figures, reasons, notes) is encrypted; only
// the rows of the requested page are decrypted, and reading a page is one `sensitive.view` audit row (ids and counts, never a figure).

export type HistoryFilters = { runId?: string; employeeId?: string; actorId?: string; from?: string; to?: string; page: number; pageSize?: number };

export type HistoryRow = {
  id: string;
  /** ISO time. */
  at: string;
  action: string;
  actionLabel: string;
  actorName: string;
  personName: string | null;
  runId: string | null;
  runLabel: string | null;
  /** The detail could not be decrypted: no values are shown. */
  unreadable: boolean;
  changes: HistoryChange[];
  facts: HistoryFact[];
};

export type HistoryResult = { rows: HistoryRow[]; total: number; page: number; pageSize: number; error: string | null };

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const filterSchema = z
  .object({
    runId: z.preprocess(blank, z.uuid().optional()),
    employeeId: z.preprocess(blank, z.uuid().optional()),
    actorId: z.preprocess(blank, z.uuid().optional()),
    from: z.preprocess(blank, isoDate.optional()),
    to: z.preprocess(blank, isoDate.optional()),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "The start date must be on or before the end date.", path: ["to"] });

const BAD_DATE = "Enter dates like 2030-01-31.";
const BAD_CHOICE = "That filter isn't valid. Choose from the list.";

const empty = (page: number, pageSize: number, error: string | null): HistoryResult => ({ rows: [], total: 0, page, pageSize, error });

function filterError(issues: z.core.$ZodIssue[]): string {
  const first = issues[0];
  if (first?.message.startsWith("The start date")) return first.message;
  const key = first?.path[0];
  return key === "from" || key === "to" ? BAD_DATE : BAD_CHOICE;
}

/**
 * One page of the change history, newest first. Only people with a payroll level may read it (a Super Admin with no level is refused).
 * A bad filter answers with a message and no rows. A row whose detail can't be decrypted is returned as `unreadable`.
 */
export async function getPayrollHistory(filters: HistoryFilters): Promise<HistoryResult> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view_history");

  const wanted = Number.isInteger(filters.pageSize) && filters.pageSize! > 0 && filters.pageSize! <= 100 ? filters.pageSize! : DEFAULT_PAGE_SIZE;
  const parsed = filterSchema.safeParse(filters);
  if (!parsed.success) return empty(1, wanted, filterError(parsed.error.issues));
  const f = parsed.data;

  const conditions = [
    f.runId ? eq(payChangeLog.runId, f.runId) : undefined,
    f.employeeId ? eq(payChangeLog.employeeId, f.employeeId) : undefined,
    f.actorId ? eq(payChangeLog.actorId, f.actorId) : undefined,
    f.from ? sql`(${payChangeLog.createdAt} at time zone ${DEFAULT_TIMEZONE})::date >= ${f.from}::date` : undefined,
    f.to ? sql`(${payChangeLog.createdAt} at time zone ${DEFAULT_TIMEZONE})::date <= ${f.to}::date` : undefined,
  ];
  const where = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(payChangeLog).where(where);
  const info = pageInfo(total, Number.isFinite(filters.page) ? Math.trunc(filters.page) : 1, wanted);

  const person = alias(employees, "history_person");
  const by = alias(employees, "history_actor");
  const page = await db
    .select({
      id: payChangeLog.id,
      action: payChangeLog.action,
      actorId: payChangeLog.actorId,
      runId: payChangeLog.runId,
      detailEnc: payChangeLog.detailEnc,
      createdAt: payChangeLog.createdAt,
      periodStart: payRuns.periodStart,
      periodEnd: payRuns.periodEnd,
      personFirst: person.legalFirstName,
      personLast: person.legalLastName,
      personPreferred: person.preferredName,
      byFirst: by.legalFirstName,
      byLast: by.legalLastName,
      byPreferred: by.preferredName,
    })
    .from(payChangeLog)
    .leftJoin(payRuns, eq(payRuns.id, payChangeLog.runId))
    .leftJoin(person, eq(person.id, payChangeLog.employeeId))
    .leftJoin(by, eq(by.userId, payChangeLog.actorId))
    .where(where)
    .orderBy(desc(payChangeLog.createdAt), desc(payChangeLog.id))
    .limit(info.pageSize)
    .offset(info.offset);

  // Decrypt only this page. A row that fails is marked, never thrown: the id and the kind of error are the only things logged.
  const details = new Map<string, Record<string, unknown>>();
  for (const r of page) {
    try {
      details.set(r.id, readChangeDetail({ id: r.id, detailEnc: r.detailEnc }));
    } catch (error) {
      console.error("payroll change unreadable:", { rowId: r.id, error: error instanceof Error ? error.name : "UnknownError" });
    }
  }

  // Names for the people mentioned inside details (the person whose payroll access changed, the client of a line).
  const userIds = new Set<string>();
  const clientIds = new Set<string>();
  const idLike = z.uuid();
  for (const d of details.values()) {
    const u = idLike.safeParse(d.userId);
    if (u.success) userIds.add(u.data);
    for (const v of [d.new, d.old]) {
      const c = idLike.safeParse((v as { clientId?: unknown } | null)?.clientId);
      if (c.success) clientIds.add(c.data);
    }
  }
  const userNames = new Map<string, string>();
  if (userIds.size > 0) {
    const found = await db
      .select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
      .from(employees)
      .where(inArray(employees.userId, [...userIds]));
    for (const e of found) if (e.userId) userNames.set(e.userId, personName({ preferred: e.preferred, first: e.first, last: e.last }));
  }
  const clientNames = new Map<string, string>();
  if (clientIds.size > 0) {
    for (const c of await db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, [...clientIds]))) clientNames.set(c.id, c.name);
  }
  const names = { user: (id: string) => userNames.get(id) ?? null, client: (id: string) => clientNames.get(id) ?? null };

  let shown = 0;
  const rows: HistoryRow[] = page.map((r) => {
    const base = {
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      actionLabel: CHANGE_ACTION_LABELS[r.action as ChangeAction] ?? r.action,
      actorName: r.byFirst ? personName({ preferred: r.byPreferred, first: r.byFirst, last: r.byLast ?? "" }) : H.noRecord,
      personName: r.personFirst ? personName({ preferred: r.personPreferred, first: r.personFirst, last: r.personLast ?? "" }) : null,
      runId: r.runId,
      runLabel: r.periodStart ? `${r.periodStart} to ${r.periodEnd}` : null,
    };
    const detail = details.get(r.id);
    if (!detail || !(r.action in CHANGE_ACTION_LABELS)) {
      return { ...base, unreadable: !detail, changes: [], facts: [] };
    }
    try {
      const shownDetail = describeChange(r.action as ChangeAction, detail, names);
      shown++;
      return { ...base, unreadable: false, ...shownDetail };
    } catch (error) {
      console.error("payroll change unreadable:", { rowId: r.id, error: error instanceof Error ? error.name : "UnknownError" });
      return { ...base, unreadable: true, changes: [], facts: [] };
    }
  });

  if (shown > 0) {
    await writeAudit({ actor, action: "sensitive.view", targetType: "pay_change_log", metadata: { fields: ["change details"], count: shown } });
  }
  return { rows, total, page: info.page, pageSize: info.pageSize, error: null };
}

export type HistoryOptions = {
  runs: { id: string; label: string }[];
  people: { id: string; name: string }[];
  actors: { id: string; name: string }[];
};

/** The choices of the filter form: recent runs, the people the log mentions and the people who made changes. Names only, no figures. */
export async function getHistoryFilterOptions(): Promise<HistoryOptions> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view_history");

  const runs = await db
    .select({ id: payRuns.id, start: payRuns.periodStart, end: payRuns.periodEnd })
    .from(payRuns)
    .orderBy(desc(payRuns.periodStart), desc(payRuns.createdAt))
    .limit(200);

  const mentioned = await db.selectDistinct({ id: payChangeLog.employeeId }).from(payChangeLog).where(sql`${payChangeLog.employeeId} is not null`);
  const mentionedIds = mentioned.flatMap((m) => (m.id ? [m.id] : []));
  const people = mentionedIds.length
    ? await db
        .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
        .from(employees)
        .where(inArray(employees.id, mentionedIds))
    : [];

  const actorRows = await db.selectDistinct({ id: payChangeLog.actorId }).from(payChangeLog);
  const actorIds = actorRows.map((a) => a.id);
  const named = actorIds.length
    ? await db
        .select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
        .from(employees)
        .where(inArray(employees.userId, actorIds))
    : [];
  const actorName = new Map(named.flatMap((n) => (n.userId ? [[n.userId, personName({ preferred: n.preferred, first: n.first, last: n.last })] as const] : [])));

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    runs: runs.map((r) => ({ id: r.id, label: `${r.start} to ${r.end}` })),
    people: people.map((p) => ({ id: p.id, name: personName({ preferred: p.preferred, first: p.first, last: p.last }) })).sort(byName),
    actors: actorIds.map((id) => ({ id, name: actorName.get(id) ?? H.noRecord })).sort(byName),
  };
}
