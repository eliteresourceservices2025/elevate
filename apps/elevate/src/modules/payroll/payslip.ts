import { EXTRA_KEYS, HOLIDAY_BP, type ExtraKey, type LineInput, type LineResult } from "./calculate";
import { EXTRA_KEY_ITEM, PAYMENT_METHOD_LABELS, PAYSLIP_LABELS as L, PAY_ITEM_LABELS, type PaymentMethod } from "./constants";
import { formatPesos } from "./money";

// The payslip as plain data, pure. The on-screen page and the PDF both draw from it, so they always say the same thing. It holds the person's
// own figures from their frozen run lines and nothing else: no other person, no Preparer or Approver, no reason typed by staff, no change
// history, no bank detail.

export type PayslipLine = {
  alias: string | null;
  /** The client this pay line works for, when it has one. */
  clientName: string | null;
  input: LineInput;
  result: LineResult;
};

/** Who signed, as kept with the run when it was paid. The picture is base64 JPEG, or null when there is none. */
export type PayslipSignature = { name: string; title: string; signedOn: string; signatureBase64: string | null };

export type PayslipInput = {
  /** The person's own name. */
  name: string;
  periodStart: string;
  periodEnd: string;
  /** The person's start date on their people record. */
  hiredOn: string | null;
  lines: PayslipLine[];
  /** The newest payment date recorded for the person on this run. */
  paidOn: string | null;
  /** A short number to quote, made from the run and the person. */
  payslipNumber: string;
  /** Payment methods of the person's lines on the run (for example "remitly"). */
  paymentMethods: string[];
  /** The overtime (OT) rates the run was made with (basis points: 12500 is 125%), when known. Holiday pay is always 100%. */
  multipliersBp: Partial<Record<ExtraKey, number | null>> | null;
  signatory: PayslipSignature | null;
  /** From a test run: stamped TEST on the page and the PDF. Never true for a statement a contractor can open. */
  isTest?: boolean;
};

export type PayslipRowView = { label: string; detail: string; amount: string };
export type PayslipLineView = {
  /** The pay line's alias, shown when there is more than one line or an alias. */
  heading: string | null;
  client: string | null;
  /** How the pay was worked out: the rates. */
  computation: PayslipRowView[];
  /** Every kind of compensation, always listed: "-" when there is none for the period. */
  compensation: PayslipRowView[];
  totalCompensation: string;
  /** Every kind of deduction, always listed: "-" when there is none for the period. */
  deductions: PayslipRowView[];
  totalDeductions: string;
  /** Days of leave, always listed (bereavement and PTO are paid, SL is unpaid). */
  leave: PayslipRowView[];
  /** Total payable compensation. */
  net: string;
};
export type PayslipView = {
  title: string;
  number: string;
  name: string;
  period: string;
  hiredOn: string | null;
  paidOn: string | null;
  paidBy: string | null;
  lines: PayslipLineView[];
  /** Only when the person has more than one line on the run. */
  total: string | null;
  isTest: boolean;
  signature: { name: string; title: string; signedOn: string; imageBase64: string | null } | null;
};

/** Plain text for a name or alias: one line, no control characters. */
const plain = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const money = (c: bigint) => formatPesos(c);

const percent = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

const hoursAndMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : ""].filter(Boolean).join(" ");
};

const dayText = (hundredths: number) => `${(hundredths / 100).toFixed(2).replace(/\.?0+$/, "")} ${hundredths === 100 ? "day" : "days"}`;

const DASH = "-";
const orDash = (c: bigint) => (c === 0n ? DASH : money(c));

/** The named lines of one kind, or a single "-" row under the kind's own name when there are none. */
function named(lines: { label: string; amount: bigint }[], kind: string, none: string): PayslipRowView[] {
  if (lines.length === 0) return [{ label: none, detail: "", amount: DASH }];
  return lines.map((x) => ({ label: plain(x.label), detail: kind, amount: money(x.amount) }));
}

function lineView(line: PayslipLine, input: PayslipInput): PayslipLineView {
  const { input: i, result: r } = line;

  const worked = i.partial
    ? `${[i.partial.dayHundredths > 0 ? dayText(i.partial.dayHundredths) : "", i.partial.minutes > 0 ? hoursAndMinutes(i.partial.minutes) : ""].filter(Boolean).join(" ")} worked`
    : "";
  const compensation: PayslipRowView[] = [{ label: L.base, detail: worked, amount: money(r.base) }];
  for (const key of EXTRA_KEYS) {
    const bp = key === "holiday" ? HOLIDAY_BP : (input.multipliersBp?.[key] ?? null);
    compensation.push({
      label: PAY_ITEM_LABELS[EXTRA_KEY_ITEM[key]],
      detail: i.extra[key] > 0 ? [hoursAndMinutes(i.extra[key]), bp ? `at ${percent(bp)}` : ""].filter(Boolean).join(" ") : "",
      amount: orDash(r.extra[key]),
    });
  }
  compensation.push(
    ...named(i.allowances, PAY_ITEM_LABELS.allowance, L.allowancesNone),
    ...named(i.reimbursements, PAY_ITEM_LABELS.reimbursement, L.reimbursementsNone),
    ...named(i.bonuses, PAY_ITEM_LABELS.bonus, L.bonusesNone),
    ...named(i.adjustments, PAY_ITEM_LABELS.adjustment, L.adjustmentsNone),
  );
  const totalCompensation = r.base + EXTRA_KEYS.reduce((sum, key) => sum + r.extra[key], 0n) + r.allowances + r.reimbursements + r.bonuses + r.adjustments;

  const deductions: PayslipRowView[] = [
    { label: PAY_ITEM_LABELS.absence_days, detail: r.absences !== 0n ? dayText(i.absenceDayHundredths) : "", amount: orDash(r.absences) },
    { label: PAY_ITEM_LABELS.sick_leave_days, detail: r.sickLeave !== 0n ? dayText(i.sickLeaveDayHundredths) : "", amount: orDash(r.sickLeave) },
    { label: PAY_ITEM_LABELS.late_minutes, detail: r.late !== 0n ? `${i.lateMinutes} min` : "", amount: orDash(r.late) },
    { label: PAY_ITEM_LABELS.loan, detail: "", amount: orDash(i.loan) },
    { label: PAY_ITEM_LABELS.other_deduction, detail: "", amount: orDash(i.otherDeductions) },
  ];
  const totalDeductions = r.absences + r.sickLeave + r.late + i.loan + i.otherDeductions;

  const days = (hundredths: number) => (hundredths > 0 ? dayText(hundredths) : DASH);
  const leave: PayslipRowView[] = [
    { label: PAY_ITEM_LABELS.bereavement_days, detail: "", amount: days(i.bereavementDayHundredths) },
    { label: PAY_ITEM_LABELS.pto_days, detail: "", amount: days(i.ptoDayHundredths) },
    { label: PAY_ITEM_LABELS.sick_leave_days, detail: "", amount: days(i.sickLeaveDayHundredths) },
  ];

  const computation: PayslipRowView[] = [
    { label: L.monthlyRate, detail: "", amount: money(i.monthlyCentavos) },
    { label: L.dailyRate, detail: "", amount: money(r.daily) },
    { label: L.hourlyRate, detail: "", amount: money(r.hourly) },
    { label: L.hoursPerDay, detail: "", amount: String(i.hoursPerDay) },
  ];

  const alias = line.alias ? plain(line.alias) : "";
  return {
    heading: alias ? L.lineHeading(alias) : null,
    client: line.clientName ? plain(line.clientName) : null,
    computation,
    compensation,
    totalCompensation: money(totalCompensation),
    deductions,
    totalDeductions: money(totalDeductions),
    leave,
    net: money(r.net),
  };
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
    hiredOn: input.hiredOn,
    paidOn: input.paidOn,
    paidBy: paidBy || null,
    lines: input.lines.map((l, index) => {
      const view = lineView(l, input);
      return { ...view, heading: view.heading ?? (multi ? L.lineHeading(String(index + 1)) : null) };
    }),
    total: multi ? money(input.lines.reduce((sum, l) => sum + l.result.net, 0n)) : null,
    isTest: input.isTest === true,
    signature: input.signatory
      ? { name: plain(input.signatory.name), title: plain(input.signatory.title), signedOn: input.signatory.signedOn, imageBase64: input.signatory.signatureBase64 }
      : null,
  };
}
