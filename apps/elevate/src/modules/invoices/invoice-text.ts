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
  const rate = formatDollars(v.rateCents);
  return {
    number: v.number,
    issuedOn: v.issuedOn,
    isDraft: v.runStatus === "draft",
    draftNote: INVOICE_LABELS.draftNote,
    isTest: v.isTest,
    testNote: INVOICE_LABELS.testNote,
    clientName: v.clientName,
    period: `${v.periodStart} to ${v.periodEnd}`,
    rate,
    lines: v.lines.map((l) => ({ name: l.alias ? `${l.name} (${l.alias})` : l.name, hours: formatHours(l.hoursHundredths), rate, amount: formatDollars(l.amountCents) })),
    totalHours: formatHours(v.totalHoursHundredths),
    total: formatDollars(v.totalCents),
    unconfirmed: v.unconfirmedLines > 0 ? unconfirmedNote(v.unconfirmedLines) : null,
    currency: INVOICE_LABELS.currency,
  };
}
