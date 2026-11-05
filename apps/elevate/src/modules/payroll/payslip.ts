import { EXTRA_KEYS, type ExtraKey, type LineInput, type LineResult } from "./calculate";
import { EXTRA_KEY_ITEM, PAYMENT_METHOD_LABELS, PAYSLIP_LABELS as L, PAY_ITEM_LABELS, type PaymentMethod } from "./constants";
import { formatUsdRate } from "./items";
import { formatPesos } from "./money";

// The payslip as plain data, pure. The on-screen page and the PDF both draw from it, so they always say the same thing. It holds the person's
// own figures from their frozen run lines and nothing else: no other person, no Preparer or Approver, no reason typed by staff, no change
// history, no bank detail.

export type PayslipLine = { alias: string | null; input: LineInput; result: LineResult };

/** Who signed, as kept with the run when it was paid. The picture is base64 JPEG, or null when there is none. */
export type PayslipSignature = { name: string; title: string; signedOn: string; signatureBase64: string | null };

export type PayslipInput = {
  /** The person's own name. */
  name: string;
  periodStart: string;
  periodEnd: string;
  usdRateE4: number | null;
  lines: PayslipLine[];
  /** The newest payment date recorded for the person on this run. */
  paidOn: string | null;
  /** A short number to quote, made from the run and the person. */
  payslipNumber: string;
  /** Payment methods of the person's lines on the run (for example "remitly"). */
  paymentMethods: string[];
  /** The extra-hours rates the run was made with (basis points: 12500 is 125%), when known. */
  multipliersBp: Partial<Record<ExtraKey, number | null>> | null;
  signatory: PayslipSignature | null;
};

export type PayslipRowView = { label: string; detail: string; amount: string };
export type PayslipLineView = {
  /** The pay line's alias, shown when there is more than one line or an alias. */
  heading: string | null;
  earnings: PayslipRowView[];
  gross: string;
  additions: PayslipRowView[];
  deductions: PayslipRowView[];
  net: string;
};
export type PayslipView = {
  title: string;
  number: string;
  name: string;
  period: string;
  paidOn: string | null;
  paidBy: string | null;
  lines: PayslipLineView[];
  /** Only when the person has more than one line on the run. */
  total: string | null;
  signature: { name: string; title: string; signedOn: string; imageBase64: string | null } | null;
};

/** Plain text for a name or alias: one line, no control characters. */
const plain = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const money = (c: bigint) => formatPesos(c);
const minus = (c: bigint) => `-${formatPesos(c)}`;
/** A figure that can be either sign (an adjustment): the sign only when it is negative. */
const signed = (c: bigint) => (c < 0n ? minus(-c) : money(c));

const percent = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

const hoursAndMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : ""].filter(Boolean).join(" ");
};

const dayText = (hundredths: number) => `${(hundredths / 100).toFixed(2).replace(/\.?0+$/, "")} ${hundredths === 100 ? "day" : "days"}`;

function lineView(line: PayslipLine, input: PayslipInput): PayslipLineView {
  const { input: i, result: r } = line;
  const earnings: PayslipRowView[] = [{ label: L.base, detail: "", amount: money(r.base) }];
  for (const key of EXTRA_KEYS) {
    if (r.extra[key] === 0n && i.extra[key] === 0) continue;
    const bp = input.multipliersBp?.[key] ?? null;
    earnings.push({
      label: PAY_ITEM_LABELS[EXTRA_KEY_ITEM[key]],
      detail: [hoursAndMinutes(i.extra[key]), bp ? `at ${percent(bp)}` : ""].filter(Boolean).join(" "),
      amount: money(r.extra[key]),
    });
  }
  if (i.pesoAllowance !== 0n) earnings.push({ label: PAY_ITEM_LABELS.peso_allowance, detail: "", amount: money(i.pesoAllowance) });
  if (r.absences !== 0n) earnings.push({ label: PAY_ITEM_LABELS.absence_days, detail: dayText(i.absenceDayHundredths), amount: minus(r.absences) });
  if (r.late !== 0n) earnings.push({ label: PAY_ITEM_LABELS.late_minutes, detail: `${i.lateMinutes} min`, amount: minus(r.late) });

  const additions: PayslipRowView[] = [];
  if (i.dollarAllowanceCents !== 0n) {
    additions.push({
      label: PAY_ITEM_LABELS.dollar_allowance,
      detail: `USD ${money(i.dollarAllowanceCents)}${input.usdRateE4 !== null ? ` at ${formatUsdRate(input.usdRateE4)} pesos per dollar` : ""}`,
      amount: money(r.dollarAllowancePesos),
    });
  }
  if (i.adjustment !== 0n) additions.push({ label: PAY_ITEM_LABELS.adjustment, detail: "", amount: signed(i.adjustment) });

  const deductions: PayslipRowView[] = [];
  if (i.loan !== 0n) deductions.push({ label: PAY_ITEM_LABELS.loan, detail: "", amount: minus(i.loan) });
  if (i.otherDeductions !== 0n) deductions.push({ label: PAY_ITEM_LABELS.other_deduction, detail: "", amount: minus(i.otherDeductions) });

  const alias = line.alias ? plain(line.alias) : "";
  return { heading: alias ? L.lineHeading(alias) : null, earnings, gross: money(r.gross), additions, deductions, net: money(r.net) };
}

/** The payslip for one person and one run: every one of their lines, and a total when there is more than one. */
export function payslipView(input: PayslipInput): PayslipView {
  const multi = input.lines.length > 1;
  const paidBy = [...new Set(input.paymentMethods)].map((m) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? plain(m)).join(", ");
  return {
    title: L.documentTitle,
    number: input.payslipNumber,
    name: plain(input.name),
    period: `${input.periodStart} to ${input.periodEnd}`,
    paidOn: input.paidOn,
    paidBy: paidBy || null,
    lines: input.lines.map((l, index) => {
      const view = lineView(l, input);
      return { ...view, heading: view.heading ?? (multi ? L.lineHeading(String(index + 1)) : null) };
    }),
    total: multi ? money(input.lines.reduce((sum, l) => sum + l.result.net, 0n)) : null,
    signature: input.signatory
      ? { name: plain(input.signatory.name), title: plain(input.signatory.title), signedOn: input.signatory.signedOn, imageBase64: input.signatory.signatureBase64 }
      : null,
  };
}
