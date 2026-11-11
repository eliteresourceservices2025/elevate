import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { clients } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { clientHoursForRun } from "@/modules/payroll/client-hours";
import { buildInvoiceLines, invoiceNumber, parseDollars, rateInForce } from "./calc";
import { clientBillRates, invoices } from "./schema";

// Everything that touches invoices and billing rates. The caller has already authorized. The ONLY pay-run data read is clientHoursForRun:
// the run's period and status and each person's client payroll hours. Nothing here reads or decrypts a pay figure.

type Reader = Pick<typeof db, "select">;

export const invoiceToday = (): string => formatInZone(Date.now(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

const rateContext = (id: string) => `client_bill_rate:${id}`;
const invoiceContext = (id: string) => `invoice:${id}`;

export type BillRate = { id: string; clientId: string; effectiveFrom: string; createdAt: Date; createdBy: string; rateCents: bigint };

function decryptRate(row: typeof clientBillRates.$inferSelect): BillRate {
  const text = fieldCrypto().decrypt(row.rateEnc, rateContext(row.id));
  if (!/^\d{1,9}$/.test(text)) throw new Error("Unreadable billing rate");
  return { id: row.id, clientId: row.clientId, effectiveFrom: row.effectiveFrom, createdAt: row.createdAt, createdBy: row.createdBy, rateCents: BigInt(text) };
}

/** Every rate row (all clients, or one), newest first. */
export async function readBillRates(executor: Reader, clientId?: string): Promise<BillRate[]> {
  const rows = await executor
    .select()
    .from(clientBillRates)
    .where(clientId ? eq(clientBillRates.clientId, clientId) : undefined)
    .orderBy(desc(clientBillRates.effectiveFrom), desc(clientBillRates.createdAt));
  return rows.map(decryptRate);
}

const payloadSchema = z.object({
  clientName: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  rateCents: z.string().regex(/^\d+$/),
  lines: z.array(z.object({ name: z.string(), alias: z.string().nullable(), hoursHundredths: z.string().regex(/^\d+$/), amountCents: z.string().regex(/^\d+$/) })),
  totalHoursHundredths: z.string().regex(/^\d+$/),
  totalCents: z.string().regex(/^\d+$/),
  unconfirmedLines: z.number().int().min(0),
});

export type InvoiceView = {
  id: string;
  number: string;
  runId: string;
  clientId: string;
  runStatus: string;
  issuedOn: string;
  createdAt: Date;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  rateCents: bigint;
  lines: { name: string; alias: string | null; hoursHundredths: bigint; amountCents: bigint }[];
  totalHoursHundredths: bigint;
  totalCents: bigint;
  unconfirmedLines: number;
};

export function decryptInvoice(row: typeof invoices.$inferSelect): InvoiceView {
  const p = payloadSchema.parse(JSON.parse(fieldCrypto().decrypt(row.payloadEnc, invoiceContext(row.id))));
  return {
    id: row.id,
    number: row.number,
    runId: row.runId,
    clientId: row.clientId,
    runStatus: row.runStatus,
    issuedOn: row.issuedOn,
    createdAt: row.createdAt,
    clientName: p.clientName,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    rateCents: BigInt(p.rateCents),
    lines: p.lines.map((l) => ({ name: l.name, alias: l.alias, hoursHundredths: BigInt(l.hoursHundredths), amountCents: BigInt(l.amountCents) })),
    totalHoursHundredths: BigInt(p.totalHoursHundredths),
    totalCents: BigInt(p.totalCents),
    unconfirmedLines: p.unconfirmedLines,
  };
}

export type RunPreviewClient = {
  clientId: string;
  clientName: string;
  people: number;
  hoursHundredths: bigint;
  unconfirmedLines: number;
  rateCents: bigint | null;
  totalCents: bigint | null;
  /** Invoices already made for this run and client; the next one is a revision. */
  existing: number;
};

export type RunPreview = {
  run: { id: string; periodStart: string; periodEnd: string; status: string };
  clients: RunPreviewClient[];
  /** People on the run with no client: not invoiced. */
  noClient: string[];
};

/** What an invoice could be made from for one run, per client, with the rate that would apply today. Null when there is no such run. */
export async function previewRun(executor: Reader, runId: string, onDate: string = invoiceToday()): Promise<RunPreview | null> {
  const data = await clientHoursForRun(executor, runId);
  if (!data) return null;
  const rates = await readBillRates(executor);
  const made = await executor.select({ clientId: invoices.clientId }).from(invoices).where(eq(invoices.runId, runId));
  const out = new Map<string, RunPreviewClient>();
  const noClient: string[] = [];
  for (const r of data.rows) {
    if (!r.clientId) {
      noClient.push(r.alias ? `${r.personName} (${r.alias})` : r.personName);
      continue;
    }
    if (r.hundredths <= 0n) continue;
    let c = out.get(r.clientId);
    if (!c) {
      const rate = rateInForce(rates.filter((x) => x.clientId === r.clientId), onDate);
      c = { clientId: r.clientId, clientName: r.clientName ?? "Client", people: 0, hoursHundredths: 0n, unconfirmedLines: 0, rateCents: rate?.rateCents ?? null, totalCents: null, existing: made.filter((m) => m.clientId === r.clientId).length };
      out.set(r.clientId, c);
    }
    c.people += 1;
    c.hoursHundredths += r.hundredths;
    if (!r.confirmed) c.unconfirmedLines += 1;
  }
  for (const c of out.values()) {
    if (c.rateCents === null) continue;
    const rows = data.rows.filter((r) => r.clientId === c.clientId);
    c.totalCents = buildInvoiceLines(rows, c.rateCents).totalCents;
  }
  return { run: data.run, clients: [...out.values()].sort((a, b) => a.clientName.localeCompare(b.clientName)), noClient };
}

/** Makes one invoice inside the caller's transaction. Throws ActionFailure with a plain message when it cannot. */
export async function createInvoiceIn(tx: Tx, actor: AuthUser, v: { runId: string; clientId: string }): Promise<{ id: string; number: string }> {
  // One number at a time, so two invoices made together cannot get the same number.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"invoices.number"}))`);

  const data = await clientHoursForRun(tx, v.runId);
  if (!data) throw new ActionFailure("That pay run was not found.");
  if (data.run.status === "cancelled") throw new ActionFailure("A cancelled pay run can't be invoiced.");

  const [client] = await tx.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.id, v.clientId), isNull(clients.archivedAt))).limit(1);
  if (!client) throw new ActionFailure("That client was not found.");

  const rows = data.rows.filter((r) => r.clientId === v.clientId);
  const built0 = buildInvoiceLines(rows, 1n);
  if (built0.lines.length === 0) throw new ActionFailure(`${client.name} has no hours on this pay run, so there is nothing to invoice.`);

  const issuedOn = invoiceToday();
  const rate = rateInForce(await readBillRates(tx, v.clientId), issuedOn);
  if (!rate) throw new ActionFailure(`${client.name} has no billing rate yet. Add one on the Rates tab first.`);

  const built = buildInvoiceLines(rows, rate.rateCents);
  built.lines.sort((a, b) => a.name.localeCompare(b.name) || (a.alias ?? "").localeCompare(b.alias ?? ""));

  const year = Number(issuedOn.slice(0, 4));
  const earlier = await tx
    .select({ year: invoices.year, seq: invoices.seq, revision: invoices.revision })
    .from(invoices)
    .where(and(eq(invoices.runId, v.runId), eq(invoices.clientId, v.clientId)))
    .orderBy(asc(invoices.revision));
  let useYear = year;
  let seq: number;
  let revision = 1;
  if (earlier.length > 0) {
    // A revision keeps the number of the first invoice and adds -R2, -R3.
    useYear = earlier[0].year;
    seq = earlier[0].seq;
    revision = earlier[earlier.length - 1].revision + 1;
  } else {
    const [top] = await tx.select({ seq: sql<number>`coalesce(max(${invoices.seq}), 0)::int` }).from(invoices).where(eq(invoices.year, year));
    seq = (top?.seq ?? 0) + 1;
  }
  if (seq > 9999) throw new ActionFailure("This year's invoice numbers are used up. Ask for help.");

  const id = randomUUID();
  const number = invoiceNumber(useYear, seq, revision);
  const payload = {
    clientName: client.name,
    periodStart: data.run.periodStart,
    periodEnd: data.run.periodEnd,
    rateCents: rate.rateCents.toString(),
    lines: built.lines.map((l) => ({ name: l.name, alias: l.alias, hoursHundredths: l.hoursHundredths.toString(), amountCents: l.amountCents.toString() })),
    totalHoursHundredths: built.totalHoursHundredths.toString(),
    totalCents: built.totalCents.toString(),
    unconfirmedLines: built.unconfirmedLines,
  };
  await tx.insert(invoices).values({
    id,
    number,
    year: useYear,
    seq,
    revision,
    runId: v.runId,
    clientId: v.clientId,
    runStatus: data.run.status,
    issuedOn,
    payloadEnc: fieldCrypto().encrypt(JSON.stringify(payload), invoiceContext(id)),
    createdBy: actor.id,
  });
  // Ids and counts only: never a rate, an hours total, a name or an amount.
  await writeAudit({ actor, action: "invoice.create", targetType: "invoice", targetId: id, metadata: { runId: v.runId, clientId: v.clientId, lines: built.lines.length, revision } }, tx);
  return { id, number };
}

/** Adds a billing rate (a new row; earlier rows stay). Throws ActionFailure when the client is not found. */
export async function addBillRateIn(tx: Tx, actor: AuthUser, v: { clientId: string; effectiveFrom: string; rate: string }): Promise<{ id: string }> {
  const cents = parseDollars(v.rate);
  if (cents === null) throw new ActionFailure("Enter a rate in dollars, for example 25.50.");
  const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, v.clientId), isNull(clients.archivedAt))).limit(1);
  if (!client) throw new ActionFailure("That client was not found.");
  const id = randomUUID();
  await tx.insert(clientBillRates).values({ id, clientId: v.clientId, effectiveFrom: v.effectiveFrom, rateEnc: fieldCrypto().encrypt(cents.toString(), rateContext(id)), createdBy: actor.id });
  await writeAudit({ actor, action: "invoice.rate.add", targetType: "client_bill_rate", targetId: id, metadata: { clientId: v.clientId } }, tx);
  return { id };
}
