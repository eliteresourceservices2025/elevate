"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatDollars, formatHours } from "./calc";
import { addBillRateIn, archiveInvoiceIn, createInvoiceIn, previewRun, purgeArchivedInvoicesIn, purgeRetiredInvoicesIn, restoreInvoiceIn, voidInvoiceIn } from "./service";
import { addBillRateSchema, archiveInvoiceSchema, createInvoiceSchema, previewInvoiceRunSchema, restoreInvoiceSchema, voidInvoiceSchema } from "./validators";

// Every action: requireUser() first, then authorize() inside runAction, then Zod. Writes and their audit rows share one transaction.
// Helpers that take the acting user live in service.ts.

const BAD_REQUEST = "Check the request and try again.";

/** The preview as plain text for the dialog (no bigint crosses to the browser). */
type RunPreviewView = {
  period: string;
  status: string;
  isTest: boolean;
  clients: { clientId: string; clientName: string; people: number; hours: string; unconfirmedLines: number; rate: string | null; ownRates: number; missingRates: string[]; total: string | null; existing: number }[];
  noClient: string[];
  noHours: string[];
};

/** What a run could be invoiced from, per client, with the rate that would apply. Read only. */
export async function previewInvoiceRun(input: unknown): Promise<ActionResult<RunPreviewView>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.create");
    const parsed = previewInvoiceRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    const preview = await previewRun(db, parsed.data.runId);
    if (!preview) return fail("That pay run was not found.");
    const data: RunPreviewView = {
      period: `${preview.run.periodStart} to ${preview.run.periodEnd}`,
      status: preview.run.status,
      isTest: preview.run.isTest,
      clients: preview.clients.map((c) => ({
        clientId: c.clientId,
        clientName: c.clientName,
        people: c.people,
        hours: formatHours(c.hoursHundredths),
        unconfirmedLines: c.unconfirmedLines,
        rate: c.rateCents === null ? null : formatDollars(c.rateCents),
        ownRates: c.ownRates,
        missingRates: c.missingRates,
        total: c.totalCents === null ? null : formatDollars(c.totalCents),
        existing: c.existing,
      })),
      noClient: preview.noClient,
      noHours: preview.noHours,
    };
    return { ok: true, data } as const;
  });
}

export async function createInvoice(input: unknown): Promise<ActionResult<{ invoiceId: string; number: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.create");
    const parsed = createInvoiceSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    const made = await db.transaction((tx) => createInvoiceIn(tx, actor, parsed.data));
    revalidatePath("/invoices");
    return { ok: true, data: { invoiceId: made.id, number: made.number } } as const;
  });
}

export async function addBillRate(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.manage_rates");
    const parsed = addBillRateSchema.safeParse(input);
    if (!parsed.success) return fail("Check the client, the start date and the rate (in dollars), then try again.");
    await db.transaction((tx) => addBillRateIn(tx, actor, parsed.data));
    revalidatePath("/invoices/rates");
    return { ok: true, data: undefined } as const;
  });
}

/** Archives a TEST invoice (it leaves the list and stays on record). A real invoice is voided instead. */
export async function archiveInvoice(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.manage");
    const parsed = archiveInvoiceSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    await db.transaction((tx) => archiveInvoiceIn(tx, actor, parsed.data));
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    return { ok: true, data: undefined } as const;
  });
}

/** Brings an archived test invoice back into the list. */
export async function restoreInvoice(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.manage");
    const parsed = restoreInvoiceSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    await db.transaction((tx) => restoreInvoiceIn(tx, actor, parsed.data));
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    return { ok: true, data: undefined } as const;
  });
}

/** Deletes every archived TEST invoice for good. Returns how many were deleted and how many archived ones had to stay. */
export async function purgeArchivedInvoices(): Promise<ActionResult<{ deleted: number; kept: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.purge_archived");
    const data = await db.transaction((tx) => purgeArchivedInvoicesIn(tx, actor));
    revalidatePath("/invoices");
    return { ok: true, data } as const;
  });
}

/** Deletes every void and replaced invoice for good (real ones too). The numbers of deleted real invoices are never used again. */
export async function purgeRetiredInvoices(): Promise<ActionResult<{ deleted: number; kept: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.purge_retired");
    const data = await db.transaction((tx) => purgeRetiredInvoicesIn(tx, actor));
    revalidatePath("/invoices");
    return { ok: true, data } as const;
  });
}

/** Voids a REAL invoice with a reason: it is kept, stamped VOID and hidden from the default list. */
export async function voidInvoice(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invoices.manage");
    const parsed = voidInvoiceSchema.safeParse(input);
    if (!parsed.success) return fail("Give a reason for voiding this invoice.");
    await db.transaction((tx) => voidInvoiceIn(tx, actor, parsed.data));
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    return { ok: true, data: undefined } as const;
  });
}
