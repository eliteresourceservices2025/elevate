import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { clientHoursForRun } from "@/modules/payroll/client-hours";
import { buildInvoiceLines, invoiceNumber, parseDollars, rateForPerson } from "./calc";
import { clientBillRates, invoiceEvents, invoices } from "./schema";

// Everything that touches invoices and billing rates. The caller has already authorized. The ONLY pay-run data read is clientHoursForRun:
// the run's period and status and each person's client payroll hours. Nothing here reads or decrypts a pay figure.

type Reader = Pick<typeof db, "select">;

export const invoiceToday = (): string => formatInZone(Date.now(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

const rateContext = (id: string) => `client_bill_rate:${id}`;
const invoiceContext = (id: string) => `invoice:${id}`;
const eventContext = (id: string) => `invoice_event:${id}`;

/** `employeeId` null is the client's default rate; a person's id is that person's own rate at the client. */
export type BillRate = { id: string; clientId: string; employeeId: string | null; effectiveFrom: string; createdAt: Date; createdBy: string; rateCents: bigint };

function decryptRate(row: typeof clientBillRates.$inferSelect): BillRate {
  const text = fieldCrypto().decrypt(row.rateEnc, rateContext(row.id));
  if (!/^\d{1,9}$/.test(text)) throw new Error("Unreadable billing rate");
  return { id: row.id, clientId: row.clientId, employeeId: row.employeeId, effectiveFrom: row.effectiveFrom, createdAt: row.createdAt, createdBy: row.createdBy, rateCents: BigInt(text) };
}

/** Every rate row (all clients, one client, or the clients in a list), newest first. */
export async function readBillRates(executor: Reader, clientId?: string | string[]): Promise<BillRate[]> {
  if (Array.isArray(clientId) && clientId.length === 0) return [];
  const rows = await executor
    .select()
    .from(clientBillRates)
    .where(clientId === undefined ? undefined : Array.isArray(clientId) ? inArray(clientBillRates.clientId, clientId) : eq(clientBillRates.clientId, clientId))
    .orderBy(desc(clientBillRates.effectiveFrom), desc(clientBillRates.createdAt));
  return rows.map(decryptRate);
}

const payloadSchema = z.object({
  clientName: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  rateCents: z.string().regex(/^\d+$/),
  // `rateCents` per line is new: an invoice made before it read as the one rate in the header.
  lines: z.array(z.object({ name: z.string(), alias: z.string().nullable(), hoursHundredths: z.string().regex(/^\d+$/), rateCents: z.string().regex(/^\d+$/).optional(), amountCents: z.string().regex(/^\d+$/) })),
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
  isTest: boolean;
  issuedOn: string;
  createdAt: Date;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  rateCents: bigint;
  lines: { name: string; alias: string | null; hoursHundredths: bigint; rateCents: bigint; amountCents: bigint }[];
  totalHoursHundredths: bigint;
  totalCents: bigint;
  unconfirmedLines: number;
  /** What became of the invoice after it was made (archived, voided, replaced), from its newest event. */
  state: InvoiceState;
  /** The reason given for the archive or void, when there was one. */
  stateReason: string | null;
  /** The number of the corrected version that replaced this invoice. */
  replacedByNumber: string | null;
};

export type InvoiceState = "active" | "archived" | "voided" | "superseded";
export type EventRow = typeof invoiceEvents.$inferSelect;

/** An invoice's state is its newest event: none, or a restore, means active; void and replaced are final. */
export function stateFrom(events: readonly EventRow[]): InvoiceState {
  const last = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).at(-1);
  if (!last) return "active";
  return last.kind === "archived" ? "archived" : last.kind === "voided" ? "voided" : last.kind === "superseded" ? "superseded" : "active";
}

/** The events of these invoices, oldest first. */
export async function readEvents(executor: Reader, invoiceIds: string[]): Promise<EventRow[]> {
  if (invoiceIds.length === 0) return [];
  return executor.select().from(invoiceEvents).where(inArray(invoiceEvents.invoiceId, invoiceIds)).orderBy(asc(invoiceEvents.createdAt), asc(invoiceEvents.id));
}

function reasonOf(e: EventRow | undefined): string | null {
  if (!e?.reasonEnc) return null;
  try {
    return fieldCrypto().decrypt(e.reasonEnc, eventContext(e.id));
  } catch (error) {
    console.error("invoice event reason unreadable:", { eventId: e.id, error: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

export function decryptInvoice(row: typeof invoices.$inferSelect, events: readonly EventRow[] = [], numberOf: (id: string) => string | null = () => null): InvoiceView {
  const p = payloadSchema.parse(JSON.parse(fieldCrypto().decrypt(row.payloadEnc, invoiceContext(row.id))));
  const mine = events.filter((e) => e.invoiceId === row.id);
  const state = stateFrom(mine);
  const last = [...mine].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).at(-1);
  return {
    id: row.id,
    number: row.number,
    runId: row.runId,
    clientId: row.clientId,
    runStatus: row.runStatus,
    isTest: row.isTest,
    issuedOn: row.issuedOn,
    createdAt: row.createdAt,
    clientName: p.clientName,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    rateCents: BigInt(p.rateCents),
    lines: p.lines.map((l) => ({ name: l.name, alias: l.alias, hoursHundredths: BigInt(l.hoursHundredths), rateCents: BigInt(l.rateCents ?? p.rateCents), amountCents: BigInt(l.amountCents) })),
    totalHoursHundredths: BigInt(p.totalHoursHundredths),
    totalCents: BigInt(p.totalCents),
    unconfirmedLines: p.unconfirmedLines,
    state,
    stateReason: state === "archived" || state === "voided" ? reasonOf(last) : null,
    replacedByNumber: state === "superseded" && last?.replacedBy ? numberOf(last.replacedBy) : null,
  };
}

/** One invoice decrypted, with its state and the number of the version that replaced it. Null when it does not exist. The caller has authorized. */
export async function loadInvoiceView(executor: Reader, id: string): Promise<InvoiceView | null> {
  const [row] = await executor.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!row) return null;
  const events = await readEvents(executor, [id]);
  const replacers = events.flatMap((e) => (e.replacedBy ? [e.replacedBy] : []));
  const numbers = new Map<string, string>();
  if (replacers.length > 0) for (const r of await executor.select({ id: invoices.id, number: invoices.number }).from(invoices).where(inArray(invoices.id, replacers))) numbers.set(r.id, r.number);
  return decryptInvoice(row, events, (x) => numbers.get(x) ?? null);
}

export type RunPreviewClient = {
  clientId: string;
  clientName: string;
  people: number;
  hoursHundredths: bigint;
  unconfirmedLines: number;
  /** The client's default rate in force today; null when there is none. */
  rateCents: bigint | null;
  /** How many of the people have a rate of their own that applies today. */
  ownRates: number;
  /** People with hours who have neither a rate of their own nor a client default: the invoice can't be made until they have one. */
  missingRates: string[];
  totalCents: bigint | null;
  /** Invoices already made for this run and client; the next one is a revision. */
  existing: number;
};

export type RunPreview = {
  run: { id: string; periodStart: string; periodEnd: string; status: string; isTest: boolean; archived: boolean };
  clients: RunPreviewClient[];
  /** People on the run with no client: not invoiced. */
  noClient: string[];
  /** People who have a client but no client payroll hours entered: nothing to bill yet. */
  noHours: string[];
};

/** What an invoice could be made from for one run, per client, with the rate that would apply today. Null when there is no such run. */
export async function previewRun(executor: Reader, runId: string, onDate: string = invoiceToday()): Promise<RunPreview | null> {
  const data = await clientHoursForRun(executor, runId);
  if (!data) return null;
  // Only the rates of the clients on this run are read (and decrypted).
  const rates = await readBillRates(executor, [...new Set(data.rows.flatMap((r) => (r.clientId ? [r.clientId] : [])))]);
  const made = await executor.select({ clientId: invoices.clientId }).from(invoices).where(eq(invoices.runId, runId));
  const out = new Map<string, RunPreviewClient>();
  const noClient: string[] = [];
  const noHours: string[] = [];
  for (const r of data.rows) {
    if (!r.clientId) {
      noClient.push(r.alias ? `${r.personName} (${r.alias})` : r.personName);
      continue;
    }
    if (r.hundredths <= 0n) {
      noHours.push(r.alias ? `${r.personName} (${r.alias})` : r.personName);
      continue;
    }
    let c = out.get(r.clientId);
    if (!c) {
      const standard = rateForPerson(rates.filter((x) => x.clientId === r.clientId), null, onDate);
      c = { clientId: r.clientId, clientName: r.clientName ?? "Client", people: 0, hoursHundredths: 0n, unconfirmedLines: 0, rateCents: standard?.rateCents ?? null, ownRates: 0, missingRates: [], totalCents: null, existing: made.filter((m) => m.clientId === r.clientId).length };
      out.set(r.clientId, c);
    }
    c.people += 1;
    c.hoursHundredths += r.hundredths;
    if (!r.confirmed) c.unconfirmedLines += 1;
    const mine = rateForPerson(rates.filter((x) => x.clientId === r.clientId), r.employeeId, onDate);
    if (!mine) c.missingRates.push(r.alias ? `${r.personName} (${r.alias})` : r.personName);
    else if (mine.employeeId !== null) c.ownRates += 1;
  }
  for (const c of out.values()) {
    if (c.missingRates.length > 0) continue;
    const clientRates = rates.filter((x) => x.clientId === c.clientId);
    const rows = data.rows.filter((r) => r.clientId === c.clientId);
    c.totalCents = buildInvoiceLines(rows, (r) => rateForPerson(clientRates, r.employeeId, onDate)!.rateCents).totalCents;
  }
  return { run: data.run, clients: [...out.values()].sort((a, b) => a.clientName.localeCompare(b.clientName)), noClient, noHours };
}

/** Makes one invoice inside the caller's transaction. Throws ActionFailure with a plain message when it cannot. */
export async function createInvoiceIn(tx: Tx, actor: AuthUser, v: { runId: string; clientId: string }): Promise<{ id: string; number: string }> {
  // One number at a time, so two invoices made together cannot get the same number.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"invoices.number"}))`);

  const data = await clientHoursForRun(tx, v.runId);
  if (!data) throw new ActionFailure("That pay run was not found.");
  if (data.run.status === "cancelled") throw new ActionFailure("A cancelled pay run can't be invoiced.");
  if (data.run.archived) throw new ActionFailure("An archived test run can't be invoiced. Restore it first.");
  const test = data.run.isTest;

  const [client] = await tx.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.id, v.clientId), isNull(clients.archivedAt))).limit(1);
  if (!client) throw new ActionFailure("That client was not found.");

  const rows = data.rows.filter((r) => r.clientId === v.clientId);
  const built0 = buildInvoiceLines(rows, 1n);
  if (built0.lines.length === 0) throw new ActionFailure(`${client.name} has no hours on this pay run, so there is nothing to invoice.`);

  const issuedOn = invoiceToday();
  const clientRates = await readBillRates(tx, v.clientId);
  if (clientRates.length === 0) throw new ActionFailure(`${client.name} has no billing rate yet. Add one on the Billing rates tab first.`);
  // Each person is billed at their own rate if they have one in force, else the client's default.
  const missing = rows.filter((r) => r.hundredths > 0n && !rateForPerson(clientRates, r.employeeId, issuedOn));
  if (missing.length > 0) {
    const names = missing.map((r) => (r.alias ? `${r.personName} (${r.alias})` : r.personName)).join(", ");
    throw new ActionFailure(`No billing rate applies to ${names}. Add a default rate for ${client.name}, or a rate for them, on the Billing rates tab.`);
  }

  const built = buildInvoiceLines(rows, (r) => rateForPerson(clientRates, r.employeeId, issuedOn)!.rateCents);
  const standard = rateForPerson(clientRates, null, issuedOn)?.rateCents ?? built.lines[0].rateCents;
  built.lines.sort((a, b) => a.name.localeCompare(b.name) || (a.alias ?? "").localeCompare(b.alias ?? ""));

  const year = Number(issuedOn.slice(0, 4));
  const earlier = await tx
    .select({ id: invoices.id, year: invoices.year, seq: invoices.seq, revision: invoices.revision })
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
    // A test run has its own series, so real invoice numbers never skip because of practice invoices.
    const [top] = await tx.select({ seq: sql<number>`coalesce(max(${invoices.seq}), 0)::int` }).from(invoices).where(and(eq(invoices.year, year), eq(invoices.isTest, test)));
    seq = (top?.seq ?? 0) + 1;
  }
  if (seq > 9999) throw new ActionFailure("This year's invoice numbers are used up. Ask for help.");

  const id = randomUUID();
  const number = invoiceNumber(useYear, seq, revision, test);
  const payload = {
    clientName: client.name,
    periodStart: data.run.periodStart,
    periodEnd: data.run.periodEnd,
    rateCents: standard.toString(),
    lines: built.lines.map((l) => ({ name: l.name, alias: l.alias, hoursHundredths: l.hoursHundredths.toString(), rateCents: l.rateCents.toString(), amountCents: l.amountCents.toString() })),
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
    isTest: test,
    issuedOn,
    payloadEnc: fieldCrypto().encrypt(JSON.stringify(payload), invoiceContext(id)),
    createdBy: actor.id,
  });
  // A corrected version replaces the previous one: the older invoice, if it is still live, is marked replaced (never two live versions).
  const prior = earlier[earlier.length - 1];
  let supersedes: string | null = null;
  if (prior && stateFrom(await readEvents(tx, [prior.id])) === "active") {
    await tx.insert(invoiceEvents).values({ id: randomUUID(), invoiceId: prior.id, kind: "superseded", replacedBy: id, createdBy: actor.id });
    supersedes = prior.id;
  }
  // Ids and counts only: never a rate, an hours total, a name or an amount.
  await writeAudit({ actor, action: "invoice.create", targetType: "invoice", targetId: id, metadata: { runId: v.runId, clientId: v.clientId, lines: built.lines.length, revision, ...(test ? { test: true } : {}), ...(supersedes ? { supersedes } : {}) } }, tx);
  return { id, number };
}

/** Adds a billing rate (a new row; earlier rows stay). Throws ActionFailure when the client is not found. */
export async function addBillRateIn(tx: Tx, actor: AuthUser, v: { clientId: string; employeeId?: string | null; effectiveFrom: string; rate: string }): Promise<{ id: string }> {
  const cents = parseDollars(v.rate);
  if (cents === null) throw new ActionFailure("Enter a rate in dollars, for example 25.50.");
  const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, v.clientId), isNull(clients.archivedAt))).limit(1);
  if (!client) throw new ActionFailure("That client was not found.");
  const employeeId = v.employeeId ?? null;
  if (employeeId) {
    const [person] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!person) throw new ActionFailure("That person was not found.");
  }
  const id = randomUUID();
  await tx.insert(clientBillRates).values({ id, clientId: v.clientId, employeeId, effectiveFrom: v.effectiveFrom, rateEnc: fieldCrypto().encrypt(cents.toString(), rateContext(id)), createdBy: actor.id });
  await writeAudit({ actor, action: "invoice.rate.add", targetType: "client_bill_rate", targetId: id, metadata: { clientId: v.clientId, ...(employeeId ? { employeeId } : {}) } }, tx);
  return { id };
}

const loadInvoice = async (tx: Tx, invoiceId: string) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"invoices.events"}))`);
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!row) throw new ActionFailure("That invoice was not found.");
  return { row, state: stateFrom(await readEvents(tx, [invoiceId])) };
};

async function addEvent(tx: Tx, actor: AuthUser, invoiceId: string, kind: "archived" | "restored" | "voided", reason: string | null, action: string): Promise<void> {
  const id = randomUUID();
  await tx.insert(invoiceEvents).values({ id, invoiceId, kind, reasonEnc: reason ? fieldCrypto().encrypt(reason, eventContext(id)) : null, createdBy: actor.id });
  // Ids only: never the reason, a rate, a name or an amount.
  await writeAudit({ actor, action, targetType: "invoice", targetId: invoiceId, metadata: { kind } }, tx);
}

/** Archives a TEST invoice (any time it is live): it leaves the list and stays on record. A real invoice is voided instead. */
export async function archiveInvoiceIn(tx: Tx, actor: AuthUser, v: { invoiceId: string; reason?: string | null }): Promise<void> {
  const { row, state } = await loadInvoice(tx, v.invoiceId);
  if (!row.isTest) throw new ActionFailure("Only a test invoice can be archived. A real invoice is voided, with a reason.");
  if (state !== "active") throw new ActionFailure(state === "archived" ? "This invoice is already archived." : "This invoice is no longer live, so it can't be archived.");
  await addEvent(tx, actor, v.invoiceId, "archived", v.reason?.trim() || null, "invoice.archive");
}

/** Brings an archived test invoice back. */
export async function restoreInvoiceIn(tx: Tx, actor: AuthUser, v: { invoiceId: string }): Promise<void> {
  const { state } = await loadInvoice(tx, v.invoiceId);
  if (state !== "archived") throw new ActionFailure("This invoice is not archived.");
  await addEvent(tx, actor, v.invoiceId, "restored", null, "invoice.restore");
}

/**
 * Deletes archived TEST invoices for good (their events go with them). A real invoice, a live one, and an invoice that a kept invoice was
 * replaced by are never deleted. The database function picks the rows; the audit entry carries counts only.
 */
export async function purgeArchivedInvoicesIn(tx: Tx, actor: AuthUser): Promise<{ deleted: number; kept: number }> {
  const res = await tx.execute(sql`select invoices_deleted, invoices_kept from payroll.purge_archived_test_data(false, true)`);
  const row = (res as unknown as Array<{ invoices_deleted: number; invoices_kept: number }>)[0];
  const out = { deleted: row.invoices_deleted, kept: row.invoices_kept };
  await writeAudit({ actor, action: "invoice.purge", targetType: "invoice", metadata: { ...out } }, tx);
  return out;
}

/** Voids a REAL invoice with a reason: kept, stamped VOID, hidden from the default list, never reused. A test invoice is archived instead. */
export async function voidInvoiceIn(tx: Tx, actor: AuthUser, v: { invoiceId: string; reason: string }): Promise<void> {
  const { row, state } = await loadInvoice(tx, v.invoiceId);
  if (row.isTest) throw new ActionFailure("A test invoice is archived, not voided.");
  if (state !== "active") throw new ActionFailure(state === "voided" ? "This invoice is already void." : "This invoice has already been replaced by a corrected version.");
  await addEvent(tx, actor, v.invoiceId, "voided", v.reason.trim(), "invoice.void");
}
