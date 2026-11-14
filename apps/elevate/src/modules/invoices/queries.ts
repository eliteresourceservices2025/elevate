import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageInfo, paginate } from "@/lib/pagination";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import { rateInForce } from "./calc";
import type { BulkAction } from "@/lib/bulk";
import { invoiceActions, invoiceWhy, likePattern, parseShow, type InvoiceShow } from "./list-options";
import { invoices } from "./schema";
import { decryptInvoice, invoiceToday, loadInvoiceView, readBillRates, readEvents, type InvoiceState, type InvoiceView } from "./service";

// Reads for the invoice pages. Each starts with requireUser() and authorize("invoices.view").

export { parseShow, type InvoiceShow };

export type InvoiceListRow = { id: string; number: string; clientName: string; periodStart: string; periodEnd: string; runStatus: string; issuedOn: string; totalCents: bigint; unreadable: boolean; isTest: boolean; state: InvoiceState; actions: BulkAction[]; whyNot: string | null; why: Partial<Record<BulkAction, string>> };

/** The kind of an invoice's newest event (void, replaced, archived, restored), or null when it has none. */
const LAST_KIND = sql`(select e.kind from ops.invoice_events e where e.invoice_id = ${invoices.id} order by e.created_at desc, e.id desc limit 1)`;

/** Live means no event yet, or the newest one is a restore: the only invoices the default list shows. */
const LIVE = sql`coalesce((select e.kind from ops.invoice_events e where e.invoice_id = ${invoices.id} order by e.created_at desc, e.id desc limit 1), 'restored') = 'restored'`;

/**
 * One page of invoices, newest first. By default only live invoices show; `show` can ask for every invoice ("all") or for test invoices
 * ("test", live or not). `q` narrows by invoice number or client name. `all: true` is the old way to say show "all".
 * Also returns the summary: what real live invoices issued this month add up to, and how many are live.
 */
export async function listInvoices(paging: { page: number; pageSize: number }, options: { all?: boolean; show?: InvoiceShow; q?: string } = {}) {
  const actor = await requireUser();
  await authorize(actor, "invoices.view");

  const show: InvoiceShow = options.show ?? (options.all === true ? "all" : "live");
  const q = (options.q ?? "").trim().slice(0, 80);
  const pattern = likePattern(q);
  const search = q === "" ? undefined : or(ilike(invoices.number, pattern), sql`exists (select 1 from core.clients c where c.id = ${invoices.clientId} and c.name ilike ${pattern})`);
  const scope =
    show === "live" ? LIVE : show === "test" ? eq(invoices.isTest, true) : show === "void" ? sql`${LAST_KIND} = 'voided'` : show === "replaced" ? sql`${LAST_KIND} = 'superseded'` : show === "archived" ? sql`${LAST_KIND} = 'archived'` : undefined;
  const where = and(scope, search);

  const [{ total }] = await db.select({ total: count() }).from(invoices).where(where);
  // How many invoices each view holds (the numbers beside the view links).
  const [counts] = await db
    .select({
      all: count(),
      live: sql<number>`count(*) filter (where ${LIVE})::int`,
      void: sql<number>`count(*) filter (where ${LAST_KIND} = 'voided')::int`,
      replaced: sql<number>`count(*) filter (where ${LAST_KIND} = 'superseded')::int`,
      test: sql<number>`count(*) filter (where ${invoices.isTest})::int`,
      archived: sql<number>`count(*) filter (where ${LAST_KIND} = 'archived')::int`,
    })
    .from(invoices);
  const live = counts.live;
  const every = counts.all;
  const info = pageInfo(total, paging.page, paging.pageSize);
  const rows = await db.select().from(invoices).where(where).orderBy(desc(invoices.createdAt), desc(invoices.id)).limit(info.pageSize).offset(info.offset);
  const events = await readEvents(db, rows.map((r) => r.id));
  const list: InvoiceListRow[] = rows.map((r) => {
    try {
      const v = decryptInvoice(r, events);
      return { id: r.id, number: r.number, clientName: v.clientName, periodStart: v.periodStart, periodEnd: v.periodEnd, runStatus: r.runStatus, issuedOn: r.issuedOn, totalCents: v.totalCents, unreadable: false, isTest: r.isTest, state: v.state, ...invoiceActions({ isTest: r.isTest, state: v.state }), why: invoiceWhy({ isTest: r.isTest, state: v.state }) };
    } catch (error) {
      console.error("invoice unreadable:", { invoiceId: r.id, error: error instanceof Error ? error.name : "UnknownError" });
      return { id: r.id, number: r.number, clientName: "Can't be read", periodStart: "", periodEnd: "", runStatus: r.runStatus, issuedOn: r.issuedOn, totalCents: 0n, unreadable: true, isTest: r.isTest, state: "active", actions: [], whyNot: "This invoice can't be read.", why: {} };
    }
  });
  // This month's real, live invoices (a practice invoice never counts): the sum of what they bill, in cents.
  const month = invoiceToday().slice(0, 7);
  const monthRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.isTest, false), LIVE, gte(invoices.issuedOn, `${month}-01`)))
    .limit(500);
  let billedThisMonthCents = 0n;
  for (const r of monthRows) {
    try {
      billedThisMonthCents += decryptInvoice(r).totalCents;
    } catch {
      // An invoice that can't be read is already flagged in the list; it adds nothing here.
    }
  }

  return {
    rows: list,
    info,
    canCreate: can(actor, "invoices.create"),
    canDelete: can(actor, "invoices.delete"),
    canManage: can(actor, "invoices.manage"),
    views: { all: counts.all, live: counts.live, void: counts.void, replaced: counts.replaced, test: counts.test, archived: counts.archived } satisfies Record<InvoiceShow, number>,
    show,
    q,
    hiddenCount: every - live,
    liveCount: live,
    billedThisMonthCents,
    monthIssuedCount: monthRows.length,
    month,
  };
}

export type InvoiceableRun = { id: string; periodStart: string; periodEnd: string; status: string; isTest: boolean };

/** The runs a new invoice can be made from (not cancelled, not archived), newest period first. Only the period, status and test flag are read. */
export async function listInvoiceableRuns(): Promise<InvoiceableRun[]> {
  const actor = await requireUser();
  await authorize(actor, "invoices.create");
  const rows = (await db.execute(
    sql`select id, period_start::text as "periodStart", period_end::text as "periodEnd", status, is_test as "isTest" from payroll.pay_runs where status <> 'cancelled' and archived_at is null order by period_start desc, created_at desc limit 60`,
  )) as unknown as InvoiceableRun[];
  return rows;
}

/** One invoice, decrypted. Null when it does not exist. Opening it is audited with the id only. */
export async function getInvoice(id: string): Promise<InvoiceView | null> {
  const actor = await requireUser();
  await authorize(actor, "invoices.view");
  const view = await loadInvoiceView(db, id);
  if (!view) return null;
  await writeAudit({ actor, action: "sensitive.view", targetType: "invoice", targetId: id, metadata: { fields: ["invoice"] } });
  return view;
}

export type RateOverviewRow = { clientId: string; clientName: string; currentCents: bigint | null; currentFrom: string | null; upcoming: { effectiveFrom: string; rateCents: bigint } | null };
export type PersonRateRow = { clientId: string; clientName: string; employeeId: string; personName: string; currentCents: bigint | null; currentFrom: string | null; upcoming: { effectiveFrom: string; rateCents: bigint } | null };
export type RateHistoryRow = { id: string; clientName: string; /** Null for the client's default rate. */ personName: string | null; effectiveFrom: string; rateCents: bigint; createdAt: Date };

const nameOf = (r: { first: string; last: string; preferred: string | null }) => `${r.preferred?.trim() || r.first} ${r.last}`;

export async function getBillRates(paging: { page: number; pageSize: number }) {
  const actor = await requireUser();
  await authorize(actor, "invoices.view");

  const list = await db.select({ id: clients.id, name: clients.name }).from(clients).where(isNull(clients.archivedAt)).orderBy(asc(clients.name));
  const rates = await readBillRates(db);
  const today = invoiceToday();
  const overview: RateOverviewRow[] = list.map((c) => {
    const mine = rates.filter((r) => r.clientId === c.id && r.employeeId === null);
    const now = rateInForce(mine, today);
    const next = mine.filter((r) => r.effectiveFrom > today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    return { clientId: c.id, clientName: c.name, currentCents: now?.rateCents ?? null, currentFrom: now?.effectiveFrom ?? null, upcoming: next ? { effectiveFrom: next.effectiveFrom, rateCents: next.rateCents } : null };
  });
  const names = new Map(list.map((c) => [c.id, c.name]));

  // People: those who already have a rate of their own, and those who have a pay line for a client (who a rate could be added for).
  const linked = (await db.execute(sql`select distinct l.client_id::text as "clientId", l.employee_id::text as "employeeId" from payroll.pay_lines l where l.client_id is not null`)) as unknown as { clientId: string; employeeId: string }[];
  const personIds = [...new Set([...rates.flatMap((r) => (r.employeeId ? [r.employeeId] : [])), ...linked.map((l) => l.employeeId)])];
  const people = personIds.length === 0 ? [] : await db.select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(inArray(employees.id, personIds));
  const personName = new Map(people.map((p) => [p.id, nameOf(p)]));

  const personRates: PersonRateRow[] = [];
  const seen = new Set<string>();
  for (const r of rates) {
    if (!r.employeeId) continue;
    const key = `${r.clientId}|${r.employeeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = rates.filter((x) => x.clientId === r.clientId && x.employeeId === r.employeeId);
    const now = rateInForce(mine, today);
    const next = mine.filter((x) => x.effectiveFrom > today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    personRates.push({ clientId: r.clientId, clientName: names.get(r.clientId) ?? "Client", employeeId: r.employeeId, personName: personName.get(r.employeeId) ?? "Someone", currentCents: now?.rateCents ?? null, currentFrom: now?.effectiveFrom ?? null, upcoming: next ? { effectiveFrom: next.effectiveFrom, rateCents: next.rateCents } : null });
  }
  personRates.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.personName.localeCompare(b.personName));

  const peopleByClient: Record<string, { id: string; name: string }[]> = {};
  for (const l of linked) (peopleByClient[l.clientId] ??= []).push({ id: l.employeeId, name: personName.get(l.employeeId) ?? "Someone" });
  for (const k of Object.keys(peopleByClient)) peopleByClient[k].sort((a, b) => a.name.localeCompare(b.name));

  const history = rates.map((r): RateHistoryRow => ({ id: r.id, clientName: names.get(r.clientId) ?? "Client", personName: r.employeeId ? personName.get(r.employeeId) ?? "Someone" : null, effectiveFrom: r.effectiveFrom, rateCents: r.rateCents, createdAt: r.createdAt }));
  const paged = paginate(history, paging.page, paging.pageSize);
  return { overview, personRates, peopleByClient, history: paged.rows, historyInfo: paged.info, canManage: can(actor, "invoices.manage_rates"), clients: list };
}

/** Which of the invoice buttons this person gets (the actions check again on the server). */
export async function getInvoiceAbilities(): Promise<{ canManage: boolean; canCreate: boolean }> {
  const actor = await requireUser();
  await authorize(actor, "invoices.view");
  return { canManage: can(actor, "invoices.manage"), canCreate: can(actor, "invoices.create") };
}
