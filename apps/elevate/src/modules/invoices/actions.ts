"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatDollars, formatHours } from "./calc";
import { addBillRateIn, createInvoiceIn, previewRun } from "./service";
import { addBillRateSchema, createInvoiceSchema, previewInvoiceRunSchema } from "./validators";

// Every action: requireUser() first, then authorize() inside runAction, then Zod. Writes and their audit rows share one transaction.
// Helpers that take the acting user live in service.ts.

const BAD_REQUEST = "Check the request and try again.";

/** The preview as plain text for the dialog (no bigint crosses to the browser). */
type RunPreviewView = {
  period: string;
  status: string;
  clients: { clientId: string; clientName: string; people: number; hours: string; unconfirmedLines: number; rate: string | null; total: string | null; existing: number }[];
  noClient: string[];
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
      clients: preview.clients.map((c) => ({
        clientId: c.clientId,
        clientName: c.clientName,
        people: c.people,
        hours: formatHours(c.hoursHundredths),
        unconfirmedLines: c.unconfirmedLines,
        rate: c.rateCents === null ? null : formatDollars(c.rateCents),
        total: c.totalCents === null ? null : formatDollars(c.totalCents),
        existing: c.existing,
      })),
      noClient: preview.noClient,
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
