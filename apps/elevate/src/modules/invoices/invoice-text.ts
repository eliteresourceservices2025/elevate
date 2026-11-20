import { formatDollars, formatHours, INVOICE_LABELS, unconfirmedNote } from "./calc";
import type { InvoiceView } from "./service";

// The invoice as plain text rows, shared by the page and the PDF so they always say the same thing.

export type InvoiceText = {
  number: string;
  issuedOn: string;
  isDraft: boolean;
  draftNote: string;
  isTest: boolean;
  testNote: string;
  /** What became of the invoice (void, archived, replaced), as a note to stamp on the page and the PDF; null while it is live. */
  stateNote: string | null;
  clientName: string;
  period: string;
  rate: string;
  lines: { name: string; hours: string; rate: string; amount: string }[];
  totalHours: string;
  total: string;
  unconfirmed: string | null;
  currency: string;
};

export function invoiceText(v: InvoiceView): InvoiceText {
  // The header shows the one rate every line is billed at, or says it varies by person (each line then shows its own).
  const mixed = new Set(v.lines.map((l) => l.rateCents)).size > 1;
  const rate = mixed ? INVOICE_LABELS.mixedRates : formatDollars(v.lines[0]?.rateCents ?? v.rateCents);
  const stateNote =
    v.state === "voided" ? INVOICE_LABELS.voidNote : v.state === "archived" ? INVOICE_LABELS.archivedNote : v.state === "superseded" ? INVOICE_LABELS.supersededNote(v.replacedByNumber ?? "a newer one") : null;
  return {
    number: v.number,
    issuedOn: v.issuedOn,
    isDraft: v.runStatus === "draft",
    draftNote: INVOICE_LABELS.draftNote,
    isTest: v.isTest,
    testNote: INVOICE_LABELS.testNote,
    stateNote,
    clientName: v.clientName,
    period: `${v.periodStart} to ${v.periodEnd}`,
    rate,
    lines: v.lines.map((l) => ({ name: l.alias ? `${l.name} (${l.alias})` : l.name, hours: formatHours(l.hoursHundredths), rate: formatDollars(l.rateCents), amount: formatDollars(l.amountCents) })),
    totalHours: formatHours(v.totalHoursHundredths),
    total: formatDollars(v.totalCents),
    unconfirmed: v.unconfirmedLines > 0 ? unconfirmedNote(v.unconfirmedLines) : null,
    currency: INVOICE_LABELS.currency,
  };
}
