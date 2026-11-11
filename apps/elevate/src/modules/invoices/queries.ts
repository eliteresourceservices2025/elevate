import "server-only";
import { asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageInfo, paginate } from "@/lib/pagination";
import { writeAudit } from "@/modules/audit/write";
import { clients } from "@/modules/people/schema";
import { rateInForce } from "./calc";
import { invoices } from "./schema";
import { decryptInvoice, invoiceToday, readBillRates, type InvoiceView } from "./service";

// Reads for the invoice pages. Each starts with requireUser() and authorize("invoices.view").

export type InvoiceListRow = { id: string; number: string; clientName: string; periodStart: string; periodEnd: string; runStatus: string; issuedOn: string; totalCents: bigint; unreadable: boolean };

export async function listInvoices(paging: { page: number; pageSize: number }) {
  const actor = await requireUser();
  await authorize(actor, "invoices.view");

  const [{ total }] = await db.select({ total: count() }).from(invoices);
  const info = pageInfo(total, paging.page, paging.pageSize);
  const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt), desc(invoices.id)).limit(info.pageSize).offset(info.offset);
  const list: InvoiceListRow[] = rows.map((r) => {
    try {
      const v = decryptInvoice(r);
      return { id: r.id, number: r.number, clientName: v.clientName, periodStart: v.periodStart, periodEnd: v.periodEnd, runStatus: r.runStatus, issuedOn: r.issuedOn, totalCents: v.totalCents, unreadable: false };
    } catch (error) {
      console.error("invoice unreadable:", { invoiceId: r.id, error: error instanceof Error ? error.name : "UnknownError" });
      return { id: r.id, number: r.number, clientName: "Can't be read", periodStart: "", periodEnd: "", runStatus: r.runStatus, issuedOn: r.issuedOn, totalCents: 0n, unreadable: true };
    }
  });
  return { rows: list, info, canCreate: can(actor, "invoices.create") };
}

export type InvoiceableRun = { id: string; periodStart: string; periodEnd: string; status: string };

/** The runs a new invoice can be made from (not cancelled), newest period first. Only the period and status are read. */
export async function listInvoiceableRuns(): Promise<InvoiceableRun[]> {
  const actor = await requireUser();
  await authorize(actor, "invoices.create");
  const rows = (await db.execute(
    sql`select id, period_start::text as "periodStart", period_end::text as "periodEnd", status from payroll.pay_runs where status <> 'cancelled' order by period_start desc limit 60`,
  )) as unknown as InvoiceableRun[];
  return rows;
}

/** One invoice, decrypted. Null when it does not exist. Opening it is audited with the id only. */
export async function getInvoice(id: string): Promise<InvoiceView | null> {
  const actor = await requireUser();
  await authorize(actor, "invoices.view");
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!row) return null;
  const view = decryptInvoice(row);
  await writeAudit({ actor, action: "sensitive.view", targetType: "invoice", targetId: id, metadata: { fields: ["invoice"] } });
  return view;
}

export type RateOverviewRow = { clientId: string; clientName: string; currentCents: bigint | null; currentFrom: string | null; upcoming: { effectiveFrom: string; rateCents: bigint } | null };
export type RateHistoryRow = { id: string; clientName: string; effectiveFrom: string; rateCents: bigint; createdAt: Date };

export async function getBillRates(paging: { page: number; pageSize: number }) {
  const actor = await requireUser();
  await authorize(actor, "invoices.view");

  const list = await db.select({ id: clients.id, name: clients.name }).from(clients).where(isNull(clients.archivedAt)).orderBy(asc(clients.name));
  const rates = await readBillRates(db);
  const today = invoiceToday();
  const overview: RateOverviewRow[] = list.map((c) => {
    const mine = rates.filter((r) => r.clientId === c.id);
    const now = rateInForce(mine, today);
    const next = mine.filter((r) => r.effectiveFrom > today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    return { clientId: c.id, clientName: c.name, currentCents: now?.rateCents ?? null, currentFrom: now?.effectiveFrom ?? null, upcoming: next ? { effectiveFrom: next.effectiveFrom, rateCents: next.rateCents } : null };
  });
  const names = new Map(list.map((c) => [c.id, c.name]));
  const history = rates.map((r): RateHistoryRow => ({ id: r.id, clientName: names.get(r.clientId) ?? "Client", effectiveFrom: r.effectiveFrom, rateCents: r.rateCents, createdAt: r.createdAt }));
  const paged = paginate(history, paging.page, paging.pageSize);
  return { overview, history: paged.rows, historyInfo: paged.info, canManage: can(actor, "invoices.manage_rates"), clients: list };
}
